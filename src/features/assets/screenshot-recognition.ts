import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { z } from "zod";

import {
  type AssetKind,
  assetKindSchema,
} from "@/features/assets/account-appearance";
import {
  type AccountBalance,
  lastFourDigitsSchema,
} from "@/features/assets/asset-repository";
import {
  currencySchema,
  knownAssetCurrencies,
} from "@/features/assets/currencies";
import { callVisionModel } from "@/features/settings/llm-client";
import { resolveLlmConfig } from "@/features/settings/llm-config-store";

// Fields the model may return. All optional so callers can merge only what
// was recognized and leave the rest for the user to fill in. `balances`
// carries one entry per currency shown, so a multi-currency account (e.g. a
// DBS Multiplier holding SGD, HKD and USD) is recognized in a single pass.
export type RecognizedAccount = {
  accountName?: string;
  accountLastFourDigits?: string;
  balances?: AccountBalance[];
  kind?: AssetKind;
};

// Thrown when the user has not configured an LLM endpoint yet. The UI catches
// this to route to the settings screen instead of showing a generic failure.
export class MissingLlmConfigError extends Error {
  constructor() {
    super("No LLM endpoint configured");
    this.name = "MissingLlmConfigError";
  }
}

const CURRENCY_CODES = knownAssetCurrencies
  .map((code) => `"${code}"`)
  .join(", ");

// The prompt fully specifies the output shape, mirrored in prose so the model
// emits the exact field names. `callVisionModel` additionally asks for JSON
// mode where the endpoint supports it, but the shape is never enforced by a
// strict `json_schema` grammar — see the rationale there. So the prompt stays
// the contract, and `parseRecognizedAccounts` validates what comes back:
// endpoints that fall back out of JSON mode, and thinking models that spend
// their budget on reasoning and return empty `content`, both still land on a
// well-defined result.
const RECOGNITION_PROMPT = `Extract every account shown in this personal-finance app screenshot.

An "account" is one account number or card — NOT one row on screen. Banks split one account number into per-currency sub-accounts: HSBC Hong Kong shows "HKD Current", "HKD Savings" and "USD Savings" as separate rows of the SAME account. That is one account holding several currencies.

Respond with ONLY a JSON object — no prose, no markdown code fence — using exactly this shape:
{
  "accounts": [
    {
      "accountName": <string or null>,
      "accountNumber": <string or null, transcribed exactly as shown>,
      "accountLastFourDigits": <string or null, exactly 4 digits if shown>,
      "balances": <array or null, one entry per currency>,
      "kind": <"cash" | "investment" | "crypto" | null>
    }
  ]
}

- One entry per account number / card: fold all of its sub-accounts, wallets and currency rows into that entry. Start a new entry only for a different number, card, or separate product.
- Do NOT treat a "total assets" / "net worth" / summary row as an account.
- accountName: the account or product itself ("HSBC One", "Multiplier"), never a sub-account label ("HKD Savings", "港元往来").
- accountNumber: transcribe character for character, keeping separators and masking — "004-123456-833", "012-34123-4", "•••• 4242". Never reformat or drop characters. Sub-accounts of one account repeat the same number.
- accountLastFourDigits: its last four digits, ignoring separators. Null if fewer than four digits are visible, or if you only report accountNumber.
- balances: one entry per currency, each {"currency": <code>, "balance": <number>}. currency must be one of: ${CURRENCY_CODES}; skip currencies outside that list.
  - Sub-accounts of one account sharing a currency ("HKD Current" 1,000.00 + "HKD Savings" 2,500.00) are ADDED into one entry: {"currency": "HKD", "balance": 3500}. Emit each currency at most once.
  - Never count the same money twice: prefer a per-currency subtotal over the rows it covers, and ignore an account total converted into one currency ("Total (HKD equivalent)").
- kind: "cash" for bank accounts and wallets, "investment" for brokerages and trading, "crypto" for exchanges and crypto wallets.
- Use null for any field you cannot determine; keep the entry rather than dropping it.
- Output only the JSON.`;

const MAX_IMAGE_WIDTH = 1568;

