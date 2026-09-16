import { describe, expect, it, vi } from "vitest";

import { row, screen } from "../test-support/screen";
import {
  MAX_RECOGNITION_ATTEMPTS,
  MAX_REGION_NUMBER,
  recognizeWithModel,
  type RecognitionAttempt,
} from "./recognize";

// An OCBC-shaped screen: name, number (whose tail four IS mechanical here),
// and one balance. The engine — not the model — is what reads all three, so
// every test's baseline is what `parseOcrBlocks` returns for the same screen.
const BLOCKS = screen(
  row("360", "Account"),
  row("624-680187-001"),
  row("可用余额", "6,672.59", "SGD"),
);

type Annotation = Record<string, unknown>;

// `homeCurrency` is REQUIRED by the contract, so an object answer here is
// completed with "none" unless the case is about the currency — that is the
// neutral, contract-holding answer, and spelling it out in every unrelated
// case would bury what each one is actually testing. A case that needs a
// contract VIOLATION passes a raw string instead, which this leaves untouched.
const wellFormed = (answer: Annotation): Annotation => ({
  homeCurrency: "none",
  institution: { displayName: "unknown" },
  ...answer,
});

// The STRUCTURE turn's answer shape. A screen whose institution nothing knows
// takes that turn instead of the annotation one, so its cases answer with line
// numbers rather than region numbers — and `wellFormed` completes the same two
// required fields either way.
type Assigned = {
  name: number;
  number?: number;
  balance?: number[];
  kind?: string;
};

const assigning = (...accounts: Assigned[]): Annotation => ({
  accounts: accounts.map((account) => ({
    number: 0,
    balance: [],
    kind: "unknown",
    ...account,
  })),
});

const answering = (...answers: (string | Annotation)[]) => {
  const runModel = vi.fn<(attempt: RecognitionAttempt) => Promise<string>>();
  const encode = (answer: string | Annotation) =>
    typeof answer === "string" ? answer : JSON.stringify(wellFormed(answer));
  for (const answer of answers) {
    runModel.mockResolvedValueOnce(encode(answer));
  }
  const last = answers[answers.length - 1];
  runModel.mockResolvedValue(encode(last ?? {}));
  return runModel;
};

