import { enMessages } from "@/i18n/locales/en";
import { zhHansMessages } from "@/i18n/locales/zh-Hans";

export const defaultNamespace = "translation";

export const resources = {
  en: {
    [defaultNamespace]: enMessages,
  },
  "zh-Hans": {
    [defaultNamespace]: zhHansMessages,
  },
} as const;

export type AppLocale = keyof typeof resources;

// Maps a device language code onto a locale the app actually ships. Owned here,
// beside `resources`, because two consumers need the same answer and they sit on
// opposite sides of the provider: `I18nProvider` picks the instance's language,
// and `AppErrorBoundary` resolves its copy WITHOUT a provider — the crash
// fallback replaces the tree that `I18nProvider` lives in, so it cannot go
// through i18next at all. Two copies of this rule would let the fallback drift
// into a different language than the app it just replaced.
export function resolveAppLocale(
  languageCode: string | null | undefined,
): AppLocale | null {
  if (languageCode === "zh") {
    return "zh-Hans";
  }

  if (languageCode === "en") {
    return "en";
  }

  return null;
}

// The first device locale the app supports, falling back to English. Mirrors
// what `useLocales()` hands back, so both consumers agree on which of several
// preferred locales wins.
//
// `languageTag` comes back alongside the locale because `I18nProvider` needs the
// full tag for number and currency formatting while `AppErrorBoundary` needs
// only the locale. Returning both from one pass is what keeps the two on the
// same answer — the drift this function exists to prevent.
export function pickAppLocale(
  preferred: readonly { languageCode: string | null; languageTag: string }[],
): { locale: AppLocale; languageTag: string } {
  for (const candidate of preferred) {
    const locale = resolveAppLocale(candidate.languageCode);
    if (locale) {
      return { locale, languageTag: candidate.languageTag };
    }
  }
  return { locale: "en", languageTag: "en-SG" };
}
