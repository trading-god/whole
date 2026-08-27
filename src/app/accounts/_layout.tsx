import { Stack } from "expo-router";

// The accounts section's own layout: the route options that only concern these
// screens live here rather than piling up in the root layout. Both screens are
// pushed onto the stack with the platform's standard push presentation, with
// the swipe-back gesture enabled.
export default function AccountsLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen
        name="new"
        options={{
          animation: "slide_from_right",
          gestureEnabled: true,
        }}
      />
      <Stack.Screen
        name="[id]"
        options={{
          animation: "slide_from_right",
          gestureEnabled: true,
        }}
      />
    </Stack>
  );
}
