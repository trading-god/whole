// The on-device model's failure type, in a module with no native imports.
//
// Pure TypeScript on purpose: `model-context.ts` pulls in llama.rn, so a test
// that wants to throw or catch `OnDeviceModelError` against the REAL class
// (an `instanceof` discriminator, where a hand-copied look-alike would silently
// read as "unknown") imports it from here instead of mocking the module that
// owns the context.

/**
 * A failure of the weights on this device: they would not load into a context,
 * or a loaded context could not finish a completion.
 *
 * One class, not a taxonomy, because every caller asks the same question and
 * gives the same advice — free up memory and try again. Which of the two it was
 * lives in the message, where a developer reading a log can see it; nothing
 * branches on it, and a discriminator nothing reads is a branch nothing covers.
 */
export class OnDeviceModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OnDeviceModelError";
  }
}

/** The message off a caught `unknown`, shared by every on-device caller. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
