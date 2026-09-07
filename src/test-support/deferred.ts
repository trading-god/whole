// A manually-resolved promise: the test presses a button, holds the async
// action mid-flight with `mock.mockReturnValue(deferred().promise)`, asserts
// the busy/guarded state, then resolves to finish the flow. Shared by every
// screen test that has to inspect a button while its handler is in flight.
export function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
