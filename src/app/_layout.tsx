import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { I18nProvider } from "@/i18n";
import { OnboardingContext } from "@/features/onboarding/onboarding-context";
import { loadOnboardingCompleted } from "@/features/onboarding/onboarding-store";

// Hold the splash screen while the onboarding flag is read, so a first-run
// user never sees a frame of the home screen before the redirect to
// /onboarding. Best-effort: preventAutoHideAsync rejects if the splash already
// auto-hid (e.g. a second call), which we swallow.
SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const router = useRouter();
  const segments = useSegments();
  // null while the persisted flag is loading — the splash covers the gap.
  const [isOnboarded, setIsOnboarded] = useState<boolean | null>(null);

  useEffect(() => {
    void loadOnboardingCompleted()
      .then((completed) => setIsOnboarded(completed))
      .catch(() => {
        // A storage read failure defaults to "not onboarded" so the user can
        // still complete onboarding rather than being stuck on a blank screen.
        setIsOnboarded(false);
      });
  }, []);

  // First-launch gate (expo-router auth-gate pattern): send un-onboarded users
  // to /onboarding, and bounce already-onboarded users out of it if they land
  // there (e.g. via back navigation). `complete` flips this state synchronously,
  // so finishing onboarding never races the gate back into the flow.
  //
  // Once the committed route matches the gate's desired state, lift the splash
  // one paint cycle later — gating on `segments` (not just `isOnboarded`)
  // ensures first-run users never see a frame of the home screen before the
  // /onboarding redirect lands. The splash hides exactly once (splashHiddenRef);
  // later navigations re-run the gate but skip the now-no-op hide.
  const splashHiddenRef = useRef(false);
  useEffect(() => {
    if (isOnboarded === null) {
      return;
    }
    const inOnboarding = segments[0] === "onboarding";
    if (!isOnboarded && !inOnboarding) {
      router.replace("/onboarding");
      return;
    }
    if (isOnboarded && inOnboarding) {
      router.replace("/");
      return;
    }
    if (splashHiddenRef.current) {
      return;
    }
    const rafId = requestAnimationFrame(() => {
      splashHiddenRef.current = true;
      SplashScreen.hideAsync().catch(() => {});
    });
    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [isOnboarded, segments, router]);

  // Flips the gate state to onboarded synchronously. The onboarding screen
  // persists the completion marker BEFORE calling this (so a failed write is
  // surfaced and retried rather than silently leaving the flag unset).
  const complete = useCallback(() => {
    setIsOnboarded(true);
  }, []);

  // Stable context value so the provider doesn't hand consumers a new object
  // on every layout render (useSegments re-runs on every navigation). The
  // `isOnboarded === true` mapping keeps the value a plain boolean — the null
  // loading state is covered by the splash gate above (children never mount
  // while it's still null), so consumers only observe true/false.
  const onboardingValue = useMemo(
    () => ({ isOnboarded: isOnboarded === true, complete }),
    [complete, isOnboarded],
  );

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <I18nProvider>
        <OnboardingContext.Provider value={onboardingValue}>
          {isOnboarded === null ? null : (
            <>
              <StatusBar style="dark" />
              <Stack screenOptions={{ headerShown: false }}>
                <Stack.Screen
                  name="onboarding"
                  options={{ animation: "none" }}
                />
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
            </>
          )}
        </OnboardingContext.Provider>
      </I18nProvider>
    </GestureHandlerRootView>
  );
}