function stripCodeFence(content: string): string {
  const match = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return match ? match[1] : content;
}

// Validation schemas for the model's response fields, replacing the hand-
// written `typeof`/`Number.isFinite`/`isKnownAssetCurrency`/`isAssetKind`/
// `isValidLastFourDigits` guards. Each field is validated independently with
// `safeParse` so one bad field is dropped (not fatal) — a flaky model that
// garbles one row doesn't discard the rest of a valid response. The currency,
// kind, and last-four schemas are imported from the modules that own those
// lists so "what is a valid X" is defined once across stored, model, and form
// validation.
const balanceEntrySchema = z.object({
  currency: currencySchema,
  balance: z.number().positive(),
});

// A JSON object (string-keyed record) from the model — the envelope shape and
// each account entry are both validated against this before field-level
// parsing, so "is this a JSON object" is defined once.
const jsonObjectSchema = z.record(z.string(), z.unknown());

// A model balance entry is usable when its amount is a finite positive number
// and its currency is one we track. Zero balances are dropped on purpose: some
// banks show currency sub-accounts with a 0 balance, and surfacing those as
// rows in the form (e.g. an empty USD row alongside real SGD/HKD balances) is
// noise the user then has to delete. Shared by the array-entries loop and the
// legacy single-balance fallback so the acceptance rule lives once.
function parseBalanceEntry(entry: unknown): AccountBalance | null {
  const result = balanceEntrySchema.safeParse(entry);
  return result.success ? result.data : null;
}

// Folds a balance into a list, ADDING to an existing entry in the same
// currency instead of replacing it (the upsert semantics of the repository's
// `mergeBalance`). One account number can hold several sub-accounts in one
// currency — HSBC Hong Kong splits HKD into a current and a savings
// sub-account — and their sum is the account's balance in that currency. The
// prompt asks the model to add them itself and emit one entry per currency;
// this is the belt to that suspenders, so a model that echoes the sub-account
// rows verbatim still yields the total rather than silently dropping all but
// the last row. The prompt's "never count the same money twice" rules (skip
// per-currency subtotals that cover rows already listed, skip aggregate rows)
// are what keep this from double-counting.
function addBalance(
  balances: AccountBalance[],
  incoming: AccountBalance,
): AccountBalance[] {
  const index = balances.findIndex((b) => b.currency === incoming.currency);
  if (index < 0) {
    return [...balances, incoming];
  }
  const next = [...balances];
  next[index] = {
    currency: incoming.currency,
    balance: next[index].balance + incoming.balance,
  };
  return next;
}

// Extracts the last four digits from a transcribed account number: drop every
// non-digit (the hyphens in "004-123456-833", the spaces and bullets in
// "•••• •••• •••• 4242") and take the tail. Anything that doesn't leave four
// digits behind — a masked number showing fewer, a non-string, an empty field
// — yields undefined, which reads as "not recognized" and leaves the field for
// the user. Applied to the model's own `accountLastFourDigits` too, so a model
// that answers "1-234" there still lands on "1234". Because this runs on every
// path, the prompt only asks for a faithful transcription and does not spell
// out the strip-and-slice rule — teaching the model an algorithm this already
// performs exactly would spend tokens without changing the result.
function lastFourFromNumber(value: unknown): string | undefined {
  const parsed = z.string().safeParse(value);
  if (!parsed.success) {
    return undefined;
  }
  const digits = parsed.data.replace(/\D/g, "");
  const result = lastFourDigitsSchema.safeParse(digits.slice(-4));
  return result.success ? result.data : undefined;
}

