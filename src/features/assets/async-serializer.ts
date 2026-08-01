// Serializes async operations on a shared chain so concurrent callers each see
// the previous run's result instead of racing on the same state (e.g. a
// double-tapped save reading the same account list and clobbering each other's
// merge). A run that rejects never breaks the chain — its failure is swallowed
// at the chain level so later runs still execute; the rejecting run's own
// returned promise still rejects to its caller.
//
// Shared by the three serialized writers in this feature (asset upsert,
// snapshot record, account remove) so the serialize-on-a-promise-chain idiom
// has one owner instead of being mirrored across modules.
export function createAsyncSerializer() {
  let chain: Promise<unknown> = Promise.resolve();

  return function serialize<T>(run: () => Promise<T>): Promise<T> {
    const result = chain.then(run, run);
    chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result as Promise<T>;
  };
}
