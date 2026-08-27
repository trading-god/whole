// The `/onboarding` route. A thin re-export: everything under `src/app/` is a
// ROUTE (`expo-router`'s context regex matches every `.ts`/`.tsx` file here and
// excludes only `+api`, `+html` and `+middleware`), so the onboarding screen
// lives in its feature folder beside the context and store it is the UI for.
export { default } from "@/features/onboarding/OnboardingScreen";
