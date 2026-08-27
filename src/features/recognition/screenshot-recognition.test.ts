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
  jest.fn<(blocks: OcrTextBlock[], options?: unknown) => Promise<unknown>>();

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

jest.mock("@/features/recognition/model-recognition", () => ({
  recognizeAccountsWithModel: (blocks: OcrTextBlock[], options?: unknown) =>
    mockRecognizeAccountsWithModel(blocks, options),
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
  fingerprint: { hash: "abc", tokens: ["account"] },
  usage: { inputTokens: 1, outputTokens: 2 },
};

beforeEach(() => {
  jest.resetAllMocks();
  mockIsOcrSupported.mockReturnValue(true);
  mockRecognizeTextOnDevice.mockResolvedValue({ blocks: [] });
  mockNormalizeOcrResult.mockReturnValue(BLOCKS);
  mockRenderAsync.mockResolvedValue({ width: 1206, height: 2622 });
  mockRecognizeAccountsWithModel.mockResolvedValue(RECOGNIZED);
});

describe("recognizeAccountFromScreenshot", () => {
  it("hands the normalized blocks to the model pipeline", async () => {
    const result = await recognizeAccountFromScreenshot("file://shot.png");

    expect(mockRecognizeAccountsWithModel).toHaveBeenCalledWith(
      BLOCKS,
      expect.anything(),
    );
    expect(result).toEqual(RECOGNIZED);
  });

  // Every reason the pipeline can decline reaches the screen unchanged, because
  // each one has a different next step for the user.
  it.each([["not-configured"], ["consent-required"], ["failed"]])(
    "passes a %s outcome through",
    async (status) => {
      mockRecognizeAccountsWithModel.mockResolvedValue({ status });

      expect(await recognizeAccountFromScreenshot("file://shot.png")).toEqual({
        status,
      });
    },
  );

  // A capability gate on the ENTRY point, so every caller inherits the fallback
  // rather than only the uploader.
  it("refuses a device that cannot run OCR at all", async () => {
    mockIsOcrSupported.mockReturnValue(false);

    await expect(
      recognizeAccountFromScreenshot("file://shot.png"),
    ).rejects.toBeInstanceOf(RecognitionUnsupportedError);
    expect(mockRecognizeTextOnDevice).not.toHaveBeenCalled();
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

  // The prior that collapses most institution ambiguity, and the reason the
  // caller — which holds the account list — passes it down.
  it("forwards the user's existing institutions", async () => {
    await recognizeAccountFromScreenshot("file://shot.png", 1206, 2622, {
      knownInstitutions: ["OCBC"],
    });

    expect(mockRecognizeAccountsWithModel).toHaveBeenCalledWith(BLOCKS, {
      knownInstitutions: ["OCBC"],
    });
  });
});
