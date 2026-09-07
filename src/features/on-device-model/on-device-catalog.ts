// The catalog of models the on-device engine can run — the single source of
// truth for what a model IS: which file, how big, where it downloads from,
// what it demands of the device.
//
// Everything that describes the WEIGHTS is read from here, never re-declared
// at a call site: the settings screen prints these sizes, the downloader
// reads these URLs, the presence check reads these byte counts. How the
// runtime spends them (the context window, the output ceiling, the
// temperature) is the recognition turn's contract, not the weights', and
// lives in `@whole/ocr`'s `ANNOTATION_INFERENCE`.
//
// The files are unsloth's single-file Q4_K_M quants, served from
// Hugging Face's resolve endpoint — a 302 to a CDN with `Content-Length`
// and Range support, which is what an honest progress bar and a resumable
// download need. (The ggml-org repos do not carry Q4_K_M at all; these are
// the canonical downloadable copies.) HTTPS-only, matching the app's ATS
// policy.
//
// RAM is the honest demand of RUNNING the model, not the file size: the
// mmap'd weights plus KV cache and compute buffers at the recognition
// context window. A device short of it does not fail loudly — the OS
// jetsams the app mid-load — so the number a user weighing the choice
// needs is stated up front. Measured on the eval devices (see
// whole-test AVD notes): E2B loads in ~2.7 GB, E4B in ~4.3 GB.
import { z } from "zod";

export type OnDeviceModelId = "gemma-4-e2b" | "gemma-4-e4b";

export type OnDeviceModel = {
  /** Stable id — the kv-store value and the disk directory name. */
  id: OnDeviceModelId;
  /** What the settings screen calls it. */
  name: string;
  /** The one file the model is. */
  fileName: string;
  /** Exact bytes of the file — the download's and the presence check's truth. */
  sizeBytes: number;
  /** Peak memory the recognition context holds, in bytes. */
  ramBytes: number;
  /** The download URL. */
  url: string;
};

const HF = (repo: string, file: string) =>
  `https://huggingface.co/${repo}/resolve/main/${file}`;

const MODELS: readonly OnDeviceModel[] = [
  {
    id: "gemma-4-e2b",
    name: "Gemma 4 E2B",
    fileName: "gemma-4-E2B-it-Q4_K_M.gguf",
    sizeBytes: 3_106_738_272,
    ramBytes: 2_700_000_000,
    url: HF("unsloth/gemma-4-E2B-it-GGUF", "gemma-4-E2B-it-Q4_K_M.gguf"),
  },
  {
    id: "gemma-4-e4b",
    name: "Gemma 4 E4B",
    fileName: "gemma-4-E4B-it-Q4_K_M.gguf",
    sizeBytes: 4_977_171_584,
    ramBytes: 4_300_000_000,
    url: HF("unsloth/gemma-4-E4B-it-GGUF", "gemma-4-E4B-it-Q4_K_M.gguf"),
  },
] as const;

/** The smaller model — the default choice when nothing is stored. */
export const DEFAULT_ON_DEVICE_MODEL = MODELS[0];

const BY_ID = new Map(MODELS.map((model) => [model.id, model]));

/**
 * Every model id, in catalog order — the schema below derives from this, so
 * adding a model to the catalog IS adding it to the schema (no second list to
 * forget, whose failure would be silent: an unparsed id falls back to E2B).
 */
const ON_DEVICE_MODEL_IDS = MODELS.map((model) => model.id) as [
  OnDeviceModelId,
  ...OnDeviceModelId[],
];

// The id's runtime schema lives with the ids it validates, in this pure
// module: consumers on either side of the test boundary (the preference
// store AND the download reattach path, which reads ids back from the native
// downloader) validate through the one schema instead of hand-written
// membership checks (AGENTS.md, Validation).
export const ON_DEVICE_MODEL_SCHEMA = z.enum(ON_DEVICE_MODEL_IDS);

/** Every model, smallest first — the order the settings screen lists them. */
export const ON_DEVICE_MODELS = MODELS;

/** Resolves an id to its model; the default when the id is unknown. */
export function onDeviceModel(id: OnDeviceModelId): OnDeviceModel {
  return BY_ID.get(id) ?? DEFAULT_ON_DEVICE_MODEL;
}
