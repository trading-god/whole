import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

import { I18nProvider } from "@/i18n";

export default function RootLayout() {
  return (
    <I18nProvider>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen
          name="accounts/new"
          options={{
            animation: "slide_from_right",
            gestureEnabled: true,
          }}
        />
      </Stack>
    </I18nProvider>
  );
}
