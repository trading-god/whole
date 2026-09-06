import { describe, expect, it } from "vitest";

import {
  DEFAULT_ON_DEVICE_MODEL,
  ON_DEVICE_MODELS,
  onDeviceModel,
} from "@/features/on-device-model/on-device-catalog";

// The catalog is a constant; the assertions pin the invariants its consumers
// rely on — the downloader's URL and size check, the presence gate, and the
// settings screen's cost lines all read from here.
describe("ON_DEVICE_MODELS", () => {
  it("lists the E2B and the E4B, smallest first", () => {
    expect(ON_DEVICE_MODELS.map((model) => model.id)).toEqual([
      "gemma-4-e2b",
      "gemma-4-e4b",
    ]);
    expect(DEFAULT_ON_DEVICE_MODEL.id).toBe("gemma-4-e2b");
  });

  it("gives each model a distinct id, file, and directory-safe name", () => {
    // The id is the kv-store value AND the disk directory name; two models
    // sharing any of these would overwrite each other's weights.
    const ids = new Set(ON_DEVICE_MODELS.map((model) => model.id));
    const files = new Set(ON_DEVICE_MODELS.map((model) => model.fileName));
    expect(ids.size).toBe(ON_DEVICE_MODELS.length);
    expect(files.size).toBe(ON_DEVICE_MODELS.length);
  });

  it("declares exact byte counts for both models", () => {
    // `sizeBytes` is not decoration: the presence check DELETES a file whose
    // size does not match, so a stale number would make every download land
    // and be thrown away again. Pinned to the unsloth release's actual
    // content lengths.
    const e2b = onDeviceModel("gemma-4-e2b");
    const e4b = onDeviceModel("gemma-4-e4b");
    expect(e2b.sizeBytes).toBe(3_106_738_272);
    expect(e4b.sizeBytes).toBe(4_977_171_584);
  });

  it("serves each model from its own unsloth repo path", () => {
    // The URL is the downloader's whole request; the name inside it is the
    // file the byte count above was measured against.
    for (const model of ON_DEVICE_MODELS) {
      expect(model.url).toMatch(
        /^https:\/\/huggingface\.co\/unsloth\/gemma-4-E[24]B-it-GGUF\/resolve\/main\//,
      );
      expect(model.url.endsWith(model.fileName)).toBe(true);
    }
  });

  it("states a RAM demand larger than a small phone holds", () => {
    // The RAM line exists to warn a user whose device cannot run the model;
    // a number in the megabytes would read as a copy error and understate
    // the demand.
    for (const model of ON_DEVICE_MODELS) {
      expect(model.ramBytes).toBeGreaterThan(2_000_000_000);
    }
  });

  it("falls back to the default for an unknown id", () => {
    // `onDeviceModel` never throws: a stored preference naming a model a
    // later catalog removed degrades to the default rather than crashing a
    // launch. The cast is the test's point — the type does not allow it.
    expect(onDeviceModel("gone" as never)).toBe(DEFAULT_ON_DEVICE_MODEL);
  });
});
