// Institution detection: inspects a screenshot's OCR tokens to decide which
// institution's rule config the grouping step should run with. Runs after token
// labeling (so it can use token roles) and before grouping — a screenshot is
// routed to its institution's config (icon tags, equivalent-total pattern,
// product keywords) instead of every institution's rules mixing together.
//
// An institution is a bank, a crypto exchange, or a broker — detection covers
// all three.
//
// Signal priority: institution-name token (most reliable) > product name >
// account-number format > unknown fallback. "unknown" runs with
// `DEFAULT_CONFIG` (the shared rules every institution inherits), so an
// unrecognized institution degrades to the current global behavior rather than
// failing.
import {
  INSTITUTION_CONFIGS,
  DETECT_INSTITUTIONS,
  DEFAULT_CONFIG,
  type InstitutionConfig,
} from "./config";
import type { InstitutionId } from "../contract/institution";
import { boundedPatternSource } from "../text";
import type { TokenWithRole } from "../engine/token-classify";

// Detects which institution a screenshot belongs to. Returns the institution
// id; "unknown" when no signal matches (the grouping step then runs with
// `DEFAULT_CONFIG`).
//
// Checks institutions in declaration order; the first institution whose signal
// fires wins. Institution-name tokens win over product names because a
// standalone "DBS" is unambiguous, while "Multiplier" alone could (in
// principle) appear elsewhere.
//
// The two pass-wide derived strings — the trimmed-lowercase token set for
// standalone institution-name matching, and the joined-lowercase line text for
// product-name substring matching — are computed once up front rather than
// rebuilt per institution per pass.
// One pattern per institution matching ANY of its product names, rather than
// one pattern per name. The product tier is swept across every institution for
// every line, so per-name patterns meant products × lines regex tests per
// screenshot; an alternation makes it one test per line per institution.
//
// `boundedPatternSource` owns the boundary rule for both alphabets: an all-ASCII
// name gets `\b`, a name containing Han characters ("汇丰one", "储蓄罐") gets
// none, because `\b` doesn't fire around CJK. The boundaries matter because
// short product names exist — OCBC's "gsa"/"sts" icon codes were matching inside
// "trusts", "costs", "interests", and since this tier sweeps every institution,
// OCBC won detection on any screen listing a REIT.
//
// Keyed on the array's identity: every `productNames` is a module-level literal
// in `config.ts`, so one entry per institution is all this can ever hold.
const productPatternCache = new Map<readonly string[], RegExp>();

function productPattern(
  productNames: readonly string[] | undefined,
): RegExp | undefined {
  if (!productNames || productNames.length === 0) {
    return undefined;
  }
  let re = productPatternCache.get(productNames);
  if (!re) {
    re = new RegExp(
      productNames
        .map((product) => boundedPatternSource(product.toLowerCase()))
        .join("|"),
    );
    productPatternCache.set(productNames, re);
  }
  return re;
}

