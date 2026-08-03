import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { z } from "zod";

import {
  type AssetKind,
  assetKindSchema,
} from "@/features/assets/account-appearance";
import {
  type AccountBalance,
  lastFourDigitsSchema,
  mergeBalance,
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

// The prompt fully specifies the output shape. We deliberately do NOT use
// response_format/json_schema here: many local OpenAI-compatible servers
// (e.g. LM Studio) reject strict schemas whose properties use `["string","null"]`
// unions, and even when a strict grammar is accepted it conflicts with thinking
// models (e.g. Qwen3), which emit reasoning out-of-band and then produce an
// empty `content`. Prompting for the shape and validating the result in
// parseRecognizedAccount is the robust path across local endpoints. The shape
// is mirrored in prose so the model emits the exact field names without a
// schema to enforce them.
const RECOGNITION_PROMPT = `Extract the account shown in this personal-finance app screenshot.

Respond with ONLY a JSON object — no prose, no markdown code fence — using exactly this shape:
{
  "accountName": <string or null>,
  "accountLastFourDigits": <string or null, exactly 4 digits>,
  "balances": <array or null, one entry per currency shown>,
  "kind": <"cash" | "investment" | "crypto" | null>
}

- accountName: the account or product name shown.
- accountLastFourDigits: the last four digits of the account or card number.
- balances: one entry per currency shown, each {"currency": <code>, "balance": <number>}. currency must be one of: ${CURRENCY_CODES}. Use the displayed balance.
- kind: "cash" for bank accounts and wallets, "investment" for brokerages and trading, "crypto" for exchanges and crypto wallets.
- Use null for any field you cannot determine.
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

function parseRecognizedAccount(content: string): RecognizedAccount {
  const raw = stripCodeFence(content).trim();
  // A thinking model whose reasoning consumed the token budget — or which was
  // cut off before it could emit JSON — returns an empty content. Treat that as
  // "nothing recognized" instead of letting JSON.parse throw and surface a
  // generic recognition failure: the caller fills what it can and leaves the
  // rest blank for the user.
  if (raw.length === 0) {
    return {};
  }
  // The model may return a non-object JSON value (e.g. the literal `null` when
  // it can't determine anything, or a bare string/number). Treat any non-record
  // as "nothing recognized" so a `null` response doesn't crash on property
  // access below — the caller leaves the form blank for manual entry.
  //
  // Without a token cap the model is more likely to emit prose-wrapped or
  // trailing-text JSON that `stripCodeFence` doesn't fully clean up; a
  // `JSON.parse` `SyntaxError` would escape `safeParse` (which only catches
  // ZodErrors) and surface as a generic recognition failure. Catch it here so
  // unparseable content degrades to "nothing recognized" like the empty case,
  // instead of a hard failure.
  let parsedValue: unknown;
  try {
    parsedValue = JSON.parse(raw);
  } catch {
    return {};
  }
  const parsedResult = z.record(z.string(), z.unknown()).safeParse(parsedValue);
  if (!parsedResult.success) {
    return {};
  }
  const parsed = parsedResult.data;
  const result: RecognizedAccount = {};

  const nameResult = z.string().safeParse(parsed.accountName);
  if (nameResult.success) {
    const trimmed = nameResult.data.trim();
    if (trimmed) {
      result.accountName = trimmed;
    }
  }

  const lastFourResult = lastFourDigitsSchema.safeParse(
    parsed.accountLastFourDigits,
  );
  if (lastFourResult.success) {
    result.accountLastFourDigits = lastFourResult.data;
  }

  // Collect per-currency balances. Prefer the "balances" array; fall back to
  // a legacy single "balance"/"currency" pair so an older model response still
  // maps to one balance entry. Dedupe by currency (last wins) so a model that
  // repeats a currency can't produce duplicate rows. Invalid entries are
  // skipped (not fatal) so one bad row doesn't discard the rest.
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
  const balances = collected.reduce(mergeBalance, [] as AccountBalance[]);
  if (balances.length > 0) {
    result.balances = balances;
  }

  const kindResult = assetKindSchema.safeParse(parsed.kind);
  if (kindResult.success) {
    result.kind = kindResult.data;
  }

  return result;
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
): Promise<RecognizedAccount> {
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

  return parseRecognizedAccount(content);
}
