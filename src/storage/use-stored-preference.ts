import { useCallback, useEffect, useRef, useState } from "react";

// One persisted view preference: rendered from `fallback` until the stored
// value loads, then written back through `save` whenever it changes. The stale
// guard is what makes the load safe to drop on unmount, and both failure modes
// are swallowed deliberately — a preference that can't be read stays on its
// fallback, one that can't be written reverts on the next launch, and neither
// is worth an alert over a view setting. Stated once so the fourth preference
// can't quietly ship without the guard. `save` is omitted for a preference
// a screen only reads (the greeting name, written during onboarding).
//
// Lives beside `cached-preference-store` rather than in the screen that first
// needed it: the guards below are the whole point of the hook, and a second
// screen reaching for it should import it rather than find it inside a route
// file and copy the parts it can see.
export function useStoredPreference<T>(
  load: () => Promise<T>,
  fallback: T,
  save?: (value: T) => Promise<void>,
): [T, (value: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState(fallback);
  // Set the moment the user picks a value, so a read that resolves late can't
  // revert what they just chose — and already persisted. A cold start opens the
  // database and runs the legacy AsyncStorage migration scan before the first
  // read returns, which is a wide enough window to tap a picker in; without
  // this the screen would disagree with storage until the next launch.
  const hasUserChoice = useRef(false);

  useEffect(() => {
    let stale = false;
    void load()
      .then((stored) => {
        if (!stale && !hasUserChoice.current) {
          setValue(stored);
        }
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [load]);

  // Accepts a functional update so a caller can flip the value from inside the
  // updater without reading a stale closure (the eye toggle double-taps). The
  // setter resolves `next` against the current value and persists the result —
  // the save rides the same updater so a double-tap writes the value the UI
  // actually switched to.
  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      hasUserChoice.current = true;
      setValue((current) => {
        const resolved =
          typeof next === "function" ? (next as (prev: T) => T)(current) : next;
        void save?.(resolved).catch(() => {});
        return resolved;
      });
    },
    [save],
  );

  return [value, set];
}
