import { z } from "zod";

import { createCachedPreferenceStore } from "@/storage/cached-preference-store";

// Which recognition engine the user has chosen — the single preference that
// decides what `screenshot-recognition` hands the engine as its `RunModel`.
//
// `on-device` keeps the privacy the app was built around (nothing leaves the
// phone, works offline); `remote` trades that for a stronger model behind the
// user's own OpenAI-compatible endpoint (their base URL, their key). The
// default is deliberately `on-device`: the app's promise is local-only, and a
// remote endpoint is something a user opts INTO, never something the app
// falls back to on its own (see the privacy note in the settings screen).
//
// A string enum, not a boolean: a third engine (or a second local model)
// would otherwise force a migration of every stored value.
export const RECOGNITION_ENGINE_SCHEMA = z.enum(["on-device", "remote"]);
export type RecognitionEngine = z.infer<typeof RECOGNITION_ENGINE_SCHEMA>;

const ENGINE_KEY = "whole.recognition.engine";

const engineStore = createCachedPreferenceStore(
  ENGINE_KEY,
  RECOGNITION_ENGINE_SCHEMA,
);

export const loadRecognitionEngine = engineStore.load;
export const saveRecognitionEngine = engineStore.save;
