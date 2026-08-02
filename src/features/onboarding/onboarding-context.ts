import { createContext, useContext } from "react";

// Lets the onboarding screen signal completion to the root layout. The layout
// owns the `isOnboarded` gate state (it has to — the gate reads it for the
// segments-based redirect), so rather than the screen persisting the flag and
// the layout re-reading storage (which races the gate and can bounce a user
// who just finished back into onboarding), the layout hands down a `complete`
// callback that flips the state synchronously. The screen persists the
// completion marker BEFORE calling `complete` (and surfaces a write failure),
// so a failed write keeps the user on onboarding to retry rather than silently
// re-onboarding next launch. This keeps the context value tiny and avoids
// `onboarding.tsx` importing from `_layout.tsx`.
export type OnboardingContextValue = {
  // The root layout's gate state. It's `null` while the persisted flag loads,
  // but the layout renders nothing (splash covers) during that window, so
  // consumers only ever observe `true` or `false`.
  isOnboarded: boolean;
  /** Flip the gate state to onboarded. The caller persists the marker first. */
  complete: () => void;
};

export const OnboardingContext = createContext<OnboardingContextValue | null>(
  null,
);

function useOnboardingContext(): OnboardingContextValue {
  const context = useContext(OnboardingContext);
  if (!context) {
    throw new Error("must be used inside OnboardingContext");
  }
  return context;
}

export function useCompleteOnboarding(): () => void {
  return useOnboardingContext().complete;
}

// The current gate state, for screens that must avoid rendering their content
// before onboarding completes. The home screen uses this to render a blank
// surface instead of flashing the full UI for the frame between the auth
// gate's `router.replace("/onboarding")` landing and the splash lifting —
// see `src/app/index.tsx`.
export function useOnboardingState(): boolean {
  return useOnboardingContext().isOnboarded;
}
