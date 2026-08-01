import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SQLite from "expo-sqlite";

// Central key-value store backed by expo-sqlite on native. The web build is
// overridden by `kv-store.web.ts` (AsyncStorage), because expo-sqlite's web
// backend needs extra bundler and cross-origin-isolation setup that isn't
// worth it while the web build is on hold. The API mirrors AsyncStorage
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
// one all-or-nothing commit. Used by net-worth-history's migration so the
// converted snapshots and the migration marker can't be split by a crash or a
// rejected write — a partial commit (data written, marker not) would let the
// next launch re-migrate already-converted data and double every total.
export async function withTransaction(
  work: () => Promise<void>,
): Promise<void> {
  const database = await ensureDatabase();
  await database.withTransactionAsync(work);
}
