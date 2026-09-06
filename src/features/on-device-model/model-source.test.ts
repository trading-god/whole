import { beforeEach, describe, expect, it, jest } from "@jest/globals";

import {
  ON_DEVICE_MODELS,
  onDeviceModel,
} from "@/features/on-device-model/on-device-catalog";
import { resolveOnDeviceModelPath } from "@/features/on-device-model/model-source";

// expo-file-system is the single native seam; the fake below keeps the real
// constructor's joining semantics (a directory as a uri, then path segments)
// so the tests assert the ACTUAL directory names, not ones invented here.
const mockFile = {
  exists: false,
  size: 0,
};

jest.mock("expo-file-system", () => {
  class FakeFile {
    private readonly segments: string[];
    constructor(
      ...segments: (
        | string
        | { uri: string }
        | { files?: unknown; create?: unknown; delete?: unknown }
      )[]
    ) {
      this.segments = segments.map((segment) =>
        typeof segment === "string"
          ? segment
          : (segment as { uri: string }).uri,
      );
    }
    get exists(): boolean {
      return mockFile.exists;
    }
    get size(): number {
      return mockFile.size;
    }
    get uri(): string {
      return this.segments.join("/");
    }
  }
  return {
    File: FakeFile,
    Paths: { document: { uri: "file:///docs" } },
  };
});

beforeEach(() => {
  jest.clearAllMocks();
  mockFile.exists = false;
  mockFile.size = 0;
});

describe("resolveOnDeviceModelPath", () => {
  it("hands over the model's file path when it is present at the right size", () => {
    const model = onDeviceModel("gemma-4-e4b");
    mockFile.exists = true;
    mockFile.size = model.sizeBytes;

    // The REAL layout — the model's own directory (its id) under the model
    // root, named by the catalog; a rename anywhere must fail this test
    // rather than silently diverge from `model-download.ts`.
    expect(resolveOnDeviceModelPath("gemma-4-e4b")).toBe(
      `file:///docs/whole_models/${model.id}/${model.fileName}`,
    );
  });

  it("refuses to proceed when the file is missing", () => {
    mockFile.exists = false;

    expect(() => resolveOnDeviceModelPath("gemma-4-e2b")).toThrow(
      /not downloaded/,
    );
  });

  it("refuses to proceed when the file is the wrong size", () => {
    mockFile.exists = true;
    mockFile.size = 12;

    // A truncated file would fail deep inside the loader with a message
    // about GGUF headers; this says what the user can act on.
    expect(() => resolveOnDeviceModelPath("gemma-4-e2b")).toThrow(
      /not downloaded/,
    );
  });

  it("names the model in the error", () => {
    mockFile.exists = false;

    expect(() => resolveOnDeviceModelPath("gemma-4-e4b")).toThrow(
      /Gemma 4 E4B/,
    );
  });
});

describe("the catalog", () => {
  it("lists the models smallest-first with the E2B default", () => {
    const [first, second] = ON_DEVICE_MODELS;
    expect(first.id).toBe("gemma-4-e2b");
    expect(second.id).toBe("gemma-4-e4b");
    expect(first.sizeBytes).toBeLessThan(second.sizeBytes);
  });

  it("carries the RAM demand distinct from the file size", () => {
    // The two numbers answer different questions — "do I have disk" and
    // "can my device hold it running" — and both ride the catalog so the
    // UI states them from one source.
    for (const model of ON_DEVICE_MODELS) {
      expect(model.ramBytes).toBeGreaterThan(0);
      expect(model.ramBytes).not.toBe(model.sizeBytes);
    }
  });
});
