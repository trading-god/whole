import { useLocales } from "expo-localization";
import { createInstance } from "i18next";
import {
  createContext,
  type PropsWithChildren,
  useContext,
  useMemo,
} from "react";
import { I18nextProvider, initReactI18next } from "react-i18next";

import { CURRENCY_SYMBOLS, type Currency } from "@/features/assets/currencies";
import { type AppLocale, defaultNamespace, resources } from "@/i18n/resources";

type LocaleContextValue = {
  formatCurrency: (value: number, currency: Currency) => string;
  languageTag: string;
  locale: AppLocale;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

// The symbol map itself lives in `currencies.ts` (next to `knownAssetCurrencies`
// and `currencySchema`), shared with the OCR currency scanner. Here it only
// drives `formatCurrency`; the symbol is prepended and Intl formats just the
// decimal number, which Hermes handles reliably.
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
  const supportedLocale = preferredLocales.find((candidate) =>
    resolveLocale(candidate.languageCode),
  );
  const locale = resolveLocale(supportedLocale?.languageCode ?? null) ?? "en";
  const languageTag = supportedLocale?.languageTag ?? "en-SG";
  const i18n = useMemo(() => createI18n(locale), [locale]);

  const value = useMemo<LocaleContextValue>(
    () => ({
      formatCurrency: formatCurrencyAmount,
      languageTag,
      locale,
    }),
    [languageTag, locale],
  );

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
