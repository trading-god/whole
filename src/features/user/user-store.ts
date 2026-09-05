import { getItem, setItem } from "@/storage/kv-store";
import { z } from "zod";

// The user's preferred name — captured during onboarding and shown in the
// home greeting forever after. This is permanent user-profile data, not
// onboarding state, so it lives in its own store: onboarding writes it, the home
// screen reads it, and neither owns the other. The value isn't secret, so it
// lives in the plain key-value store — see AGENTS.md on namespacing keys with
// `whole.`.

// The single definition of a valid name: non-empty after trimming, at most
// USER_NAME_MAX_LENGTH characters. Onboarding validates with `safeParse` and
// the input's `maxLength` reads the same constant, so "what counts as a name"
// cannot drift between the two. The home screen only reads what was already
// stored (validated on the way in) and does not re-use this schema.
export const USER_NAME_MAX_LENGTH = 30;
export const userNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(USER_NAME_MAX_LENGTH);

const USER_NAME_KEY = "whole.user.name";

// The name to greet the user with on the home screen. Returns "" when unset so
// the caller can fall back to a generic greeting rather than rendering an empty
// interpolation.
export async function loadUserName(): Promise<string> {
  const value = await getItem(USER_NAME_KEY);
  return value ?? "";
}

// Saves the name as the user moves from step 0 to step 1, so it persists even
// if they then skip the model step. The caller is expected to have already
// validated with `userNameSchema`.
export async function saveUserName(name: string): Promise<void> {
  await setItem(USER_NAME_KEY, name);
}
