import { useTranslation } from "react-i18next";

import {
  type OptionPickerVariant,
  OptionPicker,
} from "@/components/OptionPicker";
import { type Currency } from "@/features/assets/currencies";

type CurrencyPickerProps = {
  value: Currency;
  // Option list, ordered by the caller (locale-default first, then alpha).
  currencies: readonly Currency[];
  onChange: (currency: Currency) => void;
  // Trigger surface. `onDark` (default) is the inline switcher on the home
  // balance card's dark eyebrow; `onLight` is the compact unit-suffix capsule
  // used inside a form input's trailing slot.
  variant?: OptionPickerVariant;
  // Dialog title and trigger announcement label. Defaults to the home
  // "display currency" string; form contexts pass a plain "currency" label.
  dialogTitle?: string;
};

// Currency switcher. A currency's label is its own ISO code, so this is a thin
// naming layer over `OptionPicker` — it owns the default dialog title and
// nothing else, leaving the trigger surfaces and option sheet shared with every
// other single-select control.
export function CurrencyPicker({
  value,
  currencies,
  onChange,
  variant = "onDark",
  dialogTitle,
}: CurrencyPickerProps) {
  const { t } = useTranslation();

  return (
    <OptionPicker
      dialogTitle={dialogTitle ?? t("home.displayCurrency")}
      onChange={onChange}
      options={currencies.map((currency) => ({
        value: currency,
        label: currency,
      }))}
      value={value}
      variant={variant}
    />
  );
}
