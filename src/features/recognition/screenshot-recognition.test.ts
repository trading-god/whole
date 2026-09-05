import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { OcrTextBlock } from "@whole/ocr";

import {
  RecognitionUnsupportedError,
  recognizeAccountFromScreenshot,
} from "@/features/recognition/screenshot-recognition";
import type { ModelRecognitionResult } from "@/features/recognition/model-recognition";

const mockIsOcrSupported = jest.fn<() => boolean>();
const mockRecognizeTextOnDevice = jest.fn<() => Promise<unknown>>();
const mockNormalizeOcrResult = jest.fn<() => OcrTextBlock[]>();
const mockRenderAsync =
  jest.fn<() => Promise<{ width: number; height: number }>>();
const mockRecognizeAccountsWithModel =
  jest.fn<(blocks: OcrTextBlock[]) => Promise<unknown>>();
const mockPrewarm = jest.fn();
const mockReleaseOnDeviceContext = jest.fn<() => Promise<void>>();

jest.mock("@/features/recognition/ocr-engine", () => ({
  isOcrSupported: () => mockIsOcrSupported(),
  recognizeTextOnDevice: () => mockRecognizeTextOnDevice(),
  normalizeOcrResult: () => mockNormalizeOcrResult(),
}));

jest.mock("expo-image-manipulator", () => ({
  ImageManipulator: {
    manipulate: () => ({ renderAsync: () => mockRenderAsync() }),
  },
}));

jest.mock("@/features/on-device-model/model-context", () => ({
  prewarmOnDeviceContext: () => mockPrewarm(),
  releaseOnDeviceContext: () => mockReleaseOnDeviceContext(),
}));

jest.mock("@/features/recognition/model-recognition", () => ({
  recognizeAccountsWithModel: (blocks: OcrTextBlock[]) =>
    mockRecognizeAccountsWithModel(blocks),
}));

const BLOCKS: OcrTextBlock[] = [
  {
    text: "360 Account",
    normalizedBox: { x: 0.05, y: 0.05, width: 0.2, height: 0.03 },
  },
];

const RECOGNIZED: ModelRecognitionResult = {
  status: "recognized",
  recognition: { accounts: [] },
};

beforeEach(() => {
  jest.resetAllMocks();
  mockIsOcrSupported.mockReturnValue(true);
  mockRecognizeTextOnDevice.mockResolvedValue({ blocks: [] });
  mockNormalizeOcrResult.mockReturnValue(BLOCKS);
  mockRenderAsync.mockResolvedValue({ width: 1206, height: 2622 });
  mockRecognizeAccountsWithModel.mockResolvedValue(RECOGNIZED);
  mockReleaseOnDeviceContext.mockResolvedValue(undefined);
});

describe("recognizeAccountFromScreenshot", () => {
  it("hands the normalized blocks to the model pipeline", async () => {
    const result = await recognizeAccountFromScreenshot("file://shot.png");

    expect(mockRecognizeAccountsWithModel).toHaveBeenCalledWith(BLOCKS);
    expect(result).toEqual(RECOGNIZED);
  });

  // Every reason the pipeline can decline reaches the screen unchanged, because
  // each one has a different next step for the user.
  it("passes a failed outcome through", async () => {
    const failed: ModelRecognitionResult = {
      status: "failed",
      cause: "load-failed",
      accounts: [],
    };
    mockRecognizeAccountsWithModel.mockResolvedValue(failed);

    expect(await recognizeAccountFromScreenshot("file://shot.png")).toEqual(
      failed,
    );
  });

  it("frees the prewarmed context when the OCR pass throws", async () => {
    // Nothing downstream runs, so nothing else would release it — the user
    // fills the form in by hand beside three gigabytes waiting out the idle
    // timer, on a device that just failed OCR.
    mockRecognizeTextOnDevice.mockRejectedValue(new Error("vision failed"));

    await expect(
      recognizeAccountFromScreenshot("file://shot.png"),
    ).rejects.toThrow("vision failed");

    expect(mockReleaseOnDeviceContext).toHaveBeenCalledTimes(1);
  });

  it("starts the model load before the OCR pass, not after it", async () => {
    // The context load depends on nothing here, and it is the largest slice of
    // a cold recognition. Serialized behind OCR it would be added to the wait
    // rather than hidden inside it.
    await recognizeAccountFromScreenshot("file://shot.png");

    expect(mockPrewarm.mock.invocationCallOrder[0]).toBeLessThan(
      mockRecognizeTextOnDevice.mock.invocationCallOrder[0],
    );
  });

  // A capability gate on the ENTRY point, so every caller inherits the fallback
  // rather than only the uploader.
  it("refuses a device that cannot run OCR at all", async () => {
    mockIsOcrSupported.mockReturnValue(false);

    await expect(
      recognizeAccountFromScreenshot("file://shot.png"),
    ).rejects.toBeInstanceOf(RecognitionUnsupportedError);
    expect(mockRecognizeTextOnDevice).not.toHaveBeenCalled();
    // And nothing loaded three gigabytes of weights for a recognition that
    // could never run.
    expect(mockPrewarm).not.toHaveBeenCalled();
  });

  describe("image dimensions", () => {
    // The picker already decoded the image, so re-reading its size would be a
    // second decode for a number the caller is holding.
    it("uses the dimensions the caller already has", async () => {
      await recognizeAccountFromScreenshot("file://shot.png", 1206, 2622);

      expect(mockRenderAsync).not.toHaveBeenCalled();
    });

    it("reads them when the caller does not have them", async () => {
      await recognizeAccountFromScreenshot("file://shot.png");

      expect(mockRenderAsync).toHaveBeenCalled();
    });

    it("reads them when only one is supplied", async () => {
      await recognizeAccountFromScreenshot("file://shot.png", 1206);

      expect(mockRenderAsync).toHaveBeenCalled();
    });
  });
});
