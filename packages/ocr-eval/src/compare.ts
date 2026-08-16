// Field-level comparison between a parser's output and a sample's gold
// `RecognizedAccount[]`. Mirrors how the app consumes recognition:
// - `accountName`: whitespace/case-insensitive match
// - `accountLastFourDigits`: exact 4-digit match (validated by the schema)
// - `balances`: multiset of {currency, balance} with a small price tolerance
// - `kind`: exact
// Optional fields that the gold *doesn't* require are allowed to be absent; a
// field present in gold but missing in output is a "miss" (reported, not a hard
// failure of other fields).
import type { AccountBalance, RecognizedAccount } from "@whole/ocr";

// Per-currency verdicts for the `balances` field, keyed by the currencies the
// GOLD names. The comparison already works currency by currency; reporting only
// the whole-account verdict meant the summary's per-currency buckets all read
// the same answer, so one wrong USD figure was reported as SGD and HKD failing
// too.
export type PerCurrencyResult = Record<string, boolean>;

export type FieldResult =
  | { status: "pass"; perCurrency?: PerCurrencyResult }
  | {
      status: "miss";
      expected: string;
      got: string | undefined;
      perCurrency?: PerCurrencyResult;
    }
  | {
      status: "mismatch";
      expected: string;
      got: string;
      perCurrency?: PerCurrencyResult;
    }
  // The gold asks for nothing here and the parser produced something. Reported
  // like any other failure — a gold is the whole expected output, not a subset
  // of it, so a field nobody asked for is a difference from it.
  | {
      status: "extra";
      expected: undefined;
      got: string;
      perCurrency?: PerCurrencyResult;
    };

export type AccountFieldKey =
  "name" | "lastFour" | "kind" | "institutionId" | "balances";

// One compared field, described once. Everything downstream — the comparison
// itself, the issue text, the baseline's failure keys, the eval summary's
// per-field aggregates — iterates this table, so adding a sixth compared field
// is one entry rather than an edit in four modules (which is how
// `institutionId` was added, and how one of them could have been missed:
// a field absent from the baseline's list silently drops out of the gate).
type ScalarAccountField = {
  key: Exclude<AccountFieldKey, "balances">;
  // How the issue line names the field.
  label: string;
  // Bucket name in the eval summary's per-field aggregates.
  bucket: string;
  // Reads the field off a gold or an output account.
  read: (account: RecognizedAccount) => string | undefined;
  // Applied to both sides before comparing, when the field is not exact-match.
  normalize?: (value: string) => string;
  // The parser sets this field on EVERY account it emits, so its presence in
  // the output says nothing — only its value can be wrong. Such a field is
  // never reported as `extra`: a gold omits whatever its author could not read
  // off the screenshot with confidence, so leaving `kind` out is routine, and
  // reporting that as the parser inventing a field failed the sample the moment
  // it was added.
  alwaysEmitted?: boolean;
};

export const ACCOUNT_FIELDS: readonly ScalarAccountField[] = [
  {
    key: "name",
    label: "name",
    bucket: "accountName",
    read: (account) => account.accountName,
    normalize: normalizeName,
  },
  {
    key: "lastFour",
    label: "last four",
    bucket: "lastFour",
    read: (account) => account.accountLastFourDigits,
  },
  {
    key: "kind",
    label: "kind",
    bucket: "kind",
    read: (account) => account.kind,
    alwaysEmitted: true,
  },
  {
    key: "institutionId",
    label: "institutionId",
    bucket: "institutionId",
    read: (account) => account.institutionId,
    alwaysEmitted: true,
  },
];

// The baseline key for one gold account's field. The gate's `resolved` vs
// `droppedCoverage` verdict — the difference between exit 0 and exit 2 —
// depends on `collectFailures` and `requiredFieldKeys` spelling these the same
// way, so they spell them here.
export function fieldKey(index: number, field: AccountFieldKey): string {
  return `${index}.${field}`;
}

// The same, for a verdict the gold never asked for. Kept apart so its
// disappearance reads as the parser improving rather than the gold shrinking.
export function extraFieldKey(index: number, field: AccountFieldKey): string {
  return `${fieldKey(index, field)}:extra`;
}

