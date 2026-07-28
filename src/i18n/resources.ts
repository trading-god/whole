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
