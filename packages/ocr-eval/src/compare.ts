// Field-level comparison between a parser's output and a sample's gold
// `RecognizedAccount[]`. Mirrors how the app consumes recognition:
// - `accountName`: whitespace/case-insensitive match
// - `accountLastFourDigits`: exact 4-digit match (validated by the schema)
// - `balances`: multiset of {currency, balance} with a small price tolerance
// - `kind`: exact
// Optional fields that the gold *doesn't* require are allowed to be absent; a
// field present in gold but missing in output is a "miss" (reported, not a hard
// failure of other fields).
import type { AccountBalance } from "@/features/assets/account-balance-schema";
import type { RecognizedAccount } from "@/features/assets/recognition-types";

export type FieldResult =
  | { status: "pass" }
  | { status: "miss"; expected: string; got: string | undefined }
  | { status: "mismatch"; expected: string; got: string };

export type AccountComparison = {
  // Whether the whole gold account was recognized with all required fields.
  pass: boolean;
  // Account-level required fields (name / last four / kind) results.
  name?: FieldResult;
  lastFour?: FieldResult;
  kind?: FieldResult;
  balances?: FieldResult;
  // Any per-field mismatch detail, for the trace.
  issues: string[];
};

export type SampleComparison = {
  sample: string;
  accounts: AccountComparison[];
  pass: boolean;
  // Whether the parser produced the right NUMBER of accounts.
  count: { expected: number; got: number };
};

const BALANCE_TOLERANCE = 0.01;

function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

// Compares one gold account against the parser's accounts. The gold account is
// "met" when an output account covers all its required fields; extra output
// accounts are OK (multi-account screenshots legitimately produce several).
export function compareOneGold(
  gold: RecognizedAccount,
  outputAccounts: RecognizedAccount[],
): AccountComparison {
  const issues: string[] = [];

  // Find the output account that best matches this gold account, preferring
  // one whose name matches, else the first with the same last four, else the
  // first with any overlap.
  const nameMatch = outputAccounts.find((a) =>
    a.accountName && gold.accountName
      ? normalizeName(a.accountName) === normalizeName(gold.accountName)
      : false,
  );
  const lastFourMatch =
    nameMatch ??
    outputAccounts.find(
      (a) =>
        a.accountLastFourDigits &&
        gold.accountLastFourDigits &&
        a.accountLastFourDigits === gold.accountLastFourDigits,
    );
  const matched = lastFourMatch ?? outputAccounts[0] ?? null;

  const name = compareField("name", gold.accountName, matched?.accountName);
  const lastFour = compareField(
    "last four",
    gold.accountLastFourDigits,
    matched?.accountLastFourDigits,
  );
  const kind = compareField("kind", gold.kind, matched?.kind);
  const balances = compareBalances(gold.balances, matched?.balances);

  for (const [label, field] of [
    ["name", name],
    ["last four", lastFour],
    ["kind", kind],
    ["balances", balances],
  ] as const) {
    if (field?.status === "miss" || field?.status === "mismatch") {
      issues.push(describeIssue(label, field));
    }
  }

  // A field the gold doesn't require (undefined) is implicitly satisfied; only
  // required fields (non-empty gold value) must pass.
  const fieldsPass = [name, lastFour, kind, balances].every(
    (field) => field === undefined || field.status === "pass",
  );

  return { pass: fieldsPass, name, lastFour, kind, balances, issues };
}

function compareField(
  label: string,
  expected: string | undefined,
  got: string | undefined,
): FieldResult | undefined {
  if (expected === undefined || expected === "") {
    return undefined; // not required by gold
  }
  if (got === undefined || got === "") {
    return { status: "miss", expected, got };
  }
  if (label === "name") {
    if (normalizeName(expected) === normalizeName(got)) {
      return { status: "pass" };
    }
  } else {
    if (expected === got) {
      return { status: "pass" };
    }
  }
  return { status: "mismatch", expected, got };
}

function compareBalances(
  expected: AccountBalance[] | undefined,
  got: AccountBalance[] | undefined,
): FieldResult | undefined {
  if (!expected || expected.length === 0) {
    return undefined;
  }
  if (!got || got.length === 0) {
    return {
      status: "miss",
      expected: JSON.stringify(expected),
      got: undefined,
    };
  }

  // Multiset comparison by currency, within tolerance.
  const byCurrency = new Map<AccountBalance["currency"], number>();
  for (const b of got) {
    byCurrency.set(b.currency, (byCurrency.get(b.currency) ?? 0) + b.balance);
  }

  const missing: string[] = [];
  const mismatched: string[] = [];
  const expectedCurrencies = new Set(expected.map((b) => b.currency));
  for (const gold of expected) {
    const gotSum = byCurrency.get(gold.currency);
    if (gotSum === undefined) {
      missing.push(gold.currency);
    } else if (Math.abs(gotSum - gold.balance) > BALANCE_TOLERANCE) {
      mismatched.push(
        `${gold.currency}: expected ${gold.balance}, got ${gotSum}`,
      );
    }
  }
  // Extra currencies the parser produced but gold didn't expect are also a
  // mismatch — otherwise a parser that invents a wrong currency would pass.
  for (const gotCurrency of byCurrency.keys()) {
    if (!expectedCurrencies.has(gotCurrency)) {
      mismatched.push(`unexpected currency: ${gotCurrency}`);
    }
  }

  if (missing.length === 0 && mismatched.length === 0) {
    return { status: "pass" };
  }
  return {
    status: "mismatch",
    expected: JSON.stringify(expected),
    got: JSON.stringify(got),
  };
}

function describeIssue(label: string, field: FieldResult): string {
  switch (field.status) {
    case "miss":
      return `${label}: missing (expected ${field.expected})`;
    case "mismatch":
      return `${label}: expected ${field.expected}, got ${field.got}`;
    default:
      return "";
  }
}
