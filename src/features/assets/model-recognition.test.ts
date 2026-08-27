import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { LlmError, type LlmFailureKind, type ProviderConfig } from "@whole/llm";
import type { OcrTextBlock } from "@whole/ocr";

import { recognizeAccountsWithModel } from "@/features/assets/model-recognition";

const mockLoadProviderConfig = jest.fn<() => Promise<ProviderConfig | null>>();
const mockHasConsentedTo = jest.fn<(host: string) => Promise<boolean>>();
const mockRunModel = jest.fn<(attempt: unknown) => Promise<string>>();
type RunnerOptions = { onUsage?: (usage: unknown) => void };

const mockCreateModelRunner = jest.fn<(options: RunnerOptions) => unknown>();

jest.mock("@/features/assets/model-provider-store", () => ({
  loadProviderConfig: () => mockLoadProviderConfig(),
  hasConsentedTo: (host: string) => mockHasConsentedTo(host),
}));

jest.mock("@/features/assets/model-runner", () => ({
  createModelRunner: (options: RunnerOptions) => mockCreateModelRunner(options),
}));

const HOSTED: ProviderConfig = {
  baseUrl: "https://api.example.com/v1",
  api: "openai-chat",
  apiKey: "sk-test",
  models: [{ id: "gpt-5.6" }],
};

const LOCAL: ProviderConfig = { ...HOSTED, baseUrl: "http://localhost:11434" };

// One block per row so the indices below are easy to follow.
const BLOCKS: OcrTextBlock[] = [
  {
    text: "360 Account",
    normalizedBox: { x: 0.05, y: 0.05, width: 0.2, height: 0.03 },
  },
  {
    text: "6,672.59",
    normalizedBox: { x: 0.05, y: 0.15, width: 0.2, height: 0.03 },
  },
  {
    text: "SGD",
    normalizedBox: { x: 0.3, y: 0.15, width: 0.06, height: 0.03 },
  },
];

const GOOD_ANSWER = JSON.stringify({
  accounts: [
    { nameBlocks: [0], balances: [{ amountBlock: 1, currencyBlock: 2 }] },
  ],
});

beforeEach(() => {
  // `resetAllMocks`, not `clearAllMocks`: clearing wipes recorded calls but
  // LEAVES implementations in place, so the usage case's stand-in runner would
  // leak into every case after it and quietly ignore their `mockRejectedValue`.
  jest.resetAllMocks();
  mockCreateModelRunner.mockReturnValue(mockRunModel);
  mockLoadProviderConfig.mockResolvedValue(HOSTED);
  mockHasConsentedTo.mockResolvedValue(true);
  mockRunModel.mockResolvedValue(GOOD_ANSWER);
});

