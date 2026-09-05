import { beforeEach, describe, expect, it, jest } from "@jest/globals";

// A fake sqlite database that records the SQL it was asked to run and serves a
// simple key/value table. The point is kv-store's OWN logic — namespacing, JSON
// handling, the one-time migration, the init cache — not sqlite's behaviour,
// which belongs to expo-sqlite.
type Row = { value: string };

const mockDatabase = {
  rows: new Map<string, string>(),
  execAsync: jest.fn<(sql: string) => Promise<void>>(),
  getFirstAsync: jest.fn<(sql: string, key: string) => Promise<Row | null>>(),
  runAsync: jest.fn<(sql: string, ...args: string[]) => Promise<void>>(),
  withTransactionAsync: jest.fn<(work: () => Promise<void>) => Promise<void>>(),
};

const mockOpenDatabaseAsync = jest.fn<() => Promise<typeof mockDatabase>>();
const mockGetAllKeys = jest.fn<() => Promise<string[]>>();
// Takes the keys it is given, because the `whole.` filter happens BEFORE this
// call — a mock that ignored the argument would report the filter working when
// it was not being applied at all.
const mockMultiGet =
  jest.fn<(keys: string[]) => Promise<[string, string | null][]>>();
const mockLegacyStore = new Map<string, string | null>();

jest.mock("expo-sqlite", () => ({
  openDatabaseAsync: () => mockOpenDatabaseAsync(),
}));

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getAllKeys: () => mockGetAllKeys(),
    multiGet: (keys: string[]) => mockMultiGet(keys),
  },
}));

const MIGRATED_KEY = "whole.__kv.migrated";

// The store caches its init promise at module level, so every case needs a
// fresh module instance or the first open leaks into the next.
//
// `require` rather than a dynamic `import()`: Jest runs these as CommonJS, and
// `import()` there fails with "A dynamic import callback was invoked without
// --experimental-vm-modules". (Vitest, which is ESM, uses `await import()` for
// the same job — see `net-worth-flows.test.ts`.)
const importStore = () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- see above
  require("@/storage/kv-store") as typeof import("@/storage/kv-store");

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  mockDatabase.rows = new Map();
  mockDatabase.execAsync.mockResolvedValue(undefined);
  mockDatabase.getFirstAsync.mockImplementation(async (_sql, key) => {
    const value = mockDatabase.rows.get(key);
    return value === undefined ? null : { value };
  });
  mockDatabase.runAsync.mockImplementation(async (sql, ...args) => {
    if (sql.startsWith("DELETE")) {
      mockDatabase.rows.delete(args[0]!);
      return;
    }
    mockDatabase.rows.set(args[0]!, args[1]!);
  });
  mockDatabase.withTransactionAsync.mockImplementation(async (work) => work());
  mockOpenDatabaseAsync.mockResolvedValue(mockDatabase);
  // Migration already done unless a case says otherwise.
  mockDatabase.rows.set(MIGRATED_KEY, "1");
  mockGetAllKeys.mockResolvedValue([]);
  mockLegacyStore.clear();
  mockMultiGet.mockImplementation(async (keys) =>
    keys.map((key) => [key, mockLegacyStore.get(key) ?? null]),
  );
});

describe("the key/value API", () => {
  it("round-trips a value", async () => {
    const { getItem, setItem } = importStore();

    await setItem("whole.test", "value");

    expect(await getItem("whole.test")).toBe("value");
  });

  it("reads an absent key as null", async () => {
    const { getItem } = importStore();

    expect(await getItem("whole.missing")).toBeNull();
  });

  it("replaces an existing value rather than duplicating it", async () => {
    const { getItem, setItem } = importStore();

    await setItem("whole.test", "first");
    await setItem("whole.test", "second");

    expect(await getItem("whole.test")).toBe("second");
  });

  it("removes a key", async () => {
    const { getItem, removeItem, setItem } = importStore();

    await setItem("whole.test", "value");
    await removeItem("whole.test");

    expect(await getItem("whole.test")).toBeNull();
  });

  it("creates the table on first use", async () => {
    const { getItem } = importStore();

    await getItem("whole.test");

    expect(mockDatabase.execAsync).toHaveBeenCalledWith(
      expect.stringContaining("CREATE TABLE IF NOT EXISTS kv"),
    );
  });
});

describe("readJson", () => {
  it("parses a stored JSON value", async () => {
    const { readJson, setItem } = importStore();

    await setItem("whole.test", JSON.stringify({ a: 1 }));

    expect(await readJson("whole.test")).toEqual({ a: 1 });
  });

  it("reads an absent key as null", async () => {
    const { readJson } = importStore();

    expect(await readJson("whole.missing")).toBeNull();
  });

  // `JSON.parse` throws a SyntaxError that a zod `safeParse` around it would
  // NOT absorb, so a store that forgets the try turns one corrupt row into a
  // crash on launch.
  it("reads an unparseable value as null instead of throwing", async () => {
    const { readJson, setItem } = importStore();

    await setItem("whole.test", "{not json");

    expect(await readJson("whole.test")).toBeNull();
  });

  // Absorbing a storage failure here would hide a broken database behind
  // "no data"; each caller decides for itself whether that degrades or
  // propagates.
  it("still rejects when storage itself fails", async () => {
    mockDatabase.getFirstAsync.mockRejectedValue(new Error("disk gone"));
    const { readJson } = importStore();

    await expect(readJson("whole.test")).rejects.toThrow("disk gone");
  });
});

