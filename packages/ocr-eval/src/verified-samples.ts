// Samples whose `expected.json` has been verified against the source
// screenshot, field by field — institution, account names, per-currency
// balances, last four.
//
// Two golds were corrected during that pass, both mis-readings of an account
// number's tail by the (since removed) LLM annotator: hsbc-hk-one's last four
// was 0833 for account 661-796201-833 (correct: 1833), and hsbc-sg-overview's
// was 8221 for 145-742482-221 (correct: 2221). That 15/17 hit rate, on the
// field a person can check fastest, is why a gold reaches this list only by eye.
//
// The list has two readers, and that is the point of it being a module rather
// than a constant inside the test: `golden.test.ts` hard-asserts these golds,
// and `vision.ts` refuses to regenerate their fixtures without `--force`. A
// gold that is asserted but freely re-recorded is a gate that can rewrite its
// own answer.
export const VERIFIED_SAMPLES = [
  "alipay-overview",
  "bitget-cex-overview",
  "bitget-dex-overview",
  "boc-hk-overview",
  "ccb-overview",
  "cmb-overview",
  "cmb-wing-lung-overview",
  "dbs-multiplier",
  "hsbc-hk-one",
  "hsbc-hk-pulse",
  "hsbc-sg-overview",
  "ibkr-overview",
  "ocbc-365",
  "ocbc-overview",
  "ocbc-partial-overview",
  "okx-cex-overview",
  "trust-overview",
] as const;

export const isVerifiedSample = (slug: string): boolean =>
  (VERIFIED_SAMPLES as readonly string[]).includes(slug);
