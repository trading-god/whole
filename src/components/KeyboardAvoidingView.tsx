import {
  type KeyboardAvoidingViewProps,
  KeyboardAvoidingView as RNKeyboardAvoidingView,
  Platform,
} from "react-native";

// Wraps React Native's `KeyboardAvoidingView` with the platform behavior
// centralized: iOS uses "padding" so the keyboard never covers the focused
// input; Android and web leave it undefined (their insets are handled
// differently, and "padding" there double-offsets the content). Shared so the
// `Platform.OS` branch lives in one place instead of being re-inlined on every
// form screen — see AGENTS.md on keeping platform differences out of feature
// code. Callers can still override `behavior` via props when a screen needs a
// different value.
export function KeyboardAvoidingView(props: KeyboardAvoidingViewProps) {
  const { behavior = Platform.OS === "ios" ? "padding" : undefined, ...rest } =
    props;
  return <RNKeyboardAvoidingView behavior={behavior} {...rest} />;
}
