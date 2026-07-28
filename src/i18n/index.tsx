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

import { type AppLocale, defaultNamespace, resources } from "@/i18n/resources";

type LocaleContextValue = {
  formatCurrency: (value: number, currency: string) => string;
  locale: AppLocale;
  languageTag: string;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);
const subscribeToHydration = () => () => {};

const numberFormatCache = new Map<string, Intl.NumberFormat>();

function formatCurrencyAmount(
  languageTag: string,
  amount: number,
  currency: string,
): string {
  const cacheKey = `${languageTag}:${currency}`;
  let formatter = numberFormatCache.get(cacheKey);
  if (!formatter) {
    formatter = new Intl.NumberFormat(languageTag, {
      currency,
      minimumFractionDigits: 2,
      style: "currency",
    });
    numberFormatCache.set(cacheKey, formatter);
  }
  return formatter.format(amount);
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
      locale,
      languageTag,
      formatCurrency: (amount, currency) =>
        formatCurrencyAmount(languageTag, amount, currency),
    }),
    [languageTag, locale],
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
