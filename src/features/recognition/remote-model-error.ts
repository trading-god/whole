// The remote model's failure type, in a module with no native imports.
//
// Pure TypeScript on purpose, mirroring `model-error.ts` on the on-device
// side: `remote-runner.ts` pulls in the config store (SecureStore), so a test
// that wants to throw or catch `RemoteModelError` against the REAL class (an
// `instanceof` discriminator, where a hand-copied look-alike would silently
// read as "unknown") imports it from here instead.

/**
 * A failure of the remote endpoint: the request could not be made, or the
 * endpoint answered with anything other than a usable completion.
 *
 * The class is the discriminator; the HTTP status or network reason rides in
 * the message for the failure-cause mapping, which turns it into the advice
 * that actually applies (check the key / check the URL / wait out the rate
 * limit) instead of the on-device advice ("restart the app") that would fit
 * none of them.
 */
export class RemoteModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RemoteModelError";
  }
}
