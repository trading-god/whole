// The persisted per-currency balance shape for a stored account. Kept as a
// pure zod module (no React Native / Expo imports) so the on-device OCR
// recognition contract (`recognition-types.ts`) and the Node eval harness can
// import it without pulling in the RN bundler.
//
// `currency` uses `currencySchema` (the explicit supported-currency list), and
// `balance` is a plain number — this is the smallest unit the recognizer and
// the storage layer must agree on. `asset-repository` re-exports this so the
// runtime storage module and the pure recognition contract share one source of
// truth without the recognition side depending on the storage module.
import { z } from "zod";

import { currencySchema } from "./currencies";

export const accountBalanceSchema = z.object({
  currency: currencySchema,
  balance: z.number(),
});

export type AccountBalance = z.infer<typeof accountBalanceSchema>;
