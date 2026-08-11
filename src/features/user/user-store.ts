import { getItem, setItem } from "@/storage/kv-store";
import { z } from "zod";

// The user's preferred name — captured during onboarding and shown in the
// home greeting forever after. This is permanent user-profile data, not
// onboarding state, so it lives in its own store: onboarding writes it, the home
// screen reads it, and neither owns the other. The value isn't secret, so it
// lives in the plain key-value store — see AGENTS.md on namespacing keys with
// `whole.`.

// 单一的「合法称呼」定义：trim 后非空、上限 USER_NAME_MAX_LENGTH 字符。
// 引导页用 safeParse 校验、输入框 maxLength 引用 USER_NAME_MAX_LENGTH，二者
// 同源避免「什么是一个合法称呼」在两处分别表达而漂移。首页只读取已存储的值
// （保存前已校验），不复用此 schema。
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