describe("recognizeWithModel", () => {
  it("returns the engine's structure whatever the model answers", async () => {
    const outcome = await recognizeWithModel(
      BLOCKS,
      answering({ accounts: [] }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      throw new Error("unreachable");
    }
    expect(outcome.recognition.accounts).toHaveLength(1);
    expect(outcome.recognition.accounts[0]?.accountName).toBe("360 Account");
    expect(outcome.recognition.accounts[0]?.balances).toEqual([
      { currency: "SGD", balance: 6672.59 },
    ]);
    expect(outcome.recognition.accounts[0]?.kind).toBe("cash");
  });

  // "360 Account" on a detected institution: the engine's kind came from a
  // keyword/institution prior, so the model's answer does not outrank it.
  it("keeps the engine's kind where the engine had a signal", async () => {
    const outcome = await recognizeWithModel(
      BLOCKS,
      answering({ accounts: [{ group: 1, kind: "investment" }] }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      throw new Error("unreachable");
    }
    expect(outcome.recognition.accounts[0]?.kind).toBe("cash");
  });

  // A name the keyword vocabulary does not know, on a screen no institution
  // config claims: the engine defaulted to cash, and the model's semantic
  // read is the only signal there is.
  it("honours the model's kind where the engine had to guess", async () => {
    const UNCLAIMED = screen(
      row("我的钱包"),
      row("可用余额", "6,672.59", "SGD"),
    );
    const outcome = await recognizeWithModel(
      UNCLAIMED,
      answering(assigning({ name: 1, balance: [2], kind: "investment" })),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      throw new Error("unreachable");
    }
    expect(outcome.recognition.accounts[0]?.kind).toBe("investment");
  });

  // `unknown` is how the model declines a kind. The field is required so the
  // grammar cannot let it be skipped silently, which only works if declining
  // leaves the engine's answer alone rather than overwriting it.
  it("leaves the engine's kind alone when the model answers unknown", async () => {
    const UNCLAIMED = screen(
      row("我的钱包"),
      row("可用余额", "6,672.59", "SGD"),
    );
    const outcome = await recognizeWithModel(
      UNCLAIMED,
      answering(assigning({ name: 1, balance: [2], kind: "unknown" })),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      throw new Error("unreachable");
    }
    expect(outcome.recognition.accounts[0]?.kind).toBe("cash");
  });

  // A grammar-less runtime can still skip the key; the contract must reject it
  // rather than read the absence as "no region has a kind" and let every
  // account fall through to the engine's `cash` fallback unretried.
  it("retries an answer that omits the accounts array", async () => {
    const runModel = vi.fn<(attempt: RecognitionAttempt) => Promise<string>>();
    runModel.mockResolvedValue(
      JSON.stringify({
        institution: { displayName: "unknown" },
        homeCurrency: "none",
      }),
    );

    const outcome = await recognizeWithModel(BLOCKS, runModel);

    expect(outcome.ok).toBe(false);
    expect(runModel).toHaveBeenCalledTimes(MAX_RECOGNITION_ATTEMPTS);
    expect(outcome.ok === false && outcome.reason).toMatch(/accounts/);
  });

  it("drops annotations for a region the engine did not produce", async () => {
    const outcome = await recognizeWithModel(
      BLOCKS,
      answering({
        accounts: [
          { group: 7, kind: "crypto" },
          { group: 1, kind: "investment" },
        ],
      }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      throw new Error("unreachable");
    }
    expect(outcome.recognition.accounts).toHaveLength(1);
    // The surviving account keeps its engine kind — region 1's annotation is
    // evaluated, but on this detected-institution screen the engine's read
    // outranks it; region 7 does not exist.
    expect(outcome.recognition.accounts[0]?.kind).toBe("cash");
  });

  it("carries the institution through", async () => {
    const outcome = await recognizeWithModel(
      BLOCKS,
      answering({
        accounts: [],
        institution: { displayName: "OCBC", alternates: ["UOB"] },
      }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      throw new Error("unreachable");
    }
    expect(outcome.recognition.institution).toEqual({
      displayName: "OCBC",
      alternates: ["UOB"],
    });
  });

  it("reads the `unknown` sentinel as no institution", async () => {
    // The institution answer is required so the model cannot skip it — an
    // optional one was skipped outright by the bundled 2B. `unknown` is what
    // keeps "required" from being a demand to invent a name.
    const outcome = await recognizeWithModel(
      BLOCKS,
      answering({ accounts: [], institution: { displayName: "unknown" } }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      throw new Error("unreachable");
    }
    expect(outcome.recognition.institution).toBeUndefined();
    // The engine's own detection is untouched by the model declining.
    expect(outcome.recognition.accounts[0]?.institutionId).toBe("ocbc");
  });

  it("retries an answer that omits the institution entirely", async () => {
    const runModel = answering(
      JSON.stringify({ homeCurrency: "none", accounts: [] }),
      { institution: { displayName: "OCBC" }, accounts: [] },
    );
    const outcome = await recognizeWithModel(BLOCKS, runModel);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      throw new Error("unreachable");
    }
    expect(outcome.attempts).toBe(2);
    expect(runModel.mock.calls[1]?.[0].user).toContain("institution");
    expect(outcome.recognition.institution?.displayName).toBe("OCBC");
  });

  it("reads a whitespace-only institution name as absent, not a retry", async () => {
    // The grammar (minLength: 1) cannot forbid it, so accepting it in the
    // schema and reading it as "no institution" keeps grammar-legal answers
    // off the retry path.
    const outcome = await recognizeWithModel(
      BLOCKS,
      answering({ accounts: [], institution: { displayName: " " } }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      throw new Error("unreachable");
    }
    expect(outcome.recognition.institution).toBeUndefined();
  });

  it("hands the model the annotated screen and the annotation contract", async () => {
    const runModel = answering({ accounts: [] });

    await recognizeWithModel(BLOCKS, runModel);

    const attempt = runModel.mock.calls[0]?.[0] as unknown as {
      system: string;
      user: string;
    };
    expect(attempt.user).toContain("1| 360 Account");
    expect(attempt.user).toContain("·|");
    expect(attempt.system).toMatch(/institution/i);
  });

  it("hands the model a grammar compiled from the schema, identically every attempt", async () => {
    const runModel = answering("not json", "not json", { accounts: [] });

    await recognizeWithModel(BLOCKS, runModel);

    const [first, second, third] = runModel.mock.calls.map(
      (call) => (call[0] as unknown as { grammar: string }).grammar,
    );
    expect(first).toContain("root ::= ");
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  describe("retrying", () => {
    it("feeds the failure back and succeeds on the retry", async () => {
      const outcome = await recognizeWithModel(
        BLOCKS,
        answering("not json", { accounts: [] }),
      );

      expect(outcome.ok).toBe(true);
      if (!outcome.ok) {
        throw new Error("unreachable");
      }
      expect(outcome.attempts).toBe(2);
    });

    it("names a schema violation in the feedback", async () => {
      const runModel = answering(
        { accounts: [{ group: 1, kind: "property" }] },
        { accounts: [] },
      );

      await recognizeWithModel(BLOCKS, runModel);

      const secondAttempt = runModel.mock.calls[1]?.[0] as unknown as {
        user: string;
      };
      expect(secondAttempt.user).toMatch(/required shape/i);
      expect(secondAttempt.user).toMatch(/kind/);
    });

    it("gives up after three attempts", async () => {
      const outcome = await recognizeWithModel(
        BLOCKS,
        answering("not json", "not json", "not json"),
      );

      expect(outcome.ok).toBe(false);
      if (outcome.ok) {
        throw new Error("unreachable");
      }
      expect(outcome.attempts).toBe(MAX_RECOGNITION_ATTEMPTS);
    });

    it("reports why it gave up", async () => {
      const outcome = await recognizeWithModel(
        BLOCKS,
        answering("not json", "not json", "not json"),
      );

      expect(outcome.ok).toBe(false);
      if (outcome.ok) {
        throw new Error("unreachable");
      }
      expect(outcome.reason).toMatch(/not valid JSON/);
    });
  });

  it("never offers the model a region its grammar cannot name", async () => {
    // Past the bound the grammar makes a region number undecodable, so a kind
    // meant for region 70 could only come back as one in range — landing on a
    // different account. Those regions are left out of the prompt entirely.
    // Led by a brand token, because the region bound belongs to the ANNOTATION
    // turn — an unknown institution takes the structure turn instead, which
    // addresses lines rather than regions.
    const many = screen(
      row("OCBC"),
      ...Array.from({ length: 70 }, (_unused, index) => [
        row(`Account ${index + 1}`),
        row("可用余额", "1.00", "SGD"),
      ]).flat(),
    );
    const runModel = vi.fn<(attempt: RecognitionAttempt) => Promise<string>>();
    runModel.mockResolvedValue(
      JSON.stringify({
        institution: { displayName: "unknown" },
        homeCurrency: "none",
        accounts: [],
      }),
    );

    const outcome = await recognizeWithModel(many, runModel);

    expect(outcome.ok).toBe(true);
    const { user } = runModel.mock.calls[0]![0];
    // The engine read more regions than the grammar can address…
    expect(outcome.ok && outcome.recognition.accounts.length).toBeGreaterThan(
      MAX_REGION_NUMBER,
    );
    // …and the prompt stops numbering at the bound.
    expect(user).toContain(`Region ${MAX_REGION_NUMBER}:`);
    expect(user).not.toContain(`Region ${MAX_REGION_NUMBER + 1}:`);
  });

  it("does not ask the model about a screen with no accounts", async () => {
    // Loading three gigabytes to be told `[]` is waste on a good device and a
    // false "free up memory" on a tight one.
    const runModel = vi.fn<(attempt: RecognitionAttempt) => Promise<string>>();

    const outcome = await recognizeWithModel(screen(row("Settings")), runModel);

    expect(runModel).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      ok: true,
      recognition: { accounts: [] },
      attempts: 0,
    });
  });

  it("lets a transport failure propagate rather than retrying it", async () => {
    const runModel = vi.fn<(attempt: RecognitionAttempt) => Promise<string>>();
    runModel.mockRejectedValue(new Error("device out of memory"));

    await expect(recognizeWithModel(BLOCKS, runModel)).rejects.toThrow(
      /out of memory/,
    );
  });
});

// The home-currency question: the only answer that reaches a figure, and the
// largest single thing a missing institution config costs (`eval:ocr:ablate`).
describe("recognizeWithModel and the inferred home currency", () => {
  // A CMB-shaped screen: a bare figure with no currency anywhere, on an
  // institution the configs do not know. Without a currency the engine cannot
  // denominate the figure and drops it — the account survives with no balance.
  const BARE = screen(
    row("Acme", "Savings", "Account"),
    row("可用余额", "76,007.05"),
  );

  it("drops the bare figure when the model declines a currency", async () => {
    const outcome = await recognizeWithModel(
      BARE,
      answering({
        homeCurrency: "none",
        ...assigning({ name: 1, balance: [2], kind: "cash" }),
      }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      throw new Error("unreachable");
    }
    expect(outcome.recognition.accounts[0]?.accountName).toBe(
      "Acme Savings Account",
    );
    expect(outcome.recognition.accounts[0]?.balances).toBeUndefined();
  });

  it("denominates it in the currency the model inferred", async () => {
    const outcome = await recognizeWithModel(
      BARE,
      answering({
        homeCurrency: "CNY",
        ...assigning({ name: 1, balance: [2], kind: "cash" }),
      }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      throw new Error("unreachable");
    }
    expect(outcome.recognition.accounts[0]?.balances).toEqual([
      { currency: "CNY", balance: 76007.05 },
    ]);
  });

  it("assembles with the inferred currency in hand", async () => {
    // On the structure turn the currency is not stapled onto a finished
    // result — it is passed to the assembly, which denominates the figure as
    // it reads it. The account still keeps everything the ENGINE read (its
    // name, off the tokens), so the currency is the only thing the model
    // contributed to the balance.
    const outcome = await recognizeWithModel(
      BARE,
      answering({
        homeCurrency: "HKD",
        ...assigning({ name: 1, balance: [2], kind: "cash" }),
      }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      throw new Error("unreachable");
    }
    expect(outcome.recognition.accounts[0]).toMatchObject({
      accountName: "Acme Savings Account",
      kind: "cash",
      balances: [{ currency: "HKD", balance: 76007.05 }],
    });
  });

  it("never overrides a currency the screen itself stated", async () => {
    // `BLOCKS` says SGD on the row. A model answer cannot move a figure the
    // screen denominated — that is the engine's read, not an inference.
    const outcome = await recognizeWithModel(
      BLOCKS,
      answering({ homeCurrency: "CNY", accounts: [] }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      throw new Error("unreachable");
    }
    expect(outcome.recognition.accounts[0]?.balances).toEqual([
      { currency: "SGD", balance: 6672.59 },
    ]);
  });

  it("never overrides a currency the screen states BELOW the figure", async () => {
    // The case `redenominate` actually fires on: an institution with no
    // config, whose region leads with a bare figure and names its currency on
    // a later row. That row is the engine's real last resort here, and it is
    // still evidence from the screen — so it outranks the inference, which is
    // the difference between reporting a missing currency and reporting money
    // the user does not have.
    const statedBelow = screen(
      row("Acme", "Savings", "Account"),
      row("可用余额", "1,000.00"),
      row("美元账户", "500.00", "USD"),
    );

    const outcome = await recognizeWithModel(
      statedBelow,
      answering({
        homeCurrency: "HKD",
        ...assigning({ name: 1, balance: [2, 3], kind: "cash" }),
      }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      throw new Error("unreachable");
    }
    expect(outcome.recognition.accounts[0]?.balances).toEqual([
      { currency: "USD", balance: 1500 },
    ]);
  });

  it("never overrides a configured institution's own currency", async () => {
    // OCBC is configured SGD, and the figure here names no currency. The
    // config was written against a real screen; the model's answer is an
    // inference, and the inference loses.
    const ocbc = screen(row("OCBC"), row("360", "Account"), row("6,672.59"));
    const outcome = await recognizeWithModel(
      ocbc,
      answering({ homeCurrency: "CNY", accounts: [] }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      throw new Error("unreachable");
    }
    expect(outcome.recognition.accounts[0]?.balances).toEqual([
      { currency: "SGD", balance: 6672.59 },
    ]);
  });

  it("re-groups a configured institution that declares no currency", async () => {
    // `redenominate`'s own case, and the only shape left that reaches it: an
    // institution the configs DO know (so the annotation turn runs) but which
    // declares no `defaultCurrency`, because a crypto exchange holds many. The
    // engine drops the bare figure on the first pass and the screen has to be
    // grouped again with the inferred currency in hand — a currency cannot be
    // patched onto a balance that was never read.
    const exchange = screen(
      row("OKX"),
      row("Funding", "Account"),
      row("可用余额", "1,204.50"),
    );

    const outcome = await recognizeWithModel(
      exchange,
      answering({
        homeCurrency: "USD",
        accounts: [{ group: 1, kind: "crypto" }],
      }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      throw new Error("unreachable");
    }
    expect(outcome.recognition.accounts[0]?.balances).toEqual([
      { currency: "USD", balance: 1204.5 },
    ]);
  });

  it("retries an answer that omits the currency entirely", async () => {
    // The field is required precisely because an optional one was skipped: on
    // the real runtime the grammar cannot close the object without it, and
    // this is what catches a runtime that decodes without a grammar.
    const runModel = answering(
      JSON.stringify(assigning({ name: 1, balance: [2], kind: "cash" })),
      {
        homeCurrency: "CNY",
        ...assigning({ name: 1, balance: [2], kind: "cash" }),
      },
    );
    const outcome = await recognizeWithModel(BARE, runModel);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      throw new Error("unreachable");
    }
    expect(outcome.attempts).toBe(2);
    expect(runModel.mock.calls[1]?.[0].user).toContain("homeCurrency");
    expect(outcome.recognition.accounts[0]?.balances).toEqual([
      { currency: "CNY", balance: 76007.05 },
    ]);
  });

  it("rejects a currency the app cannot store", async () => {
    // The grammar makes this undecodable on a real runtime; the schema is what
    // catches it when a runner answers without one, and the loop retries with
    // the violation named rather than storing a currency the form cannot hold.
    const runModel = answering(
      {
        homeCurrency: "JPY",
        ...assigning({ name: 1, balance: [2], kind: "cash" }),
      },
      {
        homeCurrency: "CNY",
        ...assigning({ name: 1, balance: [2], kind: "cash" }),
      },
    );
    const outcome = await recognizeWithModel(BARE, runModel);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      throw new Error("unreachable");
    }
    expect(outcome.attempts).toBe(2);
    expect(outcome.recognition.accounts[0]?.balances).toEqual([
      { currency: "CNY", balance: 76007.05 },
    ]);
  });
});

// The STRUCTURE turn: what runs when the engine does not know the institution,
// and therefore cannot be trusted to have found the accounts. Every case here
// is a screen the rules read wrong on their own — `engineOnly` in each comment
// is what `parseOcrBlocks` makes of the same blocks.
describe("recognizeWithModel on an institution nothing knows", () => {
  // The layout the whole turn exists for: a section heading, then one row per
  // account carrying its name, its number and its figure together. The rules
  // open a region on the HEADING and bank every figure below it, so the screen
  // comes back as one account called "CHECKING" holding 3,204.57 + 18,750.00 —
  // money the screen never printed.
  const ONE_ROW_PER_ACCOUNT = screen(
    row("CHECKING"),
    row("Total", "Checking", "(...4821)", "$3,204.57"),
    row("Available", "balance"),
    row("SAVINGS"),
    row("Premier", "Savings", "(...9033)", "$18,750.00"),
  );

  it("splits one account per assigned row", async () => {
    const outcome = await recognizeWithModel(
      ONE_ROW_PER_ACCOUNT,
      answering(
        assigning(
          { name: 2, balance: [2], kind: "cash" },
          { name: 5, balance: [5], kind: "cash" },
        ),
      ),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      throw new Error("unreachable");
    }
    // "Checking", not "Total Checking": the token classifier marks a leading
    // "Total" as a summary marker and `nameTokensOf` drops it, even here where
    // the model has already said this row titles an account. That is kept
    // deliberately — relaxing it would let a misassigned "Total balance
    // $46,281.19" become an account holding the screen's grand total, and
    // `line-classify.ts` settled that trade already: inventing money is worse
    // than losing a title. The title is editable; the figure would not be
    // noticed.
    expect(outcome.recognition.accounts).toEqual([
      expect.objectContaining({
        accountName: "Checking",
        balances: [{ currency: "USD", balance: 3204.57 }],
      }),
      expect.objectContaining({
        accountName: "Premier Savings",
        balances: [{ currency: "USD", balance: 18750 }],
      }),
    ]);
  });

  it("refuses a figure a previous account already claimed", async () => {
    // Two accounts pointed at one row is how a screen's money gets counted
    // twice, which is the exact failure the rules produce here — so honouring
    // it would reintroduce the bug from the other side.
    const outcome = await recognizeWithModel(
      ONE_ROW_PER_ACCOUNT,
      answering(
        assigning(
          { name: 2, balance: [2], kind: "cash" },
          { name: 5, balance: [2, 5], kind: "cash" },
        ),
      ),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      throw new Error("unreachable");
    }
    expect(outcome.recognition.accounts[1]?.balances).toEqual([
      { currency: "USD", balance: 18750 },
    ]);
  });

  it("drops an assignment whose name line names no account", async () => {
    // "Available balance" is a field label. Opening a region for it would put
    // a nameless account on the form for the user to notice and delete.
    const outcome = await recognizeWithModel(
      ONE_ROW_PER_ACCOUNT,
      answering(
        assigning(
          { name: 3, balance: [2], kind: "cash" },
          { name: 5, balance: [5], kind: "cash" },
        ),
      ),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      throw new Error("unreachable");
    }
    expect(outcome.recognition.accounts).toHaveLength(1);
    expect(outcome.recognition.accounts[0]?.accountName).toBe(
      "Premier Savings",
    );
  });

  it("ignores a balance line the engine read no figure on", async () => {
    const outcome = await recognizeWithModel(
      ONE_ROW_PER_ACCOUNT,
      answering(assigning({ name: 2, balance: [3], kind: "cash" })),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      throw new Error("unreachable");
    }
    expect(outcome.recognition.accounts[0]?.balances).toBeUndefined();
  });

  it("ignores a line number that is not on the screen", async () => {
    const outcome = await recognizeWithModel(
      ONE_ROW_PER_ACCOUNT,
      answering(
        assigning(
          { name: 99, balance: [99], kind: "cash" },
          { name: 2, balance: [2], kind: "cash" },
        ),
      ),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      throw new Error("unreachable");
    }
    expect(outcome.recognition.accounts).toHaveLength(1);
    expect(outcome.recognition.accounts[0]?.accountName).toBe("Checking");
  });

  it("reads the last four off the line the model named", async () => {
    const numberOnItsOwnRow = screen(
      row("My", "Savings", "Account"),
      row("•••• 6210"),
      row("SGD", "27,411.09"),
    );

    const outcome = await recognizeWithModel(
      numberOnItsOwnRow,
      answering(assigning({ name: 1, number: 2, balance: [3], kind: "cash" })),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      throw new Error("unreachable");
    }
    expect(outcome.recognition.accounts[0]).toMatchObject({
      accountName: "My Savings Account",
      accountLastFourDigits: "6210",
      balances: [{ currency: "SGD", balance: 27411.09 }],
    });
  });

  it("refuses a line the vocabulary already knows is not a balance", async () => {
    // The assignment path's backstop, and the one failure mode this whole turn
    // exists to end. `finish` SUMS a group's pending balances, so three assigned
    // rows in one currency become one figure the screenshot never printed —
    // 238,914.62 + 412,330.18 + 61,204.95 = 712,449.75, arrived at through the
    // model instead of through the state machine. `nonBalanceMarkers` carries
    // the broker shelf precisely so both halves can refuse it.
    const broker = screen(
      row("Margin", "Account"),
      row("Net", "liquidation", "USD", "238,914.62"),
      row("Buying", "power", "USD", "412,330.18"),
      row("Maintenance", "margin", "USD", "61,204.95"),
    );

    const outcome = await recognizeWithModel(
      broker,
      answering(assigning({ name: 1, balance: [2, 3, 4], kind: "investment" })),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      throw new Error("unreachable");
    }
    expect(outcome.recognition.accounts[0]?.balances).toEqual([
      { currency: "USD", balance: 238914.62 },
    ]);
  });

  it("does not read a last four off a decimal quantity", async () => {
    // A crypto row's fraction is not a masked card number. The mask alphabet
    // carries a period so "(...4821)" reads, and the tail pattern takes a
    // single one because Vision collapses the ellipsis — so the guard is that
    // the mask may not FOLLOW a digit. Without it "0.02345678" came back as
    // last four "5678", and a wrong last four is worse than none: it is the
    // field account dedupe is keyed on.
    const wallet = screen(row("Bitcoin", "0.02345678"), row("USD", "1,204.55"));

    const outcome = await recognizeWithModel(
      wallet,
      answering(assigning({ name: 1, balance: [2], kind: "crypto" })),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      throw new Error("unreachable");
    }
    expect(
      outcome.recognition.accounts[0]?.accountLastFourDigits,
    ).toBeUndefined();
  });

  it("leaves out a figure the model did not call a balance", async () => {
    // The broker shape: a net figure and a shelf of well-formed money that is
    // not a balance. The rules sum all of it; naming only the balance line is
    // what keeps buying power out of the user's net worth.
    const broker = screen(
      row("Margin", "Account"),
      row("Net", "liquidation", "USD", "238,914.62"),
      row("Buying", "power", "USD", "412,330.18"),
      row("Maintenance", "margin", "USD", "61,204.95"),
    );

    const outcome = await recognizeWithModel(
      broker,
      answering(assigning({ name: 1, balance: [2], kind: "investment" })),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      throw new Error("unreachable");
    }
    expect(outcome.recognition.accounts[0]).toMatchObject({
      kind: "investment",
      balances: [{ currency: "USD", balance: 238914.62 }],
    });
  });

  it("marks the lines it read a figure on, and numbers every line", async () => {
    const runModel = answering(assigning({ name: 2, balance: [2] }));

    await recognizeWithModel(ONE_ROW_PER_ACCOUNT, runModel);

    const { user, system } = runModel.mock.calls[0]![0];
    expect(user).toContain("1|   CHECKING");
    expect(user).toMatch(/2\|\$# Total Checking/);
    expect(system).toMatch(/line numbers/i);
  });

  it("carries the institution the model named", async () => {
    const outcome = await recognizeWithModel(
      ONE_ROW_PER_ACCOUNT,
      answering({
        institution: { displayName: "Chase" },
        homeCurrency: "USD",
        ...assigning({ name: 2, balance: [2] }),
      }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      throw new Error("unreachable");
    }
    expect(outcome.recognition.institution?.displayName).toBe("Chase");
  });

  it("does not ask the model about a screen with no figures on it", async () => {
    const runModel = vi.fn<(attempt: RecognitionAttempt) => Promise<string>>();

    const outcome = await recognizeWithModel(
      screen(row("Settings"), row("Notifications")),
      runModel,
    );

    expect(runModel).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      ok: true,
      recognition: { accounts: [] },
      attempts: 0,
    });
  });

  it("gives up rather than falling back to the rules' read", async () => {
    // The rules read this screen as one account holding the sum of both, and
    // that figure appears nowhere on it. A missing balance beats a wrong one —
    // the same rule `convertCurrency` follows when it returns null instead of 0.
    const outcome = await recognizeWithModel(
      ONE_ROW_PER_ACCOUNT,
      answering("not json", "not json", "not json"),
    );

    expect(outcome.ok).toBe(false);
  });

  it("returns nothing when the model assigns nothing", async () => {
    const outcome = await recognizeWithModel(
      ONE_ROW_PER_ACCOUNT,
      answering(assigning()),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      throw new Error("unreachable");
    }
    expect(outcome.recognition.accounts).toEqual([]);
  });
});
