// One-time removal of the storage the bring-your-own-endpoint era left behind.
//
// It lives here rather than in a feature because every key it touches is
// storage and nothing else: the feature that wrote them is gone.
//
// `whole.model.provider` (the endpoint config, sans key) and
// `whole.model.consentHost` (the per-host consent record) lived in kv-store;
// `whole.model.apiKey` lived in `expo-secure-store` — the Keychain on iOS,
// which survives even an uninstall. All three became orphans when recognition
// moved to the bundled on-device model: nothing reads them, so they are
// harmless — but a row of stale consent state and a live credential describing
// a host nothing ever contacts are exactly the kind of thing that confuses a
// future reader of the sqlite dump, and a secret that outlives the app.
//
// Swept once per install, best-effort. The two kv deletes and the marker share
// one transaction, so the sweep can only retire itself by actually having run:
// a rollback takes the marker with the deletes, and the next launch tries
// again.
//
// Reading the rows back instead of committing them together does NOT work, and
// that is why this is a transaction: `withTransactionAsync` shares the one
// connection, so a read issued between the deletes and the marker sees the
// UNCOMMITTED deletes and reports success even when the transaction they
// landed in is about to roll them back.
//
// The Keychain delete runs before it — `withTransactionAsync` cannot roll a
// Keychain write back, so putting it inside would buy no atomicity while
// holding the sqlite write lock open across a native call. Its failure is
// swallowed rather than allowed to abort the rest: a Keychain error is not the
// kind a later launch fixes, so letting it through would only leave the two kv
// rows unswept too, on every launch, forever.
//
// This is temporary by construction. When it goes, `expo-secure-store` goes
// with it — nothing else in the app uses it — so delete both together once
// enough installs have launched past this (say, two releases after the one
// that ships it).
import * as SecureStore from "expo-secure-store";

import {
  getItem,
  removeItem,
  setItem,
  withTransaction,
} from "@/storage/kv-store";

const LEGACY_KV_KEYS = ["whole.model.provider", "whole.model.consentHost"];
const LEGACY_SECURE_KEY = "whole.model.apiKey";
const SWEPT_KEY = "whole.model.legacyKeysSwept";

export async function removeLegacyModelKeys(): Promise<void> {
  if ((await getItem(SWEPT_KEY)) !== null) {
    return;
  }
  await SecureStore.deleteItemAsync(LEGACY_SECURE_KEY).catch(() => {});
  await withTransaction(async () => {
    await Promise.all(LEGACY_KV_KEYS.map((key) => removeItem(key)));
    await setItem(SWEPT_KEY, "1");
  });
}