// Parses one account object out of a model response into a RecognizedAccount,
// validating each field independently with `safeParse` so one bad field is
// dropped rather than failing the whole account. See `balanceEntrySchema`
// above for the per-field validation rationale.
function parseSingleAccount(
  parsed: Record<string, unknown>,
): RecognizedAccount {
  const result: RecognizedAccount = {};

  const nameResult = z.string().safeParse(parsed.accountName);
  if (nameResult.success) {
    const trimmed = nameResult.data.trim();
    if (trimmed) {
      result.accountName = trimmed;
    }
  }

  // The model transcribes the number and also reports its last four; we
  // recompute from the transcription and fall back to the model's own answer
  // (older responses carry no `accountNumber`). Transcribing is OCR, which
  // vision models do well; slicing the tail off a separated number is string
  // arithmetic, which they do badly — an HSBC Hong Kong number ending "1-234"
  // came back as "0234" (the hyphen padded into a zero) and a DBS number
  // ending "123-4" lost the digit past the hyphen. Both pass
  // `lastFourDigitsSchema`, so the wrong answer is indistinguishable from a
  // right one downstream; deriving it here makes the step exact.
  const lastFour =
    lastFourFromNumber(parsed.accountNumber) ??
    lastFourFromNumber(parsed.accountLastFourDigits);
  if (lastFour) {
    result.accountLastFourDigits = lastFour;
  }

  // Collect per-currency balances. Prefer the "balances" array; fall back to
  // a legacy single "balance"/"currency" pair so an older model response still
  // maps to one balance entry. Same-currency entries are summed (see
  // `addBalance`) so per-currency sub-accounts collapse into one row. Invalid
  // entries are skipped (not fatal) so one bad row doesn't discard the rest.
  const collected: AccountBalance[] = [];
  if (Array.isArray(parsed.balances)) {
    for (const entry of parsed.balances) {
      const balance = parseBalanceEntry(entry);
      if (balance) {
        collected.push(balance);
      }
    }
  }
  if (collected.length === 0) {
    const balance = parseBalanceEntry({
      balance: parsed.balance,
      currency: parsed.currency,
    });
    if (balance) {
      collected.push(balance);
    }
  }
  const balances = collected.reduce(addBalance, [] as AccountBalance[]);
  if (balances.length > 0) {
    result.balances = balances;
  }

  const kindResult = assetKindSchema.safeParse(parsed.kind);
  if (kindResult.success) {
    result.kind = kindResult.data;
  }

  return result;
}

// True when the model returned at least one usable field for this account.
// Entries where every field was null/unrecognized are dropped so the wizard
// doesn't open on a stack of empty cards.
function isUsableAccount(account: RecognizedAccount): boolean {
  return Boolean(
    account.accountName ||
    account.accountLastFourDigits ||
    account.balances?.length ||
    account.kind,
  );
}

// Parses the model's JSON response into a list of recognized accounts. The
// prompt asks for `{ "accounts": [...] }`; a legacy single-object response
// (no "accounts" wrapper) is still accepted and treated as one account so an
// older model response maps to a single-element list. Empty content,
// non-JSON, and non-object responses all degrade to an empty list — the
// caller leaves the form blank for manual entry instead of surfacing a hard
// failure. A thinking model that burned its token budget on reasoning returns
// empty content; a `JSON.parse` `SyntaxError` escapes `safeParse` (which only
// catches ZodErrors) and is caught here so unparseable content degrades the
// same way.
function parseRecognizedAccounts(content: string): RecognizedAccount[] {
  const raw = stripCodeFence(content).trim();
  if (raw.length === 0) {
    return [];
  }

  let parsedValue: unknown;
  try {
    parsedValue = JSON.parse(raw);
  } catch {
    return [];
  }
  // A bare array at the top level is the whole account list. Models asked for
  // several accounts answer this way often enough that rejecting it would send
  // the user off to re-type accounts the model actually read correctly — and
  // an endpoint that can't do JSON mode has nothing forcing the object
  // envelope in the first place.
  if (Array.isArray(parsedValue)) {
    return recognizedFromEntries(parsedValue);
  }

  const parsedResult = jsonObjectSchema.safeParse(parsedValue);
  if (!parsedResult.success) {
    return [];
  }
  const parsed = parsedResult.data;

  // Legacy single-account response: the top level is the one account object.
  const entries: unknown[] = Array.isArray(parsed.accounts)
    ? parsed.accounts
    : [parsed];
  return recognizedFromEntries(entries);
}

