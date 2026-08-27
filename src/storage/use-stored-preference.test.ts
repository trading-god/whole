import { describe, expect, it, jest } from "@jest/globals";
import { act, renderHook, waitFor } from "@testing-library/react-native";

import { useStoredPreference } from "@/storage/use-stored-preference";

// A load whose resolution the test controls, so a read can still be in flight
// when the user picks a value — the race the hook's guard exists for.
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useStoredPreference", () => {
  it("renders the fallback until the stored value arrives", async () => {
    const pending = deferred<string>();
    const { result } = await renderHook(() =>
      useStoredPreference(() => pending.promise, "fallback"),
    );

    expect(result.current[0]).toBe("fallback");

    await act(async () => {
      pending.resolve("stored");
    });

    expect(result.current[0]).toBe("stored");
  });

  it("persists through the save callback", async () => {
    const save = jest.fn<(value: string) => Promise<void>>();
    save.mockResolvedValue(undefined);
    const { result } = await renderHook(() =>
      useStoredPreference(async () => "stored", "fallback", save),
    );

    await act(async () => {
      result.current[1]("picked");
    });

    expect(result.current[0]).toBe("picked");
    expect(save).toHaveBeenCalledWith("picked");
  });

  // A cold start opens the database and runs the legacy migration scan before
  // the first read returns — a window wide enough to tap a picker in. Without
  // the guard the screen would disagree with storage until the next launch.
  it("does not let a late read revert a value the user just picked", async () => {
    const pending = deferred<string>();
    const save = jest.fn<(value: string) => Promise<void>>();
    save.mockResolvedValue(undefined);
    const { result } = await renderHook(() =>
      useStoredPreference(() => pending.promise, "fallback", save),
    );

    await act(async () => {
      result.current[1]("picked");
    });
    await act(async () => {
      pending.resolve("stored");
    });

    expect(result.current[0]).toBe("picked");
  });

  // The setter takes a functional update so a caller can flip the value from
  // inside the updater without reading a stale closure — the eye toggle
  // double-taps, and the save has to ride the same updater.
  it("accepts a functional update and saves what it resolved to", async () => {
    const save = jest.fn<(value: boolean) => Promise<void>>();
    save.mockResolvedValue(undefined);
    const { result } = await renderHook(() =>
      useStoredPreference(async () => false, false, save),
    );

    await act(async () => {
      result.current[1]((previous) => !previous);
      result.current[1]((previous) => !previous);
    });

    expect(result.current[0]).toBe(false);
    expect(save).toHaveBeenNthCalledWith(1, true);
    expect(save).toHaveBeenNthCalledWith(2, false);
  });

  // Both failure modes are swallowed deliberately: a preference that cannot be
  // read stays on its fallback, one that cannot be written reverts on the next
  // launch, and neither is worth an alert over a view setting.
  it("stays on the fallback when the read fails", async () => {
    const { result } = await renderHook(() =>
      useStoredPreference(async () => {
        throw new Error("disk gone");
      }, "fallback"),
    );

    await waitFor(() => {
      expect(result.current[0]).toBe("fallback");
    });
  });

  it("keeps the picked value when the write fails", async () => {
    const save = jest.fn<(value: string) => Promise<void>>();
    save.mockRejectedValue(new Error("disk full"));
    const { result } = await renderHook(() =>
      useStoredPreference(async () => "stored", "fallback", save),
    );

    await act(async () => {
      result.current[1]("picked");
    });

    expect(result.current[0]).toBe("picked");
  });

  // `save` is omitted for a preference a screen only reads — the greeting name,
  // written during onboarding.
  it("works with no save callback at all", async () => {
    const { result } = await renderHook(() =>
      useStoredPreference(async () => "stored", "fallback"),
    );

    await act(async () => {
      result.current[1]("picked");
    });

    expect(result.current[0]).toBe("picked");
  });

  // The stale flag is what makes the load safe to drop on unmount.
  it("ignores a read that resolves after unmount", async () => {
    const pending = deferred<string>();
    const { result, unmount } = await renderHook(() =>
      useStoredPreference(() => pending.promise, "fallback"),
    );

    await unmount();
    await act(async () => {
      pending.resolve("stored");
    });

    expect(result.current[0]).toBe("fallback");
  });
});
