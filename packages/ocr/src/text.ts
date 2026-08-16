// Text utilities with no opinion about recognition — usable from any layer of
// the package (`contract/`, `engine/`, `institutions/`) without creating a
// dependency between them.

// Escapes a string for literal use inside a `RegExp`.
//
// Three copies of this expression existed — two in `amount.ts`, one in
// `institutions/detect.ts` — each building a pattern out of text the engine did
// not write: an OCR'd currency token, a configured product name. They can only
// stay in step by being one function; a metacharacter added to one copy left
// the others quietly building a different pattern.
//
// `-` and `/` are deliberately absent: neither is a metacharacter outside a
// character class, and escaping them is what makes an escaped string fail under
// the `u` flag.
export function escapeRegExp(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

// A keyword as regex source: escaped, and bounded ONLY where there is a word
// character to bound.
//
// Both halves are load-bearing, and both were learned the hard way. Unescaped,
// an "hsbc live+" product compiles to `live+` and matches "livee", and
// "e.Savings" makes the `.` a wildcard. Bounded unconditionally, that same
// trailing `\b` after the "+" demands a word character right after it — a
// signal that can never fire on a real screen. Unbounded, "fund" matches inside
// "Refund policy" and "card" inside "Mastercard promotions", so a disclaimer
// opens an account and takes the figure beside it.
//
// A CJK keyword gets no boundary at all: `\b` never fires between two Han
// characters, so those stay substring matches.
//
// Written twice before this — `institutions/detect.ts` for product names,
// `engine/vocabulary.ts` for account keywords — with the same lesson in a
// comment on each. The boundary rule is the harder half of the pair
// `escapeRegExp` was already centralized for; split across two files, the next
// refinement would have landed in one tier and left the other disagreeing about
// which rows open an account.
export function boundedPatternSource(keyword: string): string {
  const lead = /^\w/.test(keyword) ? String.raw`\b` : "";
  const trail = /\w$/.test(keyword) ? String.raw`\b` : "";
  // NOT plural-tolerant, and that is a decision rather than an oversight.
  //
  // A plural title is genuinely missed: "Structured Deposits" does not match
  // `\bdeposit\b`, so its row joins the account ABOVE it and adds its money to
  // that account's balance. Allowing `s?` fixes that — and hands every
  // navigation bar an account: `Accounts`, `Cards`, `Funds`, `Statements` are
  // the literal tab labels on DBS, OCBC, HSBC and Trust, and the account-keyword
  // test is the ONLY thing separating a title row from scaffolding. Measured on
  // the real Trust action bar this corpus already records ("存入资金 PayNow
  // 储蓄罐 Statements"), placing it between a title and its balance deleted the
  // account 储蓄户口 outright and re-titled its 2,845.42 after the buttons.
  //
  // Both errors misplace money; only the second also destroys the account's
  // identity, and nav bars are on every screenshot while no plural account
  // title appears in any of the seventeen. Separating "My Cards" from "Cards"
  // needs a signal this vocabulary does not carry — the qualifier, not the
  // plural — so the safer error is kept until there is one.
  return `${lead}${escapeRegExp(keyword)}${trail}`;
}
