// @ts-check
// Allows cleartext HTTP to LOCAL services only — the Android counterpart of
// the `NSAllowsLocalNetworking` entry in app.json's iOS block.
//
// The remote recognition engine accepts `http://` base URLs for services on
// the user's own machine (Ollama, LM Studio). Android blocks ALL cleartext
// in release builds by default (targetSdk >= 28), which would make every
// such endpoint fail with "Cleartext HTTP traffic not permitted" — the
// schema cannot tell local from public, so the platform has to be the gate,
// the same role ATS plays on iOS.
//
// A network security config keeps that gate: cleartext stays banned by
// default (a public endpoint still has to answer https), with an allowance
// only for loopback hosts — localhost, 127.0.0.1, and 10.0.2.2 (the
// emulator's alias for the host machine's loopback). Android's config has
// no way to express "the whole local network" the way iOS's
// NSAllowsLocalNetworking does, so a LAN-IP endpoint remains https-only on
// Android.
//
// The debug variant is fully permissive: dev builds load the Metro bundle
// over cleartext from the dev machine's LAN address, and this config (once
// present on the application tag) takes precedence over the
// `usesCleartextTraffic` flag the debug template sets.
const {
  AndroidConfig,
  withAndroidManifest,
  withDangerousMod,
} = require("expo/config-plugins");
const fs = require("node:fs");
const path = require("node:path");

const RELEASE_NETWORK_SECURITY_CONFIG = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <!-- Public endpoints must answer https; only the loopback family may
         speak cleartext, for local services the user configured. -->
    <base-config cleartextTrafficPermitted="false" />
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="false">localhost</domain>
        <domain includeSubdomains="false">127.0.0.1</domain>
        <domain includeSubdomains="false">10.0.2.2</domain>
    </domain-config>
</network-security-config>
`;

const DEBUG_NETWORK_SECURITY_CONFIG = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <!-- Debug builds load the Metro bundle over cleartext from the dev
         machine's LAN address; keep dev networking fully open. -->
    <base-config cleartextTrafficPermitted="true" />
</network-security-config>
`;

/** @type {import('expo/config-plugins').ConfigPlugin<void>} */
const withAndroidLocalCleartext = (config) => {
  const withManifest = withAndroidManifest(config, (config) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(
      config.modResults,
    );
    application.$["android:networkSecurityConfig"] =
      "@xml/network_security_config";
    return config;
  });
  return withDangerousMod(withManifest, [
    "android",
    (config) => {
      const projectRoot = config.modRequest.platformProjectRoot;
      const variants = /** @type {const} */ ([
        // Release (and any variant without its own copy) gets the scoped
        // config; the debug build types get the permissive one — they load
        // the Metro bundle over cleartext from the dev machine.
        ["main", RELEASE_NETWORK_SECURITY_CONFIG],
        ["debug", DEBUG_NETWORK_SECURITY_CONFIG],
        ["debugOptimized", DEBUG_NETWORK_SECURITY_CONFIG],
      ]);
      for (const [variant, xml] of variants) {
        const resDir = path.join(
          projectRoot,
          "app",
          "src",
          variant,
          "res",
          "xml",
        );
        fs.mkdirSync(resDir, { recursive: true });
        fs.writeFileSync(path.join(resDir, "network_security_config.xml"), xml);
      }
      return config;
    },
  ]);
};

module.exports = withAndroidLocalCleartext;
