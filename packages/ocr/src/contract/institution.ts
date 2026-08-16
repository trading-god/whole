// The institution vocabulary the recognizer and the app share.
//
// An institution is any account provider the app recognizes — a bank, a crypto
// exchange, or a broker. The id is contract, not rules: it is a field of
// `RecognizedAccount`, the key of the app's institution display-name catalog,
// and part of the eval harness's gold schema. It lives here rather than in
// `institutions/config.ts` so a consumer that only needs the id doesn't pull in
// every detection regex and keyword table, and so `contract/` stays free of
// dependencies on the layers above it.
//
// `"unknown"` is the fallback when detection can't place a screenshot; it runs
// with `DEFAULT_CONFIG` only (the shared rules every institution inherits), so
// an unrecognized institution degrades to the current global behavior rather
// than failing.
//
// Declaring an id with no detection signals is allowed and is how a new
// institution is staged: the schema accepts the gold that names it,
// `detectInstitution` returns "unknown" until signals exist, and the eval
// records it as an `unsupported-institution` gap rather than crashing on an
// invalid enum value.
import { z } from "zod";

export const institutionIdSchema = z.enum([
  "ocbc",
  "dbs",
  "unknown",
  "alipay",
  "bochk",
  "ccb",
  "cmb",
  "cmbwl",
  "hsbchk",
  "hsbcsg",
  "bitget",
  "okx",
  "ibkr",
  "trust",
]);

export type InstitutionId = z.infer<typeof institutionIdSchema>;
