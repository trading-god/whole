import { describe, expect, it } from "vitest";

import { createAsyncSerializer } from "@/features/assets/async-serializer";

// A deferred promise, so a test can hold one run open and prove the next one
// has not started.
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// Lets every pending microtask run. `serialize` schedules its work with
// `chain.then(run)`, so nothing has executed by the time the call returns —
// asserting synchronously would only prove that promises are asynchronous.
const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createAsyncSerializer", () => {
  it("runs operations one at a time, in call order", async () => {
    const serialize = createAsyncSerializer();
    const order: string[] = [];
    const first = deferred<void>();

    const a = serialize(async () => {
      order.push("a:start");
      await first.promise;
      order.push("a:end");
      return "a";
    });
    const b = serialize(async () => {
      order.push("b:start");
      return "b";
    });

    await flushMicrotasks();

    // `b` must not have started while `a` is still in flight — that is the
    // whole point of the chain.
    expect(order).toEqual(["a:start"]);

    first.resolve();

    expect(await a).toBe("a");
    expect(await b).toBe("b");
    expect(order).toEqual(["a:start", "a:end", "b:start"]);
  });

  it("returns each run's own resolved value", async () => {
    const serialize = createAsyncSerializer();

    expect(await serialize(async () => 1)).toBe(1);
    expect(await serialize(async () => 2)).toBe(2);
  });

  // The chain swallows failures at the chain level but not at the caller level:
  // a rejecting run still rejects to whoever called it.
  it("rejects to the caller when a run fails", async () => {
    const serialize = createAsyncSerializer();
    const boom = new Error("boom");

    await expect(
      serialize(async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
  });

  // The regression this guards: if the failure propagated into `chain`, every
  // later write would be dropped and the app would silently stop persisting.
  it("keeps running later operations after one fails", async () => {
    const serialize = createAsyncSerializer();

    await expect(
      serialize(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(await serialize(async () => "still works")).toBe("still works");
  });

  it("still serializes the run that follows a failure", async () => {
    const serialize = createAsyncSerializer();
    const order: string[] = [];
    const failing = deferred<void>();

    const first = serialize(async () => {
      order.push("first:start");
      await failing.promise;
      throw new Error("boom");
    });
    const second = serialize(async () => {
      order.push("second:start");
    });

    await flushMicrotasks();

    expect(order).toEqual(["first:start"]);

    failing.resolve();

    await expect(first).rejects.toThrow("boom");
    await second;
    expect(order).toEqual(["first:start", "second:start"]);
  });
});
