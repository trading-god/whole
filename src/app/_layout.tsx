import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { queryClient, queryPersistOptions } from "@/lib/query-client";
import { reattachModelDownloads } from "@/features/on-device-model/model-download";
import { I18nProvider } from "@/i18n";
import { BrandSplash } from "@/components/BrandSplash";
import { OnboardingContext } from "@/features/onboarding/onboarding-context";
import { loadOnboardingCompleted } from "@/features/onboarding/onboarding-store";
import { removeLegacyModelKeys } from "@/storage/legacy-model-keys";
import { screenStyles } from "@/theme/screen-styles";

// Hold the splash screen while the onboarding flag is read, so a first-run
// user never sees a frame of the home screen before the redirect to
// /onboarding. Best-effort: preventAutoHideAsync rejects if the splash already
// auto-hid (e.g. a second call), which we swallow.
SplashScreen.preventAutoHideAsync().catch(() => {});
// The JS overlay owns the launch motion. Android otherwise adds a built-in
// 400ms native fade after `hideAsync()`, consuming the overlay's reveal and
// most of its hold while still covering it. iOS is kept identical for parity.
SplashScreen.setOptions({ fade: false });

// expo-router reads a route module's named `ErrorBoundary` export and wraps that
// route — here the root layout, so every screen — in `<Try catch={...}>`. This
// is the app's only render-error backstop: without it an exception reaches
// React's root handler and `ExceptionsManager` treats it as fatal, which in a
// release build is a crash or a white screen. The catch path is not `__DEV__`
// gated, so this works in production, which is the point.
export { AppErrorBoundary as ErrorBoundary } from "@/components/AppErrorBoundary";

export default function RootLayout() {
  const router = useRouter();
  const segments = useSegments();
  // null while the persisted flag is loading — the splash covers the gap.
  const [isOnboarded, setIsOnboarded] = useState<boolean | null>(null);
  // `waiting` covers the native splash; `revealed` runs the JS takeover; `done`
  // removes the one-shot component and everything it retains for the session.
  const [brandSplashPhase, setBrandSplashPhase] = useState<
    "waiting" | "revealed" | "done"
  >("waiting");

  useEffect(() => {
    void loadOnboardingCompleted()
      .then((completed) => setIsOnboarded(completed))
      .catch(() => {
        // A storage read failure defaults to "not onboarded" so the user can
        // still complete onboarding rather than being stuck on a blank screen.
        setIsOnboarded(false);
      });
    // Best-effort sweep of the storage the bring-your-own-endpoint era left
    // behind (see `removeLegacyModelKeys`). Fire-and-forget: a failure means
    // the orphaned rows survive one more launch.
    void removeLegacyModelKeys().catch(() => {});
    // Re-attach to model downloads the OS kept running across a backgrounding
    // or a relaunch, so their progress and completion still land in the
    // download store. Fire-and-forget for the same reason.
    void reattachModelDownloads().catch(() => {});
  }, []);

  // First-launch gate (expo-router auth-gate pattern): send un-onboarded users
  // to /onboarding, and bounce already-onboarded users out of it if they land
  // there (e.g. via back navigation). `complete` flips this state synchronously,
  // so finishing onboarding never races the gate back into the flow.
  //
  // Once the committed route matches the gate's desired state, lift the splash
  // one paint cycle later — gating on `segments` (not just `isOnboarded`)
  // ensures first-run users never see a frame of the home screen before the
  // /onboarding redirect lands. The one-way splash phase makes the hide
  // transition exactly once; later navigations skip it.
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
    if (brandSplashPhase !== "waiting") {
      return;
    }
    const rafId = requestAnimationFrame(() => {
      SplashScreen.hide();
      setBrandSplashPhase("revealed");
    });
    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [brandSplashPhase, isOnboarded, segments, router]);

  // Flips the gate state to onboarded synchronously. The onboarding screen
  // persists the completion marker BEFORE calling this (so a failed write is
  // surfaced and retried rather than silently leaving the flag unset).
  const complete = useCallback(() => {
    setIsOnboarded(true);
  }, []);

  const finishBrandSplash = useCallback(() => {
    setBrandSplashPhase("done");
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
    <GestureHandlerRootView style={screenStyles.flex}>
      {/* Restores the query cache from sqlite before the tree renders, so a
          cold start shows the last known exchange rates instead of "—" while
          the network answers. Children are not blocked on the restore: the
          screens read rates imperatively and degrade on their own. */}
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={queryPersistOptions}
      >
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
                    name="settings"
                    options={{
                      animation: "slide_from_right",
                      gestureEnabled: true,
                    }}
                  />
                </Stack>
              </>
            )}
            {/* Rendered after the router so it stacks above it. Mounts on the
                first frame, covers the pre-reveal gap plus its hold-and-fade,
                then leaves the tree permanently. */}
            {brandSplashPhase !== "done" ? (
              <BrandSplash
                revealed={brandSplashPhase === "revealed"}
                onFinished={finishBrandSplash}
              />
            ) : null}
          </OnboardingContext.Provider>
        </I18nProvider>
      </PersistQueryClientProvider>
    </GestureHandlerRootView>
  );
}
