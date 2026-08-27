// The `/` route. A thin re-export: everything under `src/app/` is a ROUTE
// (`expo-router`'s context regex matches every `.ts`/`.tsx` file here and
// excludes only `+api`, `+html` and `+middleware`), so the home screen lives
// in its feature folder where its section components and tests can sit beside
// it without becoming routes.
export { default } from "@/features/home/HomeScreen";
