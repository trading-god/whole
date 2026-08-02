import { getItem, setItem } from "@/storage/kv-store";

// First-run onboarding persistence: a one-shot completion flag. The user's
// preferred name is permanent profile data and lives in `user-store` —
// onboarding is just one of its writers. Neither value is secret, so both live
// in the plain key-value store rather than SecureStore — see AGENTS.md on
// namespacing keys with `whole.`.

const ONBOARDING_COMPLETED_KEY = "whole.onboarding.completed";

// Whether the user has finished onboarding. Gates the first-launch redirect in
// the root layout — returns false until `markOnboardingCompleted` writes the
// marker, so a fresh install routes to /onboarding instead of /.
export async function loadOnboardingCompleted(): Promise<boolean> {
  const value = await getItem(ONBOARDING_COMPLETED_KEY);
  return value === "1";
}

// Persists the completion marker. Called once, at the end of the flow (Finish
// or Skip) — not per step — so a user who backgrounds the app mid-onboarding
// sees it again on next launch.
export async function markOnboardingCompleted(): Promise<void> {
  await setItem(ONBOARDING_COMPLETED_KEY, "1");
}
