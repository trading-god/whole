import {
  type ProviderConfig,
  type StructuredOutputMode,
  providerConfigSchema,
} from "@whole/llm";
import * as SecureStore from "expo-secure-store";

import { getItem, removeItem, setItem } from "@/storage/kv-store";

// Where the user's model endpoint lives, split across two stores on purpose.
//
// The API key goes to `expo-secure-store` — the Keychain on iOS, the Keystore
// on Android. Everything else goes to `kv-store`, which is PLAINTEXT sqlite: a
// key sitting there is a credential in a file that every backup copies, and no
// other setting in this app is a credential.
//
// The split is the whole reason this module exists rather than the config being
// one more `createCachedPreferenceStore` call.

const PROVIDER_KEY = "whole.model.provider";
const API_KEY_KEY = "whole.model.apiKey";
const CONSENT_KEY = "whole.model.consentHost";

/** The provider config minus its key — what is safe to keep in plaintext. */
const storedProviderSchema = providerConfigSchema.omit({ apiKey: true });

export async function loadProviderConfig(): Promise<ProviderConfig | null> {
  const raw = await getItem(PROVIDER_KEY);
  if (raw === null) {
    return null;
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    // A settings record the app can no longer read is treated as no
    // configuration. The alternative is a crash on launch over a preference.
    return null;
  }

  const parsed = storedProviderSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return null;
  }

  const apiKey = await SecureStore.getItemAsync(API_KEY_KEY);
  return apiKey === null ? parsed.data : { ...parsed.data, apiKey };
}

export async function saveProviderConfig(
  config: ProviderConfig,
): Promise<void> {
  const { apiKey, ...rest } = config;

  await setItem(PROVIDER_KEY, JSON.stringify(rest));

  if (apiKey === undefined || apiKey.length === 0) {
    // Switching from a hosted endpoint to a local one must not leave the old
    // credential behind in the Keychain.
    await SecureStore.deleteItemAsync(API_KEY_KEY);
    return;
  }

  await SecureStore.setItemAsync(API_KEY_KEY, apiKey);
}

/**
 * Records what an endpoint turned out to support, so the probe runs once rather
 * than on every request.
 */
export async function recordStructuredOutput(
  mode: StructuredOutputMode,
): Promise<void> {
  const config = await loadProviderConfig();
  if (config === null) {
    return;
  }

  await saveProviderConfig({ ...config, structuredOutput: mode });
}

/**
 * Forgets the endpoint entirely — config, credential, and consent.
 *
 * Consent goes with it deliberately: it was given for a destination, and there
 * is no destination any more.
 */
export async function clearProviderConfig(): Promise<void> {
  await removeItem(PROVIDER_KEY);
  await removeItem(CONSENT_KEY);
  await SecureStore.deleteItemAsync(API_KEY_KEY);
}

/**
 * Whether the user has agreed to text being sent to this host.
 *
 * Consent is to a DESTINATION, not to the feature. Pointing the app at someone
 * else's server is a new decision — a loopback address and a company in another
 * country are not the same promise — so agreement does not carry across hosts.
 */
export async function hasConsentedTo(host: string): Promise<boolean> {
  return (await getItem(CONSENT_KEY)) === host;
}

export async function recordConsent(host: string): Promise<void> {
  await setItem(CONSENT_KEY, host);
}
