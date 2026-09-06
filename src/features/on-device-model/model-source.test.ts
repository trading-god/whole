import { beforeEach, describe, expect, it, jest } from "@jest/globals";

import { onDeviceModel } from "@/features/on-device-model/on-device-catalog";
import { resolveOnDeviceModelPath } from "@/features/on-device-model/model-source";

// `model-download.ts` owns the files on disk and is itself tested through
// its own fake `expo-file-system`; here it is mocked at the module seam so
// this suite tests only the path resolution's own logic — the presence
// verdict and the error's wording.
const mockModelPresence =
  jest.fn<() => { status: string; sizeBytes?: number }>();

jest.mock("expo-file-system", () => ({}));

jest.mock("@/features/on-device-model/model-download", () => ({
  modelPresence: () => mockModelPresence(),
  modelFile: () => ({ uri: "file:///docs/whole_models/<model>/<file>" }),
}));

beforeEach(() => {
  jest.clearAllMocks();
});

describe("resolveOnDeviceModelPath", () => {
  it("hands over the model file's uri when the model is present", () => {
    mockModelPresence.mockReturnValue({ status: "present" });

    expect(resolveOnDeviceModelPath("gemma-4-e4b")).toBe(
      "file:///docs/whole_models/<model>/<file>",
    );
  });

  it("refuses to proceed when the model is not present", () => {
    mockModelPresence.mockReturnValue({ status: "absent" });

    expect(() => resolveOnDeviceModelPath("gemma-4-e2b")).toThrow(
      /not downloaded/,
    );
  });

  it("refuses to proceed when the file is only partial", () => {
    // A truncated file would fail deep inside the loader with a message
    // about GGUF headers; this says what the user can act on.
    mockModelPresence.mockReturnValue({ status: "partial", sizeBytes: 12 });

    expect(() => resolveOnDeviceModelPath("gemma-4-e2b")).toThrow(
      /not downloaded/,
    );
  });

  it("names the model in the error", () => {
    mockModelPresence.mockReturnValue({ status: "absent" });

    expect(() => resolveOnDeviceModelPath("gemma-4-e4b")).toThrow(
      onDeviceModel("gemma-4-e4b").name,
    );
  });
});
