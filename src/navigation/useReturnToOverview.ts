import { useRouter } from "expo-router";
import { useCallback } from "react";

// Returns to the previous screen when there is one, otherwise replaces the
// stack with home — the shared "back to asset overview" behavior used by the
// secondary screens' back button and their post-save/post-cleanup flows, so
// the navigation fallback rule lives in one place instead of per screen.
export function useReturnToOverview() {
  const router = useRouter();
  return useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace("/");
  }, [router]);
}
