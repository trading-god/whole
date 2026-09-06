import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { OcrTextBlock } from "@whole/ocr";

import { recognizeAccountsWithModel } from "@/features/recognition/model-recognition";
import { OnDeviceModelError } from "@/features/on-device-model/model-error";
import { RemoteModelError } from "@/features/recognition/remote-model-error";
import { runOnDeviceModel } from "@/features/recognition/on-device-runner";

const mockRunModel = jest.fn<(attempt: unknown) => Promise<string>>();

jest.mock("@/features/recognition/on-device-runner", () => ({
  runOnDeviceModel: (attempt: unknown) => mockRunModel(attempt),
}));

const mockRelease = jest.fn<() => Promise<void>>();

jest.mock("@/features/on-device-model/model-context", () => ({
  releaseOnDeviceContext: () => mockRelease(),
}));

// One block per row so the annotations below are easy to follow.
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

// The MODEL'S answer, not the recognition: the engine reads the structure, so
// even an empty annotation yields the screen's account.
// `homeCurrency` is required by the annotation contract, and "none" is the
// contract-holding way to decline it. Without the field the stand-in model
// fails validation three times and every case here reports invalid-output.
const GOOD_ANSWER = JSON.stringify({
  homeCurrency: "none",
  institution: { displayName: "unknown" },
  accounts: [],
});

beforeEach(() => {
  jest.resetAllMocks();
  mockRunModel.mockResolvedValue(GOOD_ANSWER);
  mockRelease.mockResolvedValue(undefined);
});

describe("recognizeAccountsWithModel", () => {
  it("recognizes the accounts through the bundled model", async () => {
    const result = await recognizeAccountsWithModel(BLOCKS, runOnDeviceModel);

    expect(result.status).toBe("recognized");
    expect(
      result.status === "recognized" && result.recognition.accounts,
    ).toEqual([
      {
        accountName: "360 Account",
        accountLastFourDigits: undefined,
        balances: [{ currency: "SGD", balance: 6672.59 }],
        kind: "cash",
        institutionId: "ocbc",
      },
    ]);
  });

  it("frees the prewarmed context when the engine grouped nothing", async () => {
    // The prewarm started beside the OCR pass, before anything could know this
    // screen holds no account. Nothing is going to ask the model now, so the
    // context should not wait out the idle timer holding gigabytes.
    const empty = [
      {
        text: "Settings",
        normalizedBox: { x: 0.05, y: 0.05, width: 0.2, height: 0.03 },
      },
    ];

    const result = await recognizeAccountsWithModel(empty, runOnDeviceModel);

    expect(result).toEqual({
      status: "recognized",
      recognition: { accounts: [] },
    });
    expect(mockRunModel).not.toHaveBeenCalled();
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  it("keeps the context warm when the model was actually asked", async () => {
    await recognizeAccountsWithModel(BLOCKS, runOnDeviceModel);

    // The next screenshot should skip the multi-second load.
    expect(mockRelease).not.toHaveBeenCalled();
  });

  it("reports a model that never held the contract as invalid-output", async () => {
    mockRunModel.mockResolvedValue("not json");

    const result = await recognizeAccountsWithModel(BLOCKS, runOnDeviceModel);

    expect(result).toMatchObject({ status: "failed", cause: "invalid-output" });
  });

  it("reports a failure of the on-device runtime as load-failed", async () => {
    // The REAL error class — `instanceof` is the discriminator, and a
    // look-alike would read as "unknown". A context that would not load and a
    // completion that could not finish are both device-capability failures
    // whose advice is "free up memory", which is why one class covers them.
    mockRunModel.mockRejectedValue(new OnDeviceModelError("out of memory"));

    const result = await recognizeAccountsWithModel(BLOCKS, runOnDeviceModel);

    expect(result).toMatchObject({ status: "failed", cause: "load-failed" });
  });

  it("reports a failure of the remote endpoint as remote-failed", async () => {
    // The REAL error class — `instanceof` is the discriminator, and a
    // look-alike would read as "unknown". An unreachable endpoint and an
    // unauthorized one are both configuration problems whose advice names the
    // setting to fix, which is why one class covers them.
    mockRunModel.mockRejectedValue(new RemoteModelError("HTTP 401"));

    const result = await recognizeAccountsWithModel(BLOCKS, runOnDeviceModel);

    expect(result).toMatchObject({ status: "failed", cause: "remote-failed" });
  });

  it("reports any other thrown error as unknown", async () => {
    mockRunModel.mockRejectedValue(new Error("completion failed"));

    const result = await recognizeAccountsWithModel(BLOCKS, runOnDeviceModel);

    expect(result).toMatchObject({ status: "failed", cause: "unknown" });
  });

  // The annotation turn only ever ADDS to a deterministic read, so losing it
  // must not lose the read. Both failure paths are covered: a model that
  // answers nothing usable, and a runtime that never answers at all.
  it.each([
    [
      "a model that never holds the contract",
      () => mockRunModel.mockResolvedValue("not json"),
    ],
    [
      "a runtime that will not run",
      () =>
        mockRunModel.mockRejectedValue(new OnDeviceModelError("out of memory")),
    ],
  ])("still returns the engine's read after %s", async (_name, arrange) => {
    arrange();

    const result = await recognizeAccountsWithModel(BLOCKS, runOnDeviceModel);

    expect(result.status).toBe("failed");
    expect(result.status === "failed" && result.accounts).toEqual([
      {
        accountName: "360 Account",
        accountLastFourDigits: undefined,
        balances: [{ currency: "SGD", balance: 6672.59 }],
        kind: "cash",
        institutionId: "ocbc",
      },
    ]);
  });
});
