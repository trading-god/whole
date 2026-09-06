// The single source of truth for the model the app uses.
//
// Everything that describes the WEIGHTS — which files exist, how big each is,
// where each is downloaded from — is read from here, never re-declared at a
// call site: the settings card prints this size, the downloader reads these
// URLs. How the runtime spends them (the context window, the output ceiling,
// the temperature) is the recognition turn's contract, not the weights', and
// lives in `@whole/ocr`'s `ANNOTATION_INFERENCE`.
//
// The weights are a SPLIT GGUF, downloaded on demand into filesDir rather than
// bundled into the install (the base APK's 150 MB Play cap and a 3 GB iOS
// download made bundling a dead end for distribution; see
// `model-download.ts` for that machinery). Three reasons for the split:
// Android's APK is a zip, where sub-2-GiB members stay clear of zip64 edge
// cases on older extractors; llama.cpp loads split models by pointing at the
// FIRST shard, which finds the rest by the `-00001-of-000NN` naming
// convention; and per-shard progress is what makes an honest download bar —
// the engine treats the set as one model.
//
// The URLs are Hugging Face's resolve endpoint, which redirects to CDN
// storage and serves `Content-Length` — the two things a resumable,
// progress-reporting download needs. HTTPS-only, matching the app's ATS
// policy.
const HF_REPO = "ggml-org/gemma-4-E2B-it-GGUF";

const SHARDS = [
  {
    fileName: "gemma-4-E2B-it-Q4_K_M.gguf-00001-of-00003.gguf",
    sizeBytes: 43_316_608,
  },
  {
    fileName: "gemma-4-E2B-it-Q4_K_M.gguf-00002-of-00003.gguf",
    sizeBytes: 1_614_807_232,
  },
  {
    fileName: "gemma-4-E2B-it-Q4_K_M.gguf-00003-of-00003.gguf",
    sizeBytes: 1_448_614_752,
  },
] as const;

/** One shard's download URL — the resolve endpoint serves it via CDN redirect. */
export function shardUrl(fileName: string): string {
  return `https://huggingface.co/${HF_REPO}/resolve/main/${fileName}`;
}

export const BUNDLED_MODEL = {
  name: "Gemma 4 E2B",
  /**
   * The model's shards, in load order. The FIRST shard is the path the
   * runtime is handed (llama.cpp resolves its siblings by name).
   */
  shards: SHARDS,
  /** The first shard, as the runtime sees it. */
  fileName: SHARDS[0].fileName,
  /** Exact bytes of the whole model, all shards together. */
  sizeBytes: SHARDS.reduce((total, shard) => total + shard.sizeBytes, 0),
} as const;
