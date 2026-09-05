// A `RunModel` backed by node-llama-cpp, over the same GGUF the app bundles.
//
// This is the eval harness's half of the on-device contract: the app loads the
// bundled weights through llama.rn, this loads them through node-llama-cpp,
// and BOTH steer decoding with the grammar the engine compiled
// (`attempt.grammar`, from `@whole/ocr`'s vendored llama.cpp converter) and the
// same `ANNOTATION_INFERENCE` params. One grammar compiler and one set of
// params feeding both runtimes is what makes this a verdict on the weights,
// the prompt and the grammar the app ships — a different converter here would
// measure a different feature.
//
// What is NOT identical is the chat templating. Both sides apply the GGUF's own
// jinja template — llama.rn defaults `jinja` on when the model carries one
// (`getFormattedChat`), and node-llama-cpp resolves a JS `ChatWrapper` for the
// architecture — but they are two implementations of it, so the framing around
// the turns is not guaranteed byte-identical. Read a verdict here as a verdict
// on the model, the prompt and the contract, not on the exact tokens.
//
// Do NOT "align" them by forcing llama.rn's legacy path: the bundled
// llama.cpp's `llm_chat_detect_template` has no case for Gemma 4's turn
// markers, so it throws rather than falling back, and every recognition
// becomes a load failure.
//
// One chat context per ATTEMPT, not per sample: the engine's retry appends a
// correction to the user turn and expects the model to see only
// [system, user], which is exactly what the app sends. A session that
// accumulated the failed attempt's answer would evaluate a different prompt
// shape.
import { ANNOTATION_INFERENCE, type RunModel } from "@whole/ocr";
import { LlamaChatSession, getLlama, type LlamaGrammar } from "node-llama-cpp";

/** Where the harness looks for the GGUF. */
const GGUF_PATH_ENV = "WHOLE_GGUF_PATH";

type LlamaRunModelHandle = {
  runModel: RunModel;
  /** The GGUF this run loaded, for the caller's banner. */
  ggufPath: string;
  /** Frees the loaded model and its context. Call once, at the end. */
  dispose: () => Promise<void>;
};

export async function createLlamaRunModel(): Promise<LlamaRunModelHandle> {
  const ggufPath = process.env[GGUF_PATH_ENV];
  if (!ggufPath) {
    throw new Error(
      `No model weights: set ${GGUF_PATH_ENV} to the Gemma GGUF the app bundles.`,
    );
  }

  const llama = await getLlama();
  const model = await llama.loadModel({ modelPath: ggufPath });
  const context = await model.createContext({
    contextSize: ANNOTATION_INFERENCE.contextWindow,
  });

  // ONE sequence for the whole run. Attempting to take and dispose a fresh
  // sequence per attempt ran out of them by the second sample ("No sequences
  // left"): the context does not return a disposed sequence to its pool
  // promptly, and a serial harness has no reason to want more than one. The
  // SESSION is what resets — a fresh one per attempt, disposed after — so the
  // model still sees exactly [system, user] with nothing carried over from a
  // failed attempt. (v3's session has no clearChatHistory; disposal is the
  // reset.)
  const sequence = context.getSequence();

  // Compiled once: `RecognitionAttempt.grammar` is invariant across attempts,
  // so one instance covers the whole run.
  let grammar: LlamaGrammar | undefined;

  const runModel: RunModel = async (attempt) => {
    grammar ??= await llama.createGrammar({ grammar: attempt.grammar });

    const session = new LlamaChatSession({
      contextSequence: sequence,
      systemPrompt: attempt.system,
    });
    try {
      return await session.prompt(attempt.user, {
        grammar,
        maxTokens: ANNOTATION_INFERENCE.maxOutputTokens,
        temperature: ANNOTATION_INFERENCE.temperature,
      });
    } finally {
      // `disposeSequence` defaults to false: the sequence survives for the
      // next attempt.
      session.dispose();
    }
  };

  return {
    runModel,
    ggufPath,
    dispose: async () => {
      sequence.dispose();
      context.dispose();
      await model.dispose();
    },
  };
}
