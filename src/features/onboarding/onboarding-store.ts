import { getItem, setItem } from "@/storage/kv-store";
import { z } from "zod";

// First-run onboarding persistence: a one-shot completion flag and the user's
// preferred name (captured on the first step, shown in the home greeting).
// Neither value is secret, so both live in the plain key-value store rather
// than SecureStore — see AGENTS.md on namespacing keys with `whole.`.

// 单一的「合法称呼」定义：trim 后非空、上限 30 字符。引导页表单校验与首页
// 读取共用此 schema，避免「什么是一个合法称呼」在两处分别表达而漂移。
export const userNameSchema = z.string().trim().min(1).max(30);

const ONBOARDING_COMPLETED_KEY = "whole.onboarding.completed";
const USER_NAME_KEY = "whole.user.name";

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
