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
  /** Flip the gate state to onboarded. The caller persists the marker first. */
  complete: () => void;
};

export const OnboardingContext = createContext<OnboardingContextValue | null>(
  null,
);

export function useCompleteOnboarding(): () => void {
  const context = useContext(OnboardingContext);
  if (!context) {
    throw new Error(
      "useCompleteOnboarding must be used inside OnboardingContext",
    );
  }
  return context.complete;
}
