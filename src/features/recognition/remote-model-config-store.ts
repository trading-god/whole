import * as SecureStore from "expo-secure-store";

import { readJson, removeItem, setItem } from "@/storage/kv-store";
import {
  type RemoteModelConfig,
  remoteConfigSchema,
} from "@/features/recognition/remote-config-schema";

// The user's own remote model endpoint — the "bring your own service" engine.
//
// What is stored where is a privacy decision, not an implementation detail:
// the API key is a live credential for a third-party service, so it lives in
// `expo-secure-store` (the Keychain on iOS, which survives even an uninstall —
// the same reasoning `legacy-model-keys.ts` records for the key it sweeps).
// The non-secret parts (base URL, model name) are UI state the settings screen
// re-renders from and live in the ordinary kv-store.
//
// The config's shape lives in `remote-config-schema.ts` — the native-free
// module; import the schema and normalizer from THERE, not from this store.
// Re-exporting them here would leave two import paths for the same symbols,
// and a reader could not tell which one is canonical.
const CONFIG_KEY = "whole.recognition.remote.config";
const API_KEY_STORE_KEY = "whole.recognition.remote.apiKey";

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
  const raw = await readJson(CONFIG_KEY);
  if (raw === null) {
    return null;
  }
  const parsed = remoteConfigSchema.safeParse(raw);
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
  await removeItem(CONFIG_KEY);
  await SecureStore.deleteItemAsync(API_KEY_STORE_KEY).catch(() => {});
}
