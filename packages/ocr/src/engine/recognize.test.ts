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
      answering({ accounts: [{ group: 1, kind: "investment" }] }),
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
      answering({ accounts: [{ group: 1, kind: "unknown" }] }),
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
    const many = screen(
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
      answering({ homeCurrency: "none", accounts: [] }),
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
      answering({ homeCurrency: "CNY", accounts: [] }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      throw new Error("unreachable");
    }
    expect(outcome.recognition.accounts[0]?.balances).toEqual([
      { currency: "CNY", balance: 76007.05 },
    ]);
  });

  it("re-reads the screen rather than patching the result", async () => {
    // The proof that it is a second PASS: the account keeps everything the
    // first pass read (name, region identity), not just a currency stapled on.
    const outcome = await recognizeWithModel(
      BARE,
      answering({
        homeCurrency: "HKD",
        accounts: [{ group: 1, kind: "cash" }],
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
      answering({ homeCurrency: "HKD", accounts: [] }),
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

  it("retries an answer that omits the currency entirely", async () => {
    // The field is required precisely because an optional one was skipped: on
    // the real runtime the grammar cannot close the object without it, and
    // this is what catches a runtime that decodes without a grammar.
    const runModel = answering(JSON.stringify({ accounts: [] }), {
      homeCurrency: "CNY",
      accounts: [],
    });
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
      { homeCurrency: "JPY", accounts: [] },
      { homeCurrency: "CNY", accounts: [] },
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