describe("the one-time AsyncStorage migration", () => {
  const withPendingMigration = () => {
    mockDatabase.rows.delete(MIGRATED_KEY);
  };

  it("copies legacy whole.* entries into sqlite", async () => {
    withPendingMigration();
    mockGetAllKeys.mockResolvedValue(["whole.accounts", "other.thing"]);
    mockLegacyStore.set("whole.accounts", "[]");
    mockLegacyStore.set("other.thing", "value");
    const { getItem } = importStore();

    expect(await getItem("whole.accounts")).toBe("[]");
  });

  // Namespacing is the filter: another library's AsyncStorage data is not this
  // app's to copy.
  it("ignores keys outside the whole. namespace", async () => {
    withPendingMigration();
    mockGetAllKeys.mockResolvedValue(["other.thing"]);
    mockLegacyStore.set("other.thing", "value");
    const { getItem } = importStore();

    expect(await getItem("other.thing")).toBeNull();
  });

  it("skips a legacy entry with no string value", async () => {
    withPendingMigration();
    mockGetAllKeys.mockResolvedValue(["whole.accounts"]);
    mockLegacyStore.set("whole.accounts", null);
    const { getItem } = importStore();

    expect(await getItem("whole.accounts")).toBeNull();
  });

  // One transaction, so the batch shares a single commit and the marker cannot
  // survive a partial write.
  it("writes the batch and its marker in one transaction", async () => {
    withPendingMigration();
    mockGetAllKeys.mockResolvedValue(["whole.accounts"]);
    mockLegacyStore.set("whole.accounts", "[]");
    const { getItem } = importStore();

    await getItem("whole.accounts");

    expect(mockDatabase.withTransactionAsync).toHaveBeenCalledTimes(1);
    expect(mockDatabase.rows.get(MIGRATED_KEY)).toBe("1");
  });

  // Guarded by the marker, which lives only in sqlite so the check cannot feed
  // back into itself.
  it("does not run again once the marker is set", async () => {
    const { getItem } = importStore();

    await getItem("whole.test");

    expect(mockGetAllKeys).not.toHaveBeenCalled();
  });
});

describe("the cached init", () => {
  // Concurrent first callers share one init — `useAssetAccounts` fires several
  // reads at once on load.
  it("opens the database once for concurrent first callers", async () => {
    const { getItem } = importStore();

    await Promise.all([getItem("a"), getItem("b"), getItem("c")]);

    expect(mockOpenDatabaseAsync).toHaveBeenCalledTimes(1);
  });

  // Without the reset, a transient failure would leave a rejected promise
  // cached forever and every later read would fail until the app was killed.
  it("retries after a failed init instead of failing forever", async () => {
    mockOpenDatabaseAsync.mockRejectedValueOnce(new Error("locked"));
    const { getItem } = importStore();

    await expect(getItem("whole.test")).rejects.toThrow("locked");

    await expect(getItem("whole.test")).resolves.toBeNull();
  });
});

describe("withTransaction", () => {
  // Used by the migrations so a batch of dependent writes commits all or
  // nothing.
  it("runs the work inside a sqlite transaction", async () => {
    const { withTransaction } = importStore();
    const work = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);

    await withTransaction(work);

    expect(mockDatabase.withTransactionAsync).toHaveBeenCalledTimes(1);
    expect(work).toHaveBeenCalledTimes(1);
  });

  it("never overlaps two transactions on the one connection", async () => {
    // `withTransactionAsync` is not exclusive: a second BEGIN inside the first
    // is an error. Two one-time migrations can fire together at startup, so
    // the serialization has to be here rather than left to launch order.
    const { withTransaction } = importStore();
    let inFlight = 0;
    let overlapped = false;
    const work = async () => {
      inFlight += 1;
      overlapped ||= inFlight > 1;
      await Promise.resolve();
      inFlight -= 1;
    };

    await Promise.all([withTransaction(work), withTransaction(work)]);

    expect(overlapped).toBe(false);
    expect(mockDatabase.withTransactionAsync).toHaveBeenCalledTimes(2);
  });

  it("keeps running transactions after one fails", async () => {
    // A rejected transaction must reach its own caller and no further: the
    // queue is shared, and the next migration's write is unrelated to it.
    const { withTransaction } = importStore();
    const failing = withTransaction(async () => {
      throw new Error("db locked");
    });

    await expect(failing).rejects.toThrow("db locked");
    await expect(
      withTransaction(async () => undefined),
    ).resolves.toBeUndefined();
  });
});
