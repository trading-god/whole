import { useLocales } from "expo-localization";
import { createInstance } from "i18next";
import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { Platform } from "react-native";

import { type Currency } from "@/features/assets/currencies";
import { type AppLocale, defaultNamespace, resources } from "@/i18n/resources";

type LocaleContextValue = {
  formatCurrency: (value: number, currency: Currency) => string;
  // True once the device locale has been resolved. On native this is always
  // true; on web it is false during SSR/first render and flips after
  // hydration. Consumers that seed persisted state from the locale (e.g. the
  // base currency) must wait for this before reading the languageTag, or the
  // pre-hydration fallback would get pinned.
  isHydrated: boolean;
  languageTag: string;
  locale: AppLocale;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);
const subscribeToHydration = () => () => {};

// Standard international (ISO 4217) currency symbols, applied explicitly.
// Intl's currency-symbol resolution can fall back to the ISO code on Hermes
// (e.g. "SGD" instead of "S$" when the currency isn't the locale's own), so
// the symbol is prepended here and Intl only formats the decimal number —
// which Hermes handles reliably. CN¥ disambiguates CNY from JPY (also ¥).
const CURRENCY_SYMBOLS: Record<Currency, string> = {
  SGD: "S$",
  USD: "$",
  HKD: "HK$",
  CNY: "CN¥",
};

let decimalFormatter: Intl.NumberFormat | null = null;

function formatCurrencyAmount(amount: number, currency: Currency): string {
  if (!decimalFormatter) {
    decimalFormatter = new Intl.NumberFormat("en-US", {
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
    });
  }
  return `${CURRENCY_SYMBOLS[currency]}${decimalFormatter.format(amount)}`;
}

function resolveLocale(languageCode: string | null): AppLocale | null {
  if (languageCode === "zh") {
    return "zh-Hans";
  }

  if (languageCode === "en") {
    return "en";
  }

  return null;
}

function createI18n(locale: AppLocale) {
  const instance = createInstance();

  void instance.use(initReactI18next).init({
    defaultNS: defaultNamespace,
    fallbackLng: "en",
    initAsync: false,
    interpolation: {
      // React and React Native escape rendered values themselves.
      escapeValue: false,
    },
    lng: locale,
    react: {
      useSuspense: false,
    },
    resources,
    supportedLngs: Object.keys(resources),
  });

  return instance;
}

export function I18nProvider({ children }: PropsWithChildren) {
  const preferredLocales = useLocales();
  const webHasHydrated = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => Platform.OS !== "web",
  );
  const supportedLocale = webHasHydrated
    ? preferredLocales.find((candidate) =>
        resolveLocale(candidate.languageCode),
      )
    : undefined;
  const locale = resolveLocale(supportedLocale?.languageCode ?? null) ?? "en";
  const languageTag = supportedLocale?.languageTag ?? "en-SG";
  const i18n = useMemo(() => createI18n(locale), [locale]);

  const value = useMemo<LocaleContextValue>(
    () => ({
      formatCurrency: formatCurrencyAmount,
      isHydrated: webHasHydrated,
      languageTag,
      locale,
    }),
    [languageTag, locale, webHasHydrated],
  );

  useEffect(() => {
    if (Platform.OS === "web") {
      document.documentElement.lang = locale;
    }
  }, [locale]);

  return (
    <I18nextProvider i18n={i18n}>
      <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
    </I18nextProvider>
  );
}

export function useAppLocale() {
  const context = useContext(LocaleContext);

  if (!context) {
    throw new Error("useAppLocale must be used inside I18nProvider");
  }

  return context;
}
