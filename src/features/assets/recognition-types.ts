// The recognition contract shared by the on-device OCR parser and the account
// screens' draft logic. Kept as a pure type module (no React Native / Expo
// imports) so the OCR parser and the Node eval harness can import it without
// pulling in the RN bundler. `AccountBalance` comes from its own pure-zod
// module (`account-balance-schema.ts`) rather than from the storage module
// (`asset-repository.ts`), keeping the recognition side free of the RN
// dependency chain (expo-crypto / AsyncStorage / expo-sqlite) that the storage
// module drags in.
import type { AssetKind } from "./account-appearance";
import type { AccountBalance } from "./account-balance-schema";

// Fields the recognizer may return. All optional so callers can merge only
// what was recognized and leave the rest for the user to fill in. `balances`
// carries one entry per currency shown, so a multi-currency account (e.g. a
// DBS Multiplier holding SGD, HKD and USD) is recognized in a single pass.
export type RecognizedAccount = {
  accountName?: string;
  accountLastFourDigits?: string;
  balances?: AccountBalance[];
  kind?: AssetKind;
};
