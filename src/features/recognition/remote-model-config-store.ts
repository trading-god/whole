import { z } from "zod";
import * as SecureStore from "expo-secure-store";

import { getItem, setItem } from "@/storage/kv-store";

// The user's own remote model endpoint — the "bring your own service" engine.
//
// What is stored where is a privacy decision, not an implementation detail:
// the API key is a live credential for a third-party service, so it lives in
// `expo-secure-store` (the Keychain on iOS, which survives even an uninstall —
// the same reasoning `legacy-model-keys.ts` records for the key it sweeps).
// The non-secret parts (base URL, model name) are UI state the settings screen
// re-renders from and live in the ordinary kv-store.
//
// The base URL is stored WITHOUT a trailing slash and WITHOUT the
// `/chat/completions` suffix — the runner appends the path, so a user who
// pastes either form of the same endpoint ends up with the same request.
// `https://` required: the app's ATS policy allows no cleartext, and a
// credential sent over http:// would be readable on the wire. The settings
// form says this in words; the schema enforces it.
const CONFIG_KEY = "whole.recognition.remote.config";
const API_KEY_STORE_KEY = "whole.recognition.remote.apiKey";

export const remoteBaseUrlSchema = z
  .string()
  .trim()
  .regex(
    /^https:\/\/[^\s/]+([^\s]*[^\s/])?$/,
    "Base URL must be an https:// address",
  );

export const remoteConfigSchema = z.object({
  baseUrl: remoteBaseUrlSchema,
  // Which model the endpoint serves — OpenAI-compatible providers name it
  // (e.g. "deepseek-chat", "gpt-4o-mini"); the user copies it from their
  // provider's console.
  model: z.string().trim().min(1),
});
export type RemoteModelConfig = z.infer<typeof remoteConfigSchema>;

/**
 * Loads the endpoint config, with the API key substituted back in.
 *
 * The two halves are stored apart (see the module comment), so every read is a
 * join — and a Keychain failure must not read as "no config": the config is
 * still there, only the key is unreadable. The key comes back as `null` and the
 * settings screen says the service needs the key re-entered.
 */
export async function loadRemoteModelConfig(): Promise<
  (RemoteModelConfig & { apiKey: string | null }) | null
> {
  const raw = await getItem(CONFIG_KEY);
  if (raw === null) {
    return null;
  }
  const parsed = remoteConfigSchema.safeParse(JSON.parse(raw) as unknown);
  if (!parsed.success) {
    return null;
  }
  const credentials = await SecureStore.getItemAsync(API_KEY_STORE_KEY).catch(
    () => null,
  );
  return { ...parsed.data, apiKey: credentials };
}

/** Saves the non-secret config; `null` leaves the stored key untouched. */
export async function saveRemoteModelConfig(
  config: RemoteModelConfig,
  apiKey: string | null,
): Promise<void> {
  await setItem(CONFIG_KEY, JSON.stringify(config));
  if (apiKey !== null) {
    await SecureStore.setItemAsync(API_KEY_STORE_KEY, apiKey);
  }
}

/** Clears both halves — the endpoint AND its credential. */
export async function clearRemoteModelConfig(): Promise<void> {
  await setItem(CONFIG_KEY, JSON.stringify(null));
  await SecureStore.deleteItemAsync(API_KEY_STORE_KEY).catch(() => {});
}

/** Loads ONLY the stored API key — for the runner, which has the config already. */
export async function loadRemoteApiKey(): Promise<string | null> {
  return SecureStore.getItemAsync(API_KEY_STORE_KEY).catch(() => null);
}

/**
 * Normalizes a pasted base URL: trims, strips trailing slashes, so the runner's
 * path append lands on `…/v1` rather than `…/v1//chat/completions`.
 */
export function normalizeRemoteBaseUrl(input: string): string {
  return input.trim().replace(/\/+$/, "");
}
