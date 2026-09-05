// The single source of truth for the model the app bundles.
//
// Everything that describes the WEIGHTS — which files the native bundles
// carry, how big each is — is read from here, never re-declared at a call
// site: the settings card prints this size. How the runtime spends them (the
// context window, the output ceiling, the temperature) is the recognition
// turn's contract, not the weights', and lives in `@whole/ocr`'s
// `ANNOTATION_INFERENCE`.
//
// The weights ship as a SPLIT GGUF, carried into the native bundles by
// `plugins/with-whole-model.js` (never through Metro — the JS asset pipeline
// cannot carry multi-gigabyte files). Two reasons for the split: Android's
// APK is a zip, where sub-2-GiB members stay clear of zip64 edge cases on
// older extractors, and llama.cpp loads split models by pointing at the
// FIRST shard, which finds the rest by the `-00001-of-000NN` naming
// convention. The engine treats the set as one model.
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

export const BUNDLED_MODEL = {
  name: "Gemma 4 E2B",
  /**
   * The bundled shards, in load order. The FIRST shard is the path the
   * runtime is handed (llama.cpp resolves its siblings by name) and the name
   * of the copy on Android.
   */
  shards: SHARDS,
  /** The first shard, as the runtime sees it. */
  fileName: SHARDS[0].fileName,
  /** Exact bytes of the whole model, all shards together. */
  sizeBytes: SHARDS.reduce((total, shard) => total + shard.sizeBytes, 0),
} as const;
