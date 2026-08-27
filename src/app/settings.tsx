// The `/settings` route.
//
// A thin re-export, because everything under `src/app/` is a ROUTE:
// `expo-router`'s context regex matches every `.ts`/`.tsx` file under the app
// root and excludes only `+api`, `+html` and `+middleware`. A `settings.test.tsx`
// sitting beside a screen therefore becomes a route too, gets bundled by Metro,
// and takes `@testing-library/react-native` — and its Node-only `console`
// import — into the app bundle. The app then fails to bundle at all.
//
// Keeping screens in `src/components/` and routes as re-exports means a screen
// can have a test beside it, like every other component.
export { SettingsScreen as default } from "@/components/SettingsScreen";
