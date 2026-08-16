// The recognition contract shared by the on-device OCR parser, the account
// screens' draft logic, and the eval harness's gold fixtures. Kept as a pure
// zod module (no React Native / Expo imports) so the OCR parser and the Node
// eval harness can import it without pulling in the RN bundler. `AccountBalance`
// comes from its own pure-zod module (`./balance`) rather than from the storage
// module (`asset-repository.ts`), keeping the recognition side free of the RN
// dependency chain (expo-crypto / AsyncStorage / expo-sqlite) that the storage
// module drags in.
import { z } from "zod";

import { assetKindSchema, lastFourDigitsSchema } from "./asset-kind";
import { accountBalanceSchema } from "./balance";
import { institutionIdSchema } from "./institution";

// Fields the recognizer may return. All optional so callers can merge only
// what was recognized and leave the rest for the user to fill in. `balances`
// carries one entry per currency shown, so a multi-currency account (e.g. a
// DBS Multiplier holding SGD, HKD and USD) is recognized in a single pass.
// `institutionId` carries the detected institution — a bank, crypto exchange,
// or broker (from `institutions/detect.ts`) — so the add-account wizard can
// auto-group accounts that share one. It is undefined when detection couldn't
// place the institution ("unknown" is still carried explicitly so the wizard can
// distinguish "detected as unknown" from "not yet detected").
//
// Modelled as a schema, not a bare type, because the eval harness validates
// hand-written gold `expected.json` files against exactly this shape. Deriving
// the type with `z.infer` is what keeps the two from drifting: a field added
// here reaches the gold validation automatically, where a parallel hand-written
// schema would silently strip it out of every comparison.
export const recognizedAccountSchema = z.object({
  accountName: z.string().optional(),
  accountLastFourDigits: lastFourDigitsSchema.optional(),
  balances: z.array(accountBalanceSchema).optional(),
  kind: assetKindSchema.optional(),
  institutionId: institutionIdSchema.optional(),
});

export type RecognizedAccount = z.infer<typeof recognizedAccountSchema>;
