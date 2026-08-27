import { render } from "@testing-library/react-native";
import type { ReactElement } from "react";

import { I18nProvider } from "@/i18n";

// Renders inside the app's real i18n provider rather than a stub, so a test
// asserts the copy users actually see and a missing translation key fails here
// instead of shipping as a raw key on screen.
//
// `render` is async in @testing-library/react-native v14, so this is too —
// forgetting the `await` leaves `screen` unpopulated and every query fails with
// "`render` function has not been called", which reads like a setup problem
// rather than a missing keyword.
export function renderWithProviders(ui: ReactElement) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}
