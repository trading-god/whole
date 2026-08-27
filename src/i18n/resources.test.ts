import { describe, expect, it } from "vitest";

import { pickAppLocale, resolveAppLocale } from "@/i18n/resources";

describe("resolveAppLocale", () => {
  it("maps zh to the Simplified Chinese catalog", () => {
    expect(resolveAppLocale("zh")).toBe("zh-Hans");
  });

  it("maps en to English", () => {
    expect(resolveAppLocale("en")).toBe("en");
  });

  it.each([
    ["an unsupported language", "ja"],
    ["null", null],
    ["undefined", undefined],
  ])("returns null for %s", (_label, code) => {
    expect(resolveAppLocale(code)).toBeNull();
  });
});

describe("pickAppLocale", () => {
  it("takes the first supported locale and keeps its full language tag", () => {
    expect(
      pickAppLocale([
        { languageCode: "zh", languageTag: "zh-Hans-SG" },
        { languageCode: "en", languageTag: "en-SG" },
      ]),
    ).toEqual({ locale: "zh-Hans", languageTag: "zh-Hans-SG" });
  });

  // The tag matters as much as the locale: it drives number and currency
  // formatting, so skipping an unsupported entry must skip its tag too rather
  // than pairing the next locale with the wrong region.
  it("skips unsupported entries rather than their position", () => {
    expect(
      pickAppLocale([
        { languageCode: "ja", languageTag: "ja-JP" },
        { languageCode: "en", languageTag: "en-GB" },
      ]),
    ).toEqual({ locale: "en", languageTag: "en-GB" });
  });

  it("falls back to en-SG when nothing is supported", () => {
    expect(
      pickAppLocale([{ languageCode: "ja", languageTag: "ja-JP" }]),
    ).toEqual({ locale: "en", languageTag: "en-SG" });
  });

  it("falls back to en-SG for an empty preference list", () => {
    expect(pickAppLocale([])).toEqual({ locale: "en", languageTag: "en-SG" });
  });
});
