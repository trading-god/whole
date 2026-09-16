import { beforeEach, describe, expect, it, jest } from "@jest/globals";

import { recognizeScreenshots } from "@/features/recognition/batch-recognition";
import type { ModelRecognitionResult } from "@/features/recognition/model-recognition";
import {
  EngineNotReadyError,
  RecognitionUnsupportedError,
} from "@/features/recognition/screenshot-recognition";

const mockRecognize =
  jest.fn<
    (
      uri: string,
      width?: number,
      height?: number,
    ) => Promise<ModelRecognitionResult>
  >();

// The recognizer is mocked whole rather than through its Expo dependencies:
// this module's job is the ORDER things happen in — one screenshot at a time,
// each reported as it lands, stopping on a failure that would repeat — and none
// of that is about how a single recognition works.
jest.mock("@/features/recognition/screenshot-recognition", () => ({
  recognizeAccountFromScreenshot: (
    uri: string,
    width?: number,
    height?: number,
  ) => mockRecognize(uri, width, height),
  // Declared INSIDE the factory, and imported back through the mocked module
  // above. Declaring them outside as `class` bindings put them in a temporal
  // dead zone when the factory ran — the module under test is imported before
  // them — so every `instanceof` in the loop missed and both stopping cases
  // read as an ordinary failure.
  EngineNotReadyError: class extends Error {},
  RecognitionUnsupportedError: class extends Error {},
}));

function recognized(accountName: string): ModelRecognitionResult {
  return {
    status: "recognized",
    recognition: {
      accounts: [{ accountName, institutionId: "unknown" }],
      institution: { displayName: "Some Bank" },
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("recognizeScreenshots", () => {
  it("recognizes one screenshot at a time, in order", async () => {
    // Serial, not parallel: two decodes at once on a phone do not halve the
    // wait, they double the resident memory of the one thing most likely to be
    // killed for using too much of it.
    const inFlight: string[] = [];
    mockRecognize.mockImplementation(async (uri) => {
      expect(inFlight).toHaveLength(0);
      inFlight.push(uri);
      await Promise.resolve();
      inFlight.pop();
      return recognized(uri);
    });

    const outcomes = await recognizeScreenshots(
      [{ uri: "a" }, { uri: "b" }, { uri: "c" }],
      () => {},
    );

    expect(mockRecognize.mock.calls.map(([uri]) => uri)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(outcomes.map((outcome) => outcome.accounts[0]?.accountName)).toEqual(
      ["a", "b", "c"],
    );
  });

  it("reports each outcome as it lands rather than only at the end", async () => {
    // A five-screenshot batch is minutes of waiting, and a progress count is
    // the difference between "working" and "hung".
    mockRecognize.mockImplementation((uri) => Promise.resolve(recognized(uri)));
    const seen: number[] = [];

    await recognizeScreenshots([{ uri: "a" }, { uri: "b" }], (index) => {
      seen.push(index);
    });

    expect(seen).toEqual([0, 1]);
  });

  it("carries the dimensions the picker already knew", async () => {
    mockRecognize.mockImplementation((uri) => Promise.resolve(recognized(uri)));

    await recognizeScreenshots(
      [{ uri: "a", width: 1170, height: 2532 }],
      () => {},
    );

    expect(mockRecognize).toHaveBeenCalledWith("a", 1170, 2532);
  });

  it("surfaces the model's institution name beside the engine's id", async () => {
    // The app ignored the model's free-text institution until a batch needed
    // it: one screenshot's accounts are grouped under one institution, and a
    // batch spans several.
    mockRecognize.mockResolvedValue(recognized("Savings"));

    const [outcome] = await recognizeScreenshots([{ uri: "a" }], () => {});

    expect(outcome.institutionId).toBe("unknown");
    expect(outcome.institutionName).toBe("Some Bank");
  });

  it("keeps going after one screenshot fails to recognize", async () => {
    // One unreadable screenshot must not cost the user the four that worked.
    mockRecognize.mockImplementation((uri) =>
      uri === "b"
        ? Promise.resolve({
            status: "failed" as const,
            cause: "invalid-output" as const,
            accounts: [],
          })
        : Promise.resolve(recognized(uri)),
    );

    const outcomes = await recognizeScreenshots(
      [{ uri: "a" }, { uri: "b" }, { uri: "c" }],
      () => {},
    );

    expect(outcomes.map((outcome) => outcome.issue)).toEqual([
      null,
      "recognitionEmpty",
      null,
    ]);
  });

  it("stops the batch when the engine is not set up", async () => {
    // A property of the SETUP, not of this screenshot: the next nine would
    // fail the same way, and spending ten OCR passes to say so once is waste
    // the user watches.
    mockRecognize.mockRejectedValue(new EngineNotReadyError("not ready"));

    const outcomes = await recognizeScreenshots(
      [{ uri: "a" }, { uri: "b" }, { uri: "c" }],
      () => {},
    );

    expect(mockRecognize).toHaveBeenCalledTimes(1);
    expect(outcomes).toEqual([{ accounts: [], issue: "engineNotReady" }]);
  });

  it("stops the batch when the device cannot run OCR", async () => {
    mockRecognize.mockRejectedValue(new RecognitionUnsupportedError());

    const outcomes = await recognizeScreenshots(
      [{ uri: "a" }, { uri: "b" }],
      () => {},
    );

    expect(mockRecognize).toHaveBeenCalledTimes(1);
    expect(outcomes[0]?.issue).toBe("ocrUnsupported");
  });

  it("reports anything else thrown as a failed recognition", async () => {
    mockRecognize.mockRejectedValue(new Error("boom"));

    const outcomes = await recognizeScreenshots(
      [{ uri: "a" }, { uri: "b" }],
      () => {},
    );

    // Not a stopping issue: a screenshot that threw for its own reasons says
    // nothing about the next one.
    expect(outcomes.map((outcome) => outcome.issue)).toEqual([
      "recognitionFailed",
      "recognitionFailed",
    ]);
  });

  it("stops between screenshots when the caller has gone", async () => {
    // The uploader passes its mounted flag. A recognition in flight cannot be
    // interrupted — the native decode owns the thread — but a batch whose
    // screen is gone must not spend another forty seconds on the next image.
    mockRecognize.mockImplementation((uri) => Promise.resolve(recognized(uri)));
    let alive = true;

    const outcomes = await recognizeScreenshots(
      [{ uri: "a" }, { uri: "b" }, { uri: "c" }],
      () => {
        alive = false;
      },
      () => !alive,
    );

    expect(mockRecognize).toHaveBeenCalledTimes(1);
    expect(outcomes).toHaveLength(1);
  });
});