describe("recognizeAccountsWithModel", () => {
  it("recognizes the accounts on the screen", async () => {
    const result = await recognizeAccountsWithModel(BLOCKS);

    expect(result.status).toBe("recognized");
    expect(
      result.status === "recognized" && result.recognition.accounts,
    ).toEqual([
      {
        accountName: "360 Account",
        accountLastFourDigits: undefined,
        balances: [{ currency: "SGD", balance: 6672.59 }],
        kind: undefined,
      },
    ]);
  });

  it("reports the layout so the template cache can key on it", async () => {
    const result = await recognizeAccountsWithModel(BLOCKS);

    expect(
      result.status === "recognized" && result.fingerprint.hash,
    ).toBeTruthy();
  });

  // Tokens, never money — the price of someone else's endpoint is not knowable
  // here, and every retry is a turn the user paid for.
  it("totals what the recognition cost across every turn", async () => {
    mockCreateModelRunner.mockImplementation(({ onUsage }) =>
      jest.fn(async () => {
        onUsage?.({ inputTokens: 100, outputTokens: 20 });
        return GOOD_ANSWER;
      }),
    );

    const result = await recognizeAccountsWithModel(BLOCKS);

    expect(result.status === "recognized" && result.usage).toEqual({
      inputTokens: 100,
      outputTokens: 20,
    });
  });

  describe("before it will call anything", () => {
    // Recognition is unavailable rather than broken. The screen this reaches
    // sends the user to the settings page, not to an error.
    it("reports that nothing is configured", async () => {
      mockLoadProviderConfig.mockResolvedValue(null);

      expect(await recognizeAccountsWithModel(BLOCKS)).toEqual({
        status: "not-configured",
      });
      expect(mockRunModel).not.toHaveBeenCalled();
    });

    // Configuring an endpoint is not the same act as agreeing that a
    // screenshot's text may be sent to it.
    it("reports that consent is missing, and for which host", async () => {
      mockHasConsentedTo.mockResolvedValue(false);

      expect(await recognizeAccountsWithModel(BLOCKS)).toEqual({
        status: "consent-required",
        host: "api.example.com",
        isLocal: false,
      });
      expect(mockRunModel).not.toHaveBeenCalled();
    });

    // "…to a model on your own Mac" and "…to a company in another country" are
    // not the same promise, and the user should not have to read a URL to tell
    // them apart.
    it("says when the host is the user's own machine", async () => {
      mockLoadProviderConfig.mockResolvedValue(LOCAL);
      mockHasConsentedTo.mockResolvedValue(false);

      expect(await recognizeAccountsWithModel(BLOCKS)).toMatchObject({
        status: "consent-required",
        host: "localhost",
        isLocal: true,
      });
    });
  });

  describe("failures", () => {
    // Classified, because under a bring-your-own endpoint the user is the only
    // person who can fix any of them — and "your key is wrong" and "you are
    // rate limited" call for completely different actions.
    it.each<LlmFailureKind>([
      "unauthorized",
      "rate-limited",
      "network",
      "server",
      "malformed",
    ])("passes a %s failure through with its cause", async (kind) => {
      mockRunModel.mockRejectedValue(new LlmError(kind, "nope"));

      expect(await recognizeAccountsWithModel(BLOCKS)).toMatchObject({
        status: "failed",
        cause: kind,
      });
    });

    // A model that cannot hold the output contract after three tries is its own
    // kind of failure: nothing about the key or the network is wrong, and the
    // advice is to try a different model.
    it("reports a model that never produced a usable answer", async () => {
      mockRunModel.mockResolvedValue("not json at all");

      const result = await recognizeAccountsWithModel(BLOCKS);

      expect(result).toMatchObject({
        status: "failed",
        cause: "invalid-output",
      });
      expect(mockRunModel).toHaveBeenCalledTimes(3);
    });

    // Anything else that goes wrong is still a failure the user should see,
    // rather than an exception escaping into the screen.
    it("reports an unexpected error rather than throwing", async () => {
      mockRunModel.mockRejectedValue(new Error("something else"));

      expect(await recognizeAccountsWithModel(BLOCKS)).toMatchObject({
        status: "failed",
        cause: "unknown",
      });
    });

    it("survives a rejection that is not an Error at all", async () => {
      mockRunModel.mockRejectedValue("just a string");

      expect(await recognizeAccountsWithModel(BLOCKS)).toMatchObject({
        status: "failed",
        cause: "unknown",
        message: "just a string",
      });
    });

    // A stored configuration whose URL cannot be read is a configuration
    // problem, and it must fail loudly: consent is recorded per HOST, so a
    // request that cannot name its host cannot have been consented to.
    it("refuses a configuration whose host cannot be read", async () => {
      mockLoadProviderConfig.mockResolvedValue({
        ...HOSTED,
        baseUrl: "not a url",
      });

      expect(await recognizeAccountsWithModel(BLOCKS)).toMatchObject({
        status: "failed",
        cause: "unknown",
      });
      expect(mockRunModel).not.toHaveBeenCalled();
    });
  });

  // Someone with six institutions on file gives the model a prior that
  // collapses most of the ambiguity.
  it("offers the user's existing institutions as candidates", async () => {
    await recognizeAccountsWithModel(BLOCKS, {
      knownInstitutions: ["OCBC"],
    });

    const attempt = mockRunModel.mock.calls[0]?.[0] as { system: string };
    expect(attempt.system).toContain("OCBC");
  });

  it("uses the first configured model", async () => {
    await recognizeAccountsWithModel(BLOCKS);

    expect(mockCreateModelRunner).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-5.6" }),
    );
  });
});
