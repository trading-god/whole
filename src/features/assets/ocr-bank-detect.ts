// Bank detection: inspects a screenshot's OCR tokens to decide which bank's
// rule config the grouping step should run with. Runs after token labeling
// (so it can use token roles) and before grouping — a screenshot is routed to
// its bank's config (icon tags, equivalent-total pattern, product keywords)
// instead of every bank's rules mixing together.
//
// Signal priority: bank-name token (most reliable) > product name > account-
// number format > unknown fallback. "unknown" runs with `DEFAULT_CONFIG` (the
// shared rules every bank inherits), so an unrecognized bank degrades to the
// current global behavior rather than failing.
import {
  BANK_CONFIGS,
  DETECT_BANKS,
  DEFAULT_CONFIG,
  type AccountNumberPattern,
  type BankConfig,
  type BankId,
} from "./ocr-bank-config";
import type { TokenWithRole } from "./ocr-token-classify";

// Detects which bank a screenshot belongs to. Returns the bank id; "unknown"
// when no signal matches (the grouping step then runs with `DEFAULT_CONFIG`).
//
// Checks banks in declaration order; the first bank whose signal fires wins.
// Bank-name tokens win over product names because a standalone "DBS" is
// unambiguous, while "Multiplier" alone could (in principle) appear elsewhere.
//
// The two pass-wide derived strings — the trimmed-lowercase token set for
// standalone bank-name matching, and the joined-lowercase line text for
// product-name substring matching — are computed once up front rather than
// rebuilt per bank per pass.
export function detectBank(tokens: TokenWithRole[]): BankId {
  const tokenNames = new Set(tokens.map((t) => t.text.trim().toLowerCase()));
  const joined = tokens
    .map((t) => t.text)
    .join(" ")
    .toLowerCase();

  // A standalone "DBS"/"OCBC" token is the strongest signal.
  const hasBankName = (names: string[] | undefined) =>
    names !== undefined && names.some((n) => tokenNames.has(n.toLowerCase()));
  // "360 Account", "Global Savings", "Multiplier" — these survive even when
  // the bank-name token itself isn't on screen (e.g. scrolled out).
  const hasProduct = (products: string[] | undefined) =>
    products !== undefined &&
    products.some((p) => joined.includes(p.toLowerCase()));
  // A weak signal (DBS and OCBC share the SG hyphen format), used only to
  // narrow when name/product signals are absent.
  const hasNumberFormat = (patterns: AccountNumberPattern[] | undefined) =>
    patterns !== undefined &&
    tokens.some((t) => patterns.some((p) => p.regex.test(t.text)));

  for (const bankId of DETECT_BANKS) {
    if (hasBankName(BANK_CONFIGS[bankId].detect.bankNameTokens)) {
      return bankId;
    }
  }
  for (const bankId of DETECT_BANKS) {
    if (hasProduct(BANK_CONFIGS[bankId].detect.productNames)) {
      return bankId;
    }
  }
  // Account-number format is a last resort and only narrows to banks that
  // declare the pattern — it can't distinguish DBS from OCBC (both SG), so it's
  // only useful when exactly one bank declares a matching format. In practice
  // the product-name pass above has already resolved SG banks, so this rarely
  // fires; it's here for forward compatibility (a bank with a unique format
  // and no product name on screen).
  const matchingBanks = DETECT_BANKS.filter((bankId) =>
    hasNumberFormat(BANK_CONFIGS[bankId].detect.accountNumberPatterns),
  );
  if (matchingBanks.length === 1) {
    return matchingBanks[0];
  }
  return "unknown";
}

// Resolves the full `BankConfig` to run with, given detected tokens. Merges the
// detected bank's overrides on top of `DEFAULT_CONFIG` — so a bank only has to
// declare what it changes (icon tags, product keywords, account-number
// formats), and shared rules (equivalent-total pattern, default noise tokens)
// are inherited. "unknown" returns `DEFAULT_CONFIG` unchanged.
export function resolveBankConfig(tokens: TokenWithRole[]): {
  bankId: BankId;
  config: BankConfig;
} {
  const bankId = detectBank(tokens);
  const bank = BANK_CONFIGS[bankId];
  if (bankId === "unknown") {
    return { bankId, config: DEFAULT_CONFIG };
  }
  // Layer the bank's overrides on the shared defaults. `equivalentTotalPattern`
  // and other omitted fields fall through to the default.
  return {
    bankId,
    config: {
      ...DEFAULT_CONFIG,
      ...bank,
      // Merge nested detect/noiseTokens rather than replacing — a bank's
      // detection signals are additive to the defaults.
      detect: { ...DEFAULT_CONFIG.detect, ...bank.detect },
    },
  };
}
