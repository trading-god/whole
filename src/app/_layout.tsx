import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { I18nProvider } from "@/i18n";

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
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
          <Stack.Screen
            name="accounts/[id]"
            options={{
              animation: "slide_from_right",
              gestureEnabled: true,
            }}
          />
        </Stack>
      </I18nProvider>
    </GestureHandlerRootView>
  );
}
