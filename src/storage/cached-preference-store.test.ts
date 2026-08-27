import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { getItem, setItem } from "@/storage/kv-store";
import { createCachedPreferenceStore } from "@/storage/cached-preference-store";

// One mocked module seam — `kv-store` — which is the limit of the Vitest
// exception in AGENTS.md. Everything under test here is cache and validation
// logic; sqlite's behaviour is not what these cases are about.
vi.mock("@/storage/kv-store", () => ({
  getItem: vi.fn(),
  setItem: vi.fn(),
}));

const getItemMock = vi.mocked(getItem);
const setItemMock = vi.mocked(setItem);

// Lets every pending microtask run, so a test can be sure the code under test
// has reached its own `await` before the test acts on it.
const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

const schema = z.enum(["a", "b"]);
const KEY = "whole.test.preference";

beforeEach(() => {
  vi.resetAllMocks();
  setItemMock.mockResolvedValue(undefined);
});

describe("createCachedPreferenceStore", () => {
  it("returns the stored value when it validates", async () => {
    getItemMock.mockResolvedValue("b");
    const store = createCachedPreferenceStore(KEY, schema);

    expect(await store.load("a")).toBe("b");
    expect(getItemMock).toHaveBeenCalledWith(KEY);
  });

  it("falls back when nothing is stored", async () => {
    getItemMock.mockResolvedValue(null);
    const store = createCachedPreferenceStore(KEY, schema);

    expect(await store.load("a")).toBe("a");
  });

  it("falls back when the stored value no longer validates", async () => {
    getItemMock.mockResolvedValue("legacy-value");
    const store = createCachedPreferenceStore(KEY, schema);

    expect(await store.load("a")).toBe("a");
  });

  it("serves later loads from cache without reading storage again", async () => {
    getItemMock.mockResolvedValue("b");
    const store = createCachedPreferenceStore(KEY, schema);

    expect(await store.load("a")).toBe("b");
    expect(await store.load("a")).toBe("b");

    expect(getItemMock).toHaveBeenCalledTimes(1);
  });

  // Without `persistFallback` the fallback is deliberately NOT cached: it may
  // be derived from something that changes (the device locale), so it has to be
  // re-derived on every load.
  it("re-reads storage after an uncached fallback", async () => {
    getItemMock.mockResolvedValue(null);
    const store = createCachedPreferenceStore(KEY, schema);

    expect(await store.load("a")).toBe("a");
    expect(await store.load("a")).toBe("a");

    expect(getItemMock).toHaveBeenCalledTimes(2);
    expect(setItemMock).not.toHaveBeenCalled();
  });

  describe("save", () => {
    it("writes through and updates the cache", async () => {
      getItemMock.mockResolvedValue(null);
      const store = createCachedPreferenceStore(KEY, schema);

      await store.save("b");

      expect(setItemMock).toHaveBeenCalledWith(KEY, "b");
      expect(await store.load("a")).toBe("b");
      expect(getItemMock).not.toHaveBeenCalled();
    });

    // The invariant: memory matches storage. Caching before the write succeeds
    // would leave the cache holding a value that was never persisted.
    it("leaves the cache untouched when the write fails", async () => {
      setItemMock.mockRejectedValue(new Error("disk full"));
      getItemMock.mockResolvedValue("a");
      const store = createCachedPreferenceStore(KEY, schema);

      await expect(store.save("b")).rejects.toThrow("disk full");

      expect(await store.load("a")).toBe("a");
    });
  });

  describe("persistFallback", () => {
    it("pins the fallback on first use", async () => {
      getItemMock.mockResolvedValue(null);
      const store = createCachedPreferenceStore(KEY, schema, {
        persistFallback: true,
      });

      expect(await store.load("a")).toBe("a");

      expect(setItemMock).toHaveBeenCalledWith(KEY, "a");
      // Pinned, so it is safe to cache — the second load must not re-read.
      expect(await store.load("b")).toBe("a");
      expect(getItemMock).toHaveBeenCalledTimes(1);
    });

    // The failure this guards is the nastiest one in the module: caching an
    // unpersisted fallback would let a later launch under a different locale
    // derive a different base currency, while the snapshot migration marker
    // still names the old one — every stored snapshot then converts by the
    // wrong factor.
    it("does not cache the fallback when persisting it fails", async () => {
      getItemMock.mockResolvedValue(null);
      setItemMock.mockRejectedValue(new Error("disk full"));
      const store = createCachedPreferenceStore(KEY, schema, {
        persistFallback: true,
      });

      await expect(store.load("a")).rejects.toThrow("disk full");

      // Storage recovers; the next load must re-read rather than serve a
      // fallback it never managed to pin.
      setItemMock.mockResolvedValue(undefined);
      getItemMock.mockResolvedValue("b");
      expect(await store.load("a")).toBe("b");
    });

    it("keeps a value saved while the fallback write was in flight", async () => {
      getItemMock.mockResolvedValue(null);
      const store = createCachedPreferenceStore(KEY, schema, {
        persistFallback: true,
      });
      let releaseWrite!: () => void;
      // Keyed on the VALUE, not on call order: the save below also writes, and
      // a `mockImplementationOnce` would be consumed by whichever call happened
      // to land first — which is the save, hanging the wrong write.
      setItemMock.mockImplementation((_key, value) =>
        value === "a"
          ? new Promise<void>((resolve) => {
              releaseWrite = resolve;
            })
          : Promise.resolve(),
      );

      const loading = store.load("a");
      await flushMicrotasks();

      // A save lands mid-write — the user tapped a picker during a cold start.
      await store.save("b");
      releaseWrite();

      await loading;

      // The in-flight fallback must not roll the cache back over the choice.
      expect(await store.load("a")).toBe("b");
    });
  });

  // The stale-read guard: a save that lands while `getItem` is in flight wins,
  // because the read describes a world that no longer exists by the time it
  // resolves.
  it("keeps a value saved while the read was in flight", async () => {
    let releaseRead!: (value: string | null) => void;
    getItemMock.mockImplementation(
      () =>
        new Promise<string | null>((resolve) => {
          releaseRead = resolve;
        }),
    );
    const store = createCachedPreferenceStore(KEY, schema);

    const loading = store.load("a");
    await store.save("b");
    releaseRead("a");

    expect(await loading).toBe("b");
  });
});
