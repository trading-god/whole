export const knownAssetCurrencies = ["SGD", "USD", "HKD", "CNY"] as const;

export type Currency = (typeof knownAssetCurrencies)[number];

export const supportedAssetCurrencies = [
  "SGD",
] as const satisfies readonly Currency[];
export const defaultAssetCurrency = supportedAssetCurrencies[0];

export function isKnownAssetCurrency(value: unknown): value is Currency {
  return knownAssetCurrencies.some((currency) => currency === value);
}