// Field-parses each entry, drops the ones that yielded nothing, and folds
// currency sub-accounts back together. Shared by the object-envelope and
// bare-array shapes so both land on identical accounts.
function recognizedFromEntries(entries: unknown[]): RecognizedAccount[] {
  return mergeAccountsSharingANumber(
    entries.map(parseAccountEntry).filter((account) => account !== null),
  );
}

// Collapses entries that carry the same account number into one account. The
// prompt asks the model to group currency sub-accounts under their account
// number itself; when it returns them as separate entries anyway (HSBC Hong
// Kong's "HKD Current" / "HKD Savings" / "USD Savings" rows all share one
// number), the wizard would otherwise open a card per sub-account for what is
// a single account.
//
// Only entries whose last four digits are present and equal are folded
// together — several accounts on one screenshot may all lack a number, and
// merging those would fuse genuinely distinct accounts. Balances are summed
// per currency; name and kind take the first non-empty value, so the earliest
// row wins and the user can rename the merged account in the form. Insertion
// order is preserved.
function mergeAccountsSharingANumber(
  accounts: RecognizedAccount[],
): RecognizedAccount[] {
  const merged: RecognizedAccount[] = [];
  const indexByLastFour = new Map<string, number>();

  for (const account of accounts) {
    const lastFour = account.accountLastFourDigits;
    const existingIndex = lastFour ? indexByLastFour.get(lastFour) : undefined;
    if (existingIndex === undefined) {
      if (lastFour) {
        indexByLastFour.set(lastFour, merged.length);
      }
      merged.push(account);
      continue;
    }

    const existing = merged[existingIndex];
    const balances = (account.balances ?? []).reduce(
      addBalance,
      existing.balances ?? [],
    );
    merged[existingIndex] = {
      ...existing,
      accountName: existing.accountName ?? account.accountName,
      kind: existing.kind ?? account.kind,
      ...(balances.length > 0 ? { balances } : {}),
    };
  }

  return merged;
}

// One entry of the model's account list — dropped when it isn't an object or
// carries no usable field.
function parseAccountEntry(entry: unknown): RecognizedAccount | null {
  const record = jsonObjectSchema.safeParse(entry);
  if (!record.success) {
    return null;
  }
  const account = parseSingleAccount(record.data);
  return isUsableAccount(account) ? account : null;
}

async function compressImageToBase64(
  uri: string,
  originalWidth?: number,
): Promise<string> {
  const context = ImageManipulator.manipulate(uri);
  // expo-image-manipulator has no downscale-only mode: an unconditional resize
  // would upscale screenshots narrower than MAX_IMAGE_WIDTH, bloating the
  // upload and vision-token count. Only resize when the source exceeds the cap.
  if (originalWidth !== undefined && originalWidth > MAX_IMAGE_WIDTH) {
    context.resize({ width: MAX_IMAGE_WIDTH });
  }
  const rendered = await context.renderAsync();
  const result = await rendered.saveAsync({
    format: SaveFormat.JPEG,
    compress: 0.7,
    base64: true,
  });

  if (!result.base64) {
    throw new Error("Failed to encode account screenshot");
  }

  return result.base64;
}

export async function recognizeAccountFromScreenshot(
  imageUri: string,
  originalWidth?: number,
): Promise<RecognizedAccount[]> {
  // Kick off image compression in parallel with reading the LLM config —
  // they are independent, and overlapping the native image work with the
  // secure-store reads shaves user-visible "recognizing" latency.
  const base64Promise = compressImageToBase64(imageUri, originalWidth);
  // Attach a no-op catcher immediately so a compression rejection can never
  // surface as an unhandled promise rejection while we await resolveLlmConfig
  // (compression may reject before the config read resolves). The await below
  // still re-throws the compression error for normal error handling.
  base64Promise.catch(() => {});

  const config = await resolveLlmConfig();

  if (!config) {
    throw new MissingLlmConfigError();
  }

  const base64 = await base64Promise;
  // No token cap is set — see `callVisionModel` for the thinking-model rationale.
  const content = await callVisionModel(config, RECOGNITION_PROMPT, base64);

  return parseRecognizedAccounts(content);
}
