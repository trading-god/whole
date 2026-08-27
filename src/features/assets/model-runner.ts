import {
  type LlmFetch,
  type LlmUsage,
  type ProviderConfig,
  sendChat,
} from "@whole/llm";
import type { RecognitionAttempt, RunModel } from "@whole/ocr";

// The join between the recognition loop and the user's endpoint: it turns one
// `RecognitionAttempt` into one chat turn and hands back the raw text.
//
// Deliberately thin, and deliberately pure. `fetchImpl` is a parameter, so this
// module imports no Expo and no React Native and stays testable under plain
// Node — the app supplies React Native's real `fetch` at the call site. The
// same property is what keeps `@whole/llm` free of globals; this is the last
// place it could have been given up, and it is not.

/**
 * How many tokens a turn may produce when the model states no limit of its own.
 *
 * This has to cover REASONING, not just the answer, and that is the whole
 * reason it is this large. A reasoning model spends output tokens thinking
 * before it emits a single character of JSON, and those count against the same
 * budget — so a ceiling sized for the answer alone truncates the reply
 * mid-thought. The recognition then fails having already spent every token it
 * was going to spend, which is the worst of both outcomes.
 *
 * The answer itself really is short: a screen full of accounts is a few hundred
 * tokens of indices. The headroom is entirely for the thinking in front of it.
 *
 * An endpoint that caps lower will reject a request asking for more, which is
 * why `models[].maxTokens` exists and why the settings screen exposes it — the
 * per-model value always wins.
 */
export const DEFAULT_MAX_OUTPUT_TOKENS = 16384;

export type ModelRunnerOptions = {
  config: ProviderConfig;
  /** Which of the configured models to use for this recognition. */
  model: string;
  fetchImpl: LlmFetch;
  /**
   * Called once per turn with what it cost.
   *
   * Every retry is a turn the user pays for, so each one is reported rather
   * than only the last. Tokens only — the price of a bring-your-own endpoint is
   * not knowable here, and a wrong figure would be worse than none.
   */
  onUsage?: (usage: LlmUsage) => void;
};

export function createModelRunner({
  config,
  model,
  fetchImpl,
  onUsage,
}: ModelRunnerOptions): RunModel {
  const maxTokens =
    config.models.find((entry) => entry.id === model)?.maxTokens ??
    DEFAULT_MAX_OUTPUT_TOKENS;

  return async (attempt: RecognitionAttempt) => {
    // Failures propagate as `LlmError`, classified. The recognition loop retries
    // what a reworded prompt can fix; a mistyped key or an exhausted quota is
    // not that, and the app needs the classification to say so.
    const result = await sendChat(
      config,
      {
        model,
        system: attempt.system,
        user: attempt.user,
        maxTokens,
        schemaName: attempt.schemaName,
        schema: attempt.schema,
      },
      fetchImpl,
    );

    onUsage?.(result.usage);
    return result.text;
  };
}
