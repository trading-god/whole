import * as SecureStore from "expo-secure-store";
import { getItem, removeItem, setItem } from "@/storage/kv-store";
import { Platform } from "react-native";
import { z } from "zod";

// The OpenAI-compatible endpoint, key, and model the user fills in on the
// settings screen. Stored in the device keystore when available (iOS/Android),
// with a key-value store fallback (sqlite on native, AsyncStorage on web)
// where SecureStore is not supported.
// 单一的「合法 LLM 配置」定义：baseUrl 与 model 必填（trim 后非空），apiKey
// 可选（trim）。settings 表单校验与 resolveLlmConfig 运行时守卫共用此 schema，
// 避免「什么是一个合法配置」在两处分别表达而漂移。
export const llmConfigSchema = z.object({
  baseUrl: z.string().trim().min(1),
  apiKey: z.string().trim(),
  model: z.string().trim().min(1),
});

export type LlmConfig = z.infer<typeof llmConfigSchema>;

// Whether any field holds a non-empty value — the "treat an all-empty form as a
// skip / clearable" heuristic shared by Settings (Clear gating) and onboarding
// (finish/skip gating). Lives next to the schema so the field set has one owner.
export function hasLlmConfigContent(config: {
  baseUrl: string;
  apiKey: string;
  model: string;
}): boolean {
  return [config.baseUrl, config.apiKey, config.model].some(
    (value) => value.trim().length > 0,
  );
}

const BASE_URL_KEY = "whole.llm.baseUrl";
const API_KEY_KEY = "whole.llm.apiKey";
const MODEL_KEY = "whole.llm.model";

let secureStorePromise: Promise<boolean> | null = null;

// Cached as a promise so concurrent callers (loadLlmConfig/saveLlmConfig/
// clearLlmConfig each fan out 3 reads/writes via Promise.all) share a single
// in-flight availability check instead of each triggering its own native
// bridge round-trip on first use.
function secureStoreAvailable(): Promise<boolean> {
  if (Platform.OS === "web") {
    return Promise.resolve(false);
  }

  if (!secureStorePromise) {
    secureStorePromise = SecureStore.isAvailableAsync();
  }

  return secureStorePromise;
}

// The key-value store is the fallback source of truth: a value lives there
// when a SecureStore write rejected and the stale SecureStore entry couldn't
// be deleted, so its value wins on conflict. The two reads are independent,
// so run them concurrently and prefer the kv value when both resolve — this
// keeps the kv read off the SecureStore read's critical path instead of
// serializing two native bridge round-trips per key.
const readValue = async (key: string): Promise<string | null> => {
  const useSecure = await secureStoreAvailable();
  const [kvValue, secureValue] = await Promise.all([
    getItem(key),
    useSecure ? SecureStore.getItemAsync(key).catch(() => null) : null,
  ]);
  return kvValue !== null ? kvValue : secureValue;
};

// Writes try SecureStore first and fall back to the key-value store. On
// fallback we also delete any stale SecureStore value so a later read doesn't
// return the old value instead of the fresh key-value store one.
const writeValue = async (key: string, value: string): Promise<void> => {
  if (await secureStoreAvailable()) {
    try {
      await SecureStore.setItemAsync(key, value);
      // Clear the kv-store fallback so a stale value left by a prior failed
      // write can't shadow this fresh SecureStore value on the next read
      // (readValue checks the kv-store first). Best-effort: a failure leaves
      // the stale entry, but the SecureStore value is authoritative now.
      try {
        await removeItem(key);
      } catch {
        // Best-effort: a failure leaves a stale kv-store entry that shadows the
        // fresh SecureStore value on read (readValue checks the kv-store first).
        // The kv-first read is deliberate — it keeps a fallback (SecureStore-
        // rejected) kv write from being shadowed by a stale SecureStore value —
        // so this rare removeItem-failure shadow is the accepted trade-off.
      }
      return;
    } catch {
      try {
        await SecureStore.deleteItemAsync(key);
      } catch {
        // Ignore; the key-value store write below is the source of truth now.
      }
    }
  }

  await setItem(key, value);
};

// A value may live in either store (a write falls back to the key-value store
// when SecureStore rejects), so clear both to guarantee the value is gone.
// `readValue` falls back to SecureStore when the kv-store is empty, so a failed
// SecureStore delete would resurrect the value on the next read — surface that
// failure instead of swallowing it: clearLlmConfig rejects, the caller reports
// the error, the form stays populated, and the user can retry. (When SecureStore
// is unavailable, e.g. on web, the delete is skipped and only the kv-store
// clears.)
const deleteValue = async (key: string): Promise<void> => {
  const clearSecureStore = async () => {
    if (await secureStoreAvailable()) {
      await SecureStore.deleteItemAsync(key);
    }
  };
  // The two deletes target different backends with no data dependency, so run
  // them concurrently — but a SecureStore delete failure rejects the whole
  // operation (see above) rather than leaving a resurrectable value behind.
  await Promise.all([clearSecureStore(), removeItem(key)]);
};

// Raw stored values, blank when unset — used to populate the settings form.
export async function loadLlmConfig(): Promise<LlmConfig> {
  const [baseUrl, apiKey, model] = await Promise.all([
    readValue(BASE_URL_KEY),
    readValue(API_KEY_KEY),
    readValue(MODEL_KEY),
  ]);

  return {
    baseUrl: baseUrl ?? "",
    apiKey: apiKey ?? "",
    model: model ?? "",
  };
}

// A config ready for the OpenAI client. Returns null until the user has
// filled in the required endpoint and model so callers can guide them to set
// it up first. The API key may be blank for endpoints that don't require one.
export async function resolveLlmConfig(): Promise<LlmConfig | null> {
  const config = await loadLlmConfig();
  const result = llmConfigSchema.safeParse(config);
  return result.success ? result.data : null;
}

export async function saveLlmConfig(config: LlmConfig): Promise<void> {
  await Promise.all([
    writeValue(BASE_URL_KEY, config.baseUrl),
    writeValue(API_KEY_KEY, config.apiKey),
    writeValue(MODEL_KEY, config.model),
  ]);
}

export async function clearLlmConfig(): Promise<void> {
  await Promise.all([
    deleteValue(BASE_URL_KEY),
    deleteValue(API_KEY_KEY),
    deleteValue(MODEL_KEY),
  ]);
}
