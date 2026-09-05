// The app-side `RunModel` over the on-device runtime (llama.rn / llama.cpp).
//
// This is the recognition half of the engine's injected seam: the engine
// (in `@whole/ocr`) knows only "a model call is a function from an attempt to
// raw text". Everything about HOW the text is produced — weights, context
// lifecycle, grammar-constrained decoding — lives here and in
// `features/on-device-model`, where the native module is real.
import { ANNOTATION_INFERENCE, type RunModel } from "@whole/ocr";

import { completeOnDevice } from "@/features/on-device-model/model-context";

/**
 * A `RunModel` that answers each attempt with an on-device completion.
 *
 * A constant, not a factory: nothing is captured or configured per
 * recognition, and `completeOnDevice` owns the context's lifecycle.
 *
 * The completion is grammar-constrained: the engine's compiled GBNF makes a
 * malformed answer unreturnable, so a failure means the model could not
 * finish, not that it misbehaved (`completeOnDevice` owns that mapping).
 * Temperature is 0 — the task is a contract, not a conversation.
 */
export const runOnDeviceModel: RunModel = async (attempt) => {
  const result = await completeOnDevice({
    messages: [
      { role: "system", content: attempt.system },
      { role: "user", content: attempt.user },
    ],
    n_predict: ANNOTATION_INFERENCE.maxOutputTokens,
    temperature: ANNOTATION_INFERENCE.temperature,
    grammar: attempt.grammar,
    // llama.rn defaults this ON (`params?.enable_thinking ?? true`), and
    // Gemma 4's chat template then opens a reasoning channel the grammar makes
    // unfillable — it forces `{` as the very first token. The answer is a
    // contract, not a chain of thought.
    enable_thinking: false,
  });
  return result.content;
};
