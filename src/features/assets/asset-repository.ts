import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  type Currency,
  isKnownAssetCurrency,
} from "@/features/assets/currencies";

const knownAssetKinds = ["cash", "investment", "crypto"] as const;

export type AssetKind = (typeof knownAssetKinds)[number];

export type AssetAccount = {
  id: string;
  name: string;
  accountLastFourDigits: string;
  balance: number;
  currency: Currency;
  kind: AssetKind;
  color: string;
  tint: string;
  initial: string;
};

export type NewAssetAccount = Pick<
  AssetAccount,
  "name" | "accountLastFourDigits" | "balance" | "currency"
>;

type StoredAssetAccounts = {
  version: 1;
  accounts: AssetAccount[];
};

const ASSET_ACCOUNTS_STORAGE_KEY = "whole.assetAccounts";

const initialAssetAccounts: readonly AssetAccount[] = [
  {
    id: "dbs-4821",
    name: "DBS Multiplier",
    accountLastFourDigits: "4821",
    balance: 46_280.12,
    currency: "SGD",
    kind: "cash",
    color: "#C7443E",
    tint: "#FBE9E7",
    initial: "D",
  },
  {
    id: "ibkr-7614",
    name: "Interactive Brokers",
    accountLastFourDigits: "7614",
    balance: 44_760.46,
    currency: "SGD",
    kind: "investment",
    color: "#215AA8",
    tint: "#E7EFFB",
    initial: "IB",
  },
  {
    id: "coinbase-9082",
    name: "Coinbase",
    accountLastFourDigits: "9082",
    balance: 23_189.7,
    currency: "SGD",
    kind: "crypto",
    color: "#5A48A8",
    tint: "#EEEAFB",
    initial: "C",
  },
  {
    id: "wise-3057",
    name: "Wise",
    accountLastFourDigits: "3057",
    balance: 14_200,
    currency: "SGD",
    kind: "cash",
    color: "#12815F",
    tint: "#E2F3ED",
    initial: "W",
  },
];

function isAssetKind(value: unknown): value is AssetKind {
  return knownAssetKinds.some((kind) => kind === value);
}

const LAST_FOUR_DIGITS_PATTERN = /^\d{4}$/;

export function isValidLastFourDigits(value: string): boolean {
  return LAST_FOUR_DIGITS_PATTERN.test(value);
}

function isAssetAccount(value: unknown): value is AssetAccount {
  if (!value || typeof value !== "object") {
    return false;
  }

  const account = value as Record<string, unknown>;

  return (
    typeof account.id === "string" &&
    typeof account.name === "string" &&
    typeof account.accountLastFourDigits === "string" &&
    isValidLastFourDigits(account.accountLastFourDigits) &&
    typeof account.balance === "number" &&
    Number.isFinite(account.balance) &&
    isKnownAssetCurrency(account.currency) &&
    isAssetKind(account.kind) &&
    typeof account.color === "string" &&
    typeof account.tint === "string" &&
    typeof account.initial === "string"
  );
}

function parseStoredAssetAccounts(serializedAccounts: string) {
  const storedAccounts: unknown = JSON.parse(serializedAccounts);

  if (
    !storedAccounts ||
    typeof storedAccounts !== "object" ||
    (storedAccounts as { version?: unknown }).version !== 1
  ) {
    throw new Error("Unsupported local asset data version");
  }

  const accounts = (storedAccounts as { accounts?: unknown }).accounts;

  if (!Array.isArray(accounts) || !accounts.every(isAssetAccount)) {
    throw new Error("Invalid local asset account data");
  }

  return accounts;
}

async function saveAssetAccounts(accounts: readonly AssetAccount[]) {
  const storedAccounts: StoredAssetAccounts = {
    version: 1,
    accounts: [...accounts],
  };

  await AsyncStorage.setItem(
    ASSET_ACCOUNTS_STORAGE_KEY,
    JSON.stringify(storedAccounts),
  );
}

export async function listAssetAccounts() {
  const serializedAccounts = await AsyncStorage.getItem(
    ASSET_ACCOUNTS_STORAGE_KEY,
  );

  if (serializedAccounts) {
    return parseStoredAssetAccounts(serializedAccounts);
  }

  await saveAssetAccounts(initialAssetAccounts);
  return initialAssetAccounts;
}

export async function addAssetAccount(account: NewAssetAccount) {
  const accounts = await listAssetAccounts();
  const newAccount: AssetAccount = {
    ...account,
    id: `${Date.now()}-${account.accountLastFourDigits}`,
    kind: "cash",
    color: "#12815F",
    tint: "#E2F3ED",
    initial: account.name.trim().slice(0, 2).toUpperCase() || "A",
  };

  await saveAssetAccounts([...accounts, newAccount]);

  return newAccount;
}