export function detectInstitution(lines: TokenWithRole[][]): InstitutionId {
  const tokens = lines.flat();
  // Each standalone token's text mapped to how high it sits on screen. The
  // position decides between two institutions that both name themselves: an
  // exchange screen listing 支付宝 as a funding method names BOTH, and
  // declaration order gave it to Alipay — flipping the account's kind from
  // crypto to investment and offering "支付宝" as the group name. The app that
  // owns the screen signs it at the top; a payment method is listed below.
  const tokenTop = new Map<string, number>();
  for (const token of tokens) {
    const key = token.text.trim().toLowerCase();
    const top = Math.min(
      token.box.y,
      tokenTop.get(key) ?? Number.POSITIVE_INFINITY,
    );
    tokenTop.set(key, top);
  }
  // Per LINE, not one string for the whole screen. Joined across lines, a
  // multi-word product name could be assembled out of two unrelated rows —
  // "Acme Global" above "Savings Rates" spelled OCBC's "global savings" and
  // routed the screenshot to OCBC's config, currency and group name.
  const lineTexts = lines.map((line) =>
    line
      .map((t) => t.text)
      .join(" ")
      .toLowerCase(),
  );

  // A standalone "DBS"/"OCBC" token is the strongest signal. Returns how high
  // the highest matching token sits, or undefined when none matches.
  const institutionNameTop = (detect: InstitutionConfig["detect"]) => {
    const tops = (detect.institutionNameTokens ?? [])
      .map((name) => tokenTop.get(name.toLowerCase()))
      .filter((top): top is number => top !== undefined);
    return tops.length === 0 ? undefined : Math.min(...tops);
  };
  // "360 Account", "Global Savings", "Multiplier" — these survive even when
  // the institution-name token itself isn't on screen (e.g. scrolled out).
  const hasProduct = (detect: InstitutionConfig["detect"]) => {
    const pattern = productPattern(detect.productNames);
    return pattern ? lineTexts.some((text) => pattern.test(text)) : false;
  };
  // A weak signal (DBS and OCBC share the SG hyphen format), used only to
  // narrow when name/product signals are absent.
  const hasNumberFormat = (detect: InstitutionConfig["detect"]) =>
    detect.accountNumberPatterns?.some((re) =>
      tokens.some((token) => re.test(token.text)),
    ) ?? false;

  // Each tier below is swept across ALL institutions before the next one
  // starts, so a strong signal anywhere beats a weak signal earlier in the list.

  // Highest name token wins; ties keep declaration order.
  let byName: InstitutionId | undefined;
  let byNameTop = Number.POSITIVE_INFINITY;
  for (const id of DETECT_INSTITUTIONS) {
    const top = institutionNameTop(INSTITUTION_CONFIGS[id].detect);
    if (top !== undefined && top < byNameTop) {
      byName = id;
      byNameTop = top;
    }
  }
  if (byName) {
    return byName;
  }
  const byProduct = DETECT_INSTITUTIONS.find((id) =>
    hasProduct(INSTITUTION_CONFIGS[id].detect),
  );
  if (byProduct) {
    return byProduct;
  }
  // Account-number format is a last resort and only narrows to institutions
  // that declare the pattern — it can't distinguish DBS from OCBC (both SG), so
  // it's only useful when exactly one institution declares a matching format.
  // In practice the product-name pass above has already resolved SG banks, so
  // this rarely fires; it's here for forward compatibility (an institution with
  // a unique format and no product name on screen).
  const byNumberFormat = DETECT_INSTITUTIONS.filter((id) =>
    hasNumberFormat(INSTITUTION_CONFIGS[id].detect),
  );
  return byNumberFormat.length === 1 ? byNumberFormat[0] : "unknown";
}

// Resolves the full `InstitutionConfig` to run with, given detected tokens.
// Merges the detected institution's overrides on top of `DEFAULT_CONFIG` — so
// an institution only has to declare what it changes (icon tags, product
// keywords, account-number formats) and inherits the rest, currently the shared
// equivalent-total pattern. "unknown" returns `DEFAULT_CONFIG` unchanged.
//
// The word lists every institution inherits are NOT merged here: they are the
// engine's own vocabulary (`engine/vocabulary.ts`), not config.
export function resolveInstitutionConfig(lines: TokenWithRole[][]): {
  institutionId: InstitutionId;
  config: InstitutionConfig;
} {
  const institutionId = detectInstitution(lines);
  // Layer the institution's overrides on the shared defaults;
  // `equivalentTotalPattern` and other omitted fields fall through to the
  // default. "unknown" needs no special case — its config IS `DEFAULT_CONFIG`,
  // so the spread returns the defaults unchanged.
  //
  // `detect` is merged a level deeper. It is the one nested field, and every
  // institution declares it — so a shallow spread would REPLACE it, and the day
  // a shared default lands in `DEFAULT_CONFIG.detect` all fourteen would
  // silently stop inheriting it.
  const overrides = INSTITUTION_CONFIGS[institutionId];
  return {
    institutionId,
    config: {
      ...DEFAULT_CONFIG,
      ...overrides,
      detect: { ...DEFAULT_CONFIG.detect, ...overrides.detect },
    },
  };
}
