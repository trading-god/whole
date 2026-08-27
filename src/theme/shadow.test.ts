import { describe, expect, it } from "@jest/globals";
import { Platform } from "react-native";

import { ELEVATED_SHADOW } from "@/theme/shadow";

// Runs under both platform projects, so each branch of the `Platform.select` is
// exercised by the run that owns it — which is the whole reason the Jest config
// declares two projects rather than one.
describe("ELEVATED_SHADOW", () => {
  it("uses the platform's own elevation model", () => {
    if (Platform.OS === "android") {
      // Android has no `shadow*` props; elevation is the only lever.
      expect(ELEVATED_SHADOW).toEqual({ elevation: 7 });
      return;
    }

    // iOS renders `shadow*` and has no `elevation`, so the `default` branch
    // already covers it — no separate `ios` entry is needed.
    expect(ELEVATED_SHADOW).toMatchObject({
      shadowOpacity: expect.any(Number),
      shadowRadius: expect.any(Number),
    });
    expect(ELEVATED_SHADOW).not.toHaveProperty("elevation");
  });
});
