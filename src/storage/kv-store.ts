import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SQLite from "expo-sqlite";

// Central key-value store backed by expo-sqlite. The API mirrors AsyncStorage
// (getItem/setItem/removeItem) so feature modules swap over with no other
// changes.
const DB_NAME = "whole.db";
// Marker lives only in sqlite (never AsyncStorage), so the migration check
// can't feed back into itself.
const MIGRATED_KEY = "whole.__kv.migrated";
const LEGACY_PREFIX = "whole.";

let readyPromise: Promise<SQLite.SQLiteDatabase> | null = null;

// One-time migration of existing AsyncStorage data (keys under "whole.") into
// sqlite, so users keep their accounts/rates/history after the storage swap.
// Idempotent: guarded by MIGRATED_KEY. Old AsyncStorage keys are left in place
// for easy rollback rather than deleted.
async function migrateFromAsyncStorage(
  database: SQLite.SQLiteDatabase,
): Promise<void> {
  const marker = await database.getFirstAsync<{ value: string }>(
    "SELECT value FROM kv WHERE key = ?",
    MIGRATED_KEY,
  );
  if (marker) {
    return;
  }

  const keys = await AsyncStorage.getAllKeys();
  const legacyKeys = keys.filter((key) => key.startsWith(LEGACY_PREFIX));
  const pairs = await AsyncStorage.multiGet(legacyKeys);

  // Write every legacy entry and the migration marker in one transaction so
  // the batch shares a single commit (one fsync) instead of one per row, and
  // the marker can't survive a partial write if migration is interrupted.
  await database.withTransactionAsync(async () => {
    for (const [key, value] of pairs) {
      if (typeof value === "string") {
        await database.runAsync(
          "INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)",
          key,
          value,
        );
      }
    }
    await database.runAsync(
      "INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)",
      MIGRATED_KEY,
      "1",
    );
  });
}

// Opens the database, creates the schema, and runs the legacy migration once.
// The promise is cached so concurrent first callers share a single init (no
// races — e.g. useAssetAccounts' Promise.all on load).
function ensureDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!readyPromise) {
    readyPromise = (async () => {
      const database = await SQLite.openDatabaseAsync(DB_NAME);
      await database.execAsync(
        "CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
      );
      await migrateFromAsyncStorage(database);
      return database;
    })();
    // A transient failure (e.g. a bad legacy value during migration) must not
    // permanently break storage: without this, `readyPromise` would hold a
    // rejected promise forever and every subsequent read/write would fail until
    // the app is killed and restarted. Reset on rejection so the next call
    // retries; current awaiters still see the error (it is re-thrown).
    readyPromise = readyPromise.catch((error) => {
      readyPromise = null;
      throw error;
    });
  }
  return readyPromise;
}

export async function getItem(key: string): Promise<string | null> {
  const database = await ensureDatabase();
  const row = await database.getFirstAsync<{ value: string }>(
    "SELECT value FROM kv WHERE key = ?",
    key,
  );
  return row?.value ?? null;
}

// Reads a key stored as JSON, yielding null when it is absent or the stored
// text no longer parses. Owned here because the guard is easy to get subtly
// wrong: `JSON.parse` throws a SyntaxError that a zod `safeParse` around it
// would NOT absorb, so every stored record needs the try — and a store that
// forgets it turns one corrupt row into a crash on launch. Callers keep their
// own schema cascade (version fallbacks, legacy shapes) over the result.
//
// A storage failure still rejects: absorbing it here would hide a broken
// database behind "no data", and each caller already decides whether an
// unreadable store degrades or propagates.
//
// Not for stores that must tell an absent key from a corrupt one — this
// collapses both to null. `asset-repository` and `net-worth-history` parse
// their own text for exactly that reason: for them "absent" means start fresh
// and "corrupt" means refuse to write, and conflating the two destroys data.
export async function readJson(key: string): Promise<unknown> {
  const raw = await getItem(key);
  if (raw === null) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function setItem(key: string, value: string): Promise<void> {
  const database = await ensureDatabase();
  await database.runAsync(
    "INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)",
    key,
    value,
  );
}

export async function removeItem(key: string): Promise<void> {
  const database = await ensureDatabase();
  await database.runAsync("DELETE FROM kv WHERE key = ?", key);
}

// Runs `work` inside a single sqlite transaction so a batch of writes shares
// one all-or-nothing commit. Used by net-worth-history's migration, where the
// upgraded history and the retirement of the legacy base marker have to land
// together: reads dispatch on the record's `version`, so a leftover marker
// would be inert rather than harmful, but the store would then hold a marker
// naming a base that no longer describes the data it labels — a contradiction
// the next migration would have to reason about.
export async function withTransaction(
  work: () => Promise<void>,
): Promise<void> {
  const database = await ensureDatabase();
  await database.withTransactionAsync(work);
}