// Every compared field key in report order.
export const ACCOUNT_FIELD_KEYS: readonly AccountFieldKey[] = [
  ...ACCOUNT_FIELDS.map((field) => field.key),
  "balances",
];

export type AccountComparison = {
  // Whether the whole gold account was recognized with all required fields.
  pass: boolean;
  // Per-field results. A key is absent when the gold doesn't require that
  // field, which is what makes "not required" and "required and passing"
  // distinguishable downstream.
  fields: Partial<Record<AccountFieldKey, FieldResult>>;
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
// Compares a sample's gold accounts against the parser's output, one
// comparison per gold in gold order.
//
// Each output account is claimed by at most one gold. Without that, two golds
// that share no name and no last four both fell through to `outputAccounts[0]`
// and were compared against the SAME recognized account — so a screen whose
// second account was read completely wrong could still pass, including in the
// hard-assert golden test.
//
// Claimed in TIERS across all golds, not greedily gold by gold: the positional
// fallback is the weakest signal, so it must not consume an account that a
// later gold matches by name. Four current golds carry neither a name nor a
// last four, which is exactly the shape that would have run into this.
export function compareGolds(
  golds: RecognizedAccount[],
  outputAccounts: RecognizedAccount[],
): AccountComparison[] {
  const matchedIndexes = new Array<number | undefined>(golds.length);
  const claimed = new Set<number>();

  const claimTier = (
    matches: (gold: RecognizedAccount, output: RecognizedAccount) => boolean,
  ) => {
    golds.forEach((gold, goldIndex) => {
      if (matchedIndexes[goldIndex] !== undefined) {
        return;
      }
      const index = outputAccounts.findIndex(
        (output, i) => !claimed.has(i) && matches(gold, output),
      );
      if (index !== -1) {
        matchedIndexes[goldIndex] = index;
        claimed.add(index);
      }
    });
  };

  claimTier((gold, output) =>
    gold.accountName && output.accountName
      ? normalizeName(gold.accountName) === normalizeName(output.accountName)
      : false,
  );
  claimTier(
    (gold, output) =>
      !!gold.accountLastFourDigits &&
      gold.accountLastFourDigits === output.accountLastFourDigits,
  );
  // Last resort: whatever is left, in order.
  claimTier(() => true);

  return golds.map((gold, goldIndex) => {
    const index = matchedIndexes[goldIndex];
    return compareOneGold(
      gold,
      index === undefined ? undefined : outputAccounts[index],
    );
  });
}

// Compares one gold account against the recognized account it was matched to
// (`undefined` when the parser produced fewer accounts than the gold expects).
function compareOneGold(
  gold: RecognizedAccount,
  matched: RecognizedAccount | undefined,
): AccountComparison {
  const fields: Partial<Record<AccountFieldKey, FieldResult>> = {};
  const issues: string[] = [];
  const record = (
    key: AccountFieldKey,
    label: string,
    result: FieldResult | undefined,
  ) => {
    if (!result) {
      return; // not required by gold
    }
    fields[key] = result;
    if (result.status !== "pass") {
      issues.push(describeIssue(label, result));
    }
  };

  for (const field of ACCOUNT_FIELDS) {
    record(
      field.key,
      field.label,
      compareField(
        field.read(gold),
        matched && field.read(matched),
        field.normalize,
        field.alwaysEmitted,
      ),
    );
  }
  // `balances` is compared as a per-currency multiset rather than a string, so
  // it carries its own comparison; it still shares the key vocabulary above so
  // the report and the baseline treat it like any other field.
  record(
    "balances",
    "balances",
    compareBalances(gold.balances, matched?.balances),
  );

  // A field the gold doesn't require is absent from `fields` and therefore
  // implicitly satisfied; only required fields must pass.
  const pass = Object.values(fields).every((field) => field.status === "pass");

  return { pass, fields, issues };
}

// Whether a gold states a value for a field at all. The gate's two consumers —
// `compareField` here and `requiredFieldKeys` in run-eval — must agree on this
// or a fixed baselined failure is filed as `resolved` instead of
// `droppedCoverage`, which is the difference between exit 0 and exit 2.
export function goldRequires(value: string | undefined): value is string {
  return value !== undefined && value !== "";
}

function compareField(
  expected: string | undefined,
  got: string | undefined,
  normalize: (value: string) => string = (value) => value,
  alwaysEmitted = false,
): FieldResult | undefined {
  if (!goldRequires(expected)) {
    // The gold asks for nothing — but the parser producing something is still a
    // difference from the gold, and `test:ocr:golden` claims to assert exactly
    // this output. Four committed golds carry no `accountName`, so an invented
    // one used to pass both gates in silence.
    //
    // Except for a field the parser always emits: its presence carries no
    // information, so only a gold that names a DIFFERENT value can fail on it.
    return alwaysEmitted || got === undefined || got === ""
      ? undefined
      : { status: "extra", expected: undefined, got };
  }
  if (got === undefined || got === "") {
    return { status: "miss", expected, got };
  }
  if (normalize(expected) === normalize(got)) {
    return { status: "pass" };
  }
  return { status: "mismatch", expected, got };
}

function compareBalances(
  expected: AccountBalance[] | undefined,
  got: AccountBalance[] | undefined,
): FieldResult | undefined {
  if (!expected || expected.length === 0) {
    return !got || got.length === 0
      ? undefined
      : {
          status: "extra",
          expected: undefined,
          got: JSON.stringify(got),
          // Every currency the parser invented, so the summary's per-currency
          // table says WHICH money appeared out of nowhere. Without this the
          // whole balance section printed nothing for a sample that failed on
          // exactly that, while the mismatch path did record it.
          perCurrency: Object.fromEntries(
            got.map((balance) => [balance.currency, false]),
          ),
        };
  }
  if (!got || got.length === 0) {
    return {
      status: "miss",
      expected: JSON.stringify(expected),
      got: undefined,
      perCurrency: Object.fromEntries(
        expected.map((balance) => [balance.currency, false]),
      ),
    };
  }

  // Compare per-currency totals, within tolerance. BOTH sides are summed by
  // currency first: a gold can legitimately list one currency several times —
  // HSBC One holds three separate HKD sub-accounts — and comparing each of
  // those entries against the summed output reported a mismatch for a perfectly
  // correct reading.
  const sumByCurrency = (balances: AccountBalance[]) => {
    const totals = new Map<AccountBalance["currency"], number>();
    for (const b of balances) {
      totals.set(b.currency, (totals.get(b.currency) ?? 0) + b.balance);
    }
    return totals;
  };
  const byCurrency = sumByCurrency(got);
  const goldByCurrency = sumByCurrency(expected);

  const missing: string[] = [];
  const mismatched: string[] = [];
  const perCurrency: PerCurrencyResult = {};
  for (const [currency, goldSum] of goldByCurrency) {
    const gotSum = byCurrency.get(currency);
    if (gotSum === undefined) {
      missing.push(currency);
      perCurrency[currency] = false;
    } else if (Math.abs(gotSum - goldSum) > BALANCE_TOLERANCE) {
      mismatched.push(`${currency}: expected ${goldSum}, got ${gotSum}`);
      perCurrency[currency] = false;
    } else {
      perCurrency[currency] = true;
    }
  }
  // Extra currencies the parser produced but gold didn't expect are also a
  // mismatch — otherwise a parser that invents a wrong currency would pass.
  for (const gotCurrency of byCurrency.keys()) {
    if (!goldByCurrency.has(gotCurrency)) {
      mismatched.push(`unexpected currency: ${gotCurrency}`);
      // Recorded as its own failing bucket. Left out, a sample whose ONLY
      // failure was an invented currency printed every balance bucket green
      // while the gate failed it, and the invented currency appeared nowhere.
      perCurrency[gotCurrency] = false;
    }
  }

  if (missing.length === 0 && mismatched.length === 0) {
    return { status: "pass", perCurrency };
  }
  return {
    status: "mismatch",
    perCurrency,
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
    case "extra":
      return `${label}: gold expects none, got ${field.got}`;
    default:
      return "";
  }
}
