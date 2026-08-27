import { describe, expect, it, vi } from "vitest";

import { row, screen } from "../test-support/screen";
import { MAX_RECOGNITION_ATTEMPTS, recognizeWithModel } from "./recognize";

const BLOCKS = screen(row("360 Account"), row("可用余额", "6,672.59", "SGD"));

// Indices into BLOCKS: 0 name, 1 label, 2 amount, 3 currency.
const GOOD_ANSWER = JSON.stringify({
  accounts: [
    {
      nameBlocks: [0],
      balances: [{ amountBlock: 2, currencyBlock: 3 }],
    },
  ],
});

const answering = (...answers: string[]) => {
  const runModel = vi.fn<(attempt: { user: string }) => Promise<string>>();
  for (const answer of answers) {
    runModel.mockResolvedValueOnce(answer);
  }
  runModel.mockResolvedValue(answers[answers.length - 1] ?? "{}");
  return runModel;
};

describe("recognizeWithModel", () => {
  it("resolves the accounts on the first attempt", async () => {
    const outcome = await recognizeWithModel(BLOCKS, answering(GOOD_ANSWER));

    expect(outcome.ok).toBe(true);
    expect(outcome.ok && outcome.recognition.accounts).toEqual([
      {
        accountName: "360 Account",
        accountLastFourDigits: undefined,
        balances: [{ currency: "SGD", balance: 6672.59 }],
        kind: undefined,
      },
    ]);
    expect(outcome.attempts).toBe(1);
  });

  it("hands the model the serialized screen and the output contract", async () => {
    const runModel = answering(GOOD_ANSWER);

    await recognizeWithModel(BLOCKS, runModel);

    const attempt = runModel.mock.calls[0]?.[0] as unknown as {
      system: string;
      user: string;
      schemaName: string;
      schema: unknown;
    };
    expect(attempt.user).toContain('#0 "360 Account"');
    expect(attempt.system).toMatch(/index/i);
    expect(attempt.schemaName).toBe("recognized_accounts");
    expect(attempt.schema).toBeTruthy();
  });

  // Prompt mode has nothing enforcing the shape, and a model told to return
  // JSON very often returns it inside a code fence. Failing on that would
  // retry three times over punctuation.
  it.each([
    ["a fenced block", "```json\n" + GOOD_ANSWER + "\n```"],
    ["an unlabelled fence", "```\n" + GOOD_ANSWER + "\n```"],
    ["surrounding prose", `Here you go:\n${GOOD_ANSWER}\nHope that helps.`],
  ])("reads an answer wrapped in %s", async (_label, answer) => {
    const outcome = await recognizeWithModel(BLOCKS, answering(answer));

    expect(outcome.ok).toBe(true);
  });

  describe("retrying", () => {
    // The retry is worth having only because the loop can say WHAT was wrong.
    // Asking the same question again unchanged would get the same answer.
    it("feeds the failure back and succeeds on the retry", async () => {
      const runModel = answering("not json at all", GOOD_ANSWER);

      const outcome = await recognizeWithModel(BLOCKS, runModel);

      expect(outcome.ok).toBe(true);
      expect(outcome.attempts).toBe(2);
      const retry = runModel.mock.calls[1]?.[0] as unknown as { user: string };
      expect(retry.user).toMatch(/previous answer/i);
    });

    it("still shows the screen on the retry", async () => {
      const runModel = answering("not json at all", GOOD_ANSWER);

      await recognizeWithModel(BLOCKS, runModel);

      const retry = runModel.mock.calls[1]?.[0] as unknown as { user: string };
      expect(retry.user).toContain('#0 "360 Account"');
    });

    it("names a schema violation in the feedback", async () => {
      const runModel = answering(
        JSON.stringify({ accounts: [{ balances: [{ amountBlock: -1 }] }] }),
        GOOD_ANSWER,
      );

      await recognizeWithModel(BLOCKS, runModel);

      const retry = runModel.mock.calls[1]?.[0] as unknown as { user: string };
      expect(retry.user).toMatch(/amountBlock/);
    });

    it("gives up after three attempts", async () => {
      const runModel = answering("not json at all");

      const outcome = await recognizeWithModel(BLOCKS, runModel);

      expect(outcome.ok).toBe(false);
      expect(outcome.attempts).toBe(MAX_RECOGNITION_ATTEMPTS);
      expect(runModel).toHaveBeenCalledTimes(MAX_RECOGNITION_ATTEMPTS);
    });

    it("reports why it gave up", async () => {
      const outcome = await recognizeWithModel(
        BLOCKS,
        answering("not json at all"),
      );

      expect(outcome.ok).toBe(false);
      expect(!outcome.ok && outcome.reason).toMatch(/JSON/i);
    });

    // A model that returns a well-formed answer pointing nowhere has not
    // failed the CONTRACT — it has answered, and the resolver dropped what it
    // could not resolve. Retrying would ask the same question again.
    it("does not retry an answer that parsed but resolved to nothing", async () => {
      const runModel = answering(
        JSON.stringify({ accounts: [{ nameBlocks: [99] }] }),
      );

      const outcome = await recognizeWithModel(BLOCKS, runModel);

      expect(outcome.ok).toBe(true);
      expect(outcome.ok && outcome.recognition.accounts).toEqual([]);
      expect(runModel).toHaveBeenCalledTimes(1);
    });
  });

  // Transport failures are the app's to classify and report — a mistyped key
  // is not something a differently-worded prompt will fix, and retrying it
  // three times only delays telling the user.
  it("lets a transport failure propagate rather than retrying it", async () => {
    const runModel = vi.fn(async () => {
      throw new Error("unauthorized");
    });

    await expect(recognizeWithModel(BLOCKS, runModel)).rejects.toThrow(
      "unauthorized",
    );
    expect(runModel).toHaveBeenCalledTimes(1);
  });

  it("passes the known institutions through to the prompt", async () => {
    const runModel = answering(GOOD_ANSWER);

    await recognizeWithModel(BLOCKS, runModel, {
      knownInstitutions: ["OCBC"],
    });

    const attempt = runModel.mock.calls[0]?.[0] as unknown as {
      system: string;
    };
    expect(attempt.system).toContain("OCBC");
  });

  it("reports the fingerprint of the screen it read", async () => {
    const outcome = await recognizeWithModel(BLOCKS, answering(GOOD_ANSWER));

    expect(outcome.ok && outcome.fingerprint.hash).toBeTruthy();
  });
});
