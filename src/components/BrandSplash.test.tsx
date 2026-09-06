import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { act, screen } from "@testing-library/react-native";

import appJson from "../../app.json";
import { BrandSplash, LOGO_SIZE } from "@/components/BrandSplash";
import { renderWithProviders } from "@/test-support/render";
import { COLORS } from "@/theme/colors";

// Lifecycle timings in milliseconds, kept as deliberately loose literals: the
// overlay holds the brand lockup after the native splash hides (500ms), then
// spends 150ms fading out. STILL_HOLDING lands inside the hold, AFTER_FADE
// past the whole lifecycle, without pinning the exact boundaries.
const STILL_HOLDING_MS = 400;
const AFTER_FADE_MS = 2000;

// Fake timers for the whole file: every lifecycle case advances the clock,
// and the one render-only case is indifferent to them. The repo's Jest
// convention (see model-context.test.ts) states the pair once rather than
// wrapping each test in try/finally.
beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

const splashPlugin = appJson.expo.plugins.find(
  (plugin) => Array.isArray(plugin) && plugin[0] === "expo-splash-screen",
);
const splashOptions = Array.isArray(splashPlugin) ? splashPlugin[1] : undefined;

const renderBrandSplash = (revealed: boolean, onFinished = jest.fn()) =>
  renderWithProviders(
    <BrandSplash revealed={revealed} onFinished={onFinished} />,
  );

describe("BrandSplash", () => {
  // The full brand lockup — the part the native splash cannot carry (Android
  // 12+'s circular mask; iOS matches for parity). Runs identically in both
  // platform projects.
  it("renders the logo, wordmark, and slogan", async () => {
    await renderBrandSplash(false);

    expect(screen.getByTestId("brand-splash-logo")).toBeOnTheScreen();
    expect(screen.getByText("WHOLE")).toBeOnTheScreen();
    expect(screen.getByText("Your whole financial life,")).toBeOnTheScreen();
    expect(screen.getByText("in one place.")).toBeOnTheScreen();
  });

  it("stays mounted while unrevealed — the native splash is still up", async () => {
    await renderBrandSplash(false);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(AFTER_FADE_MS);
    });

    expect(screen.getByTestId("brand-splash")).toBeOnTheScreen();
  });

  it("blocks touches while the opaque overlay covers the app", async () => {
    await renderBrandSplash(false);

    expect(screen.getByTestId("brand-splash")).not.toHaveProp(
      "pointerEvents",
      "none",
    );
  });

  it("holds the lockup after reveal, then reports when its fade finishes", async () => {
    const onFinished = jest.fn();
    await renderBrandSplash(true, onFinished);

    // Still inside the brand hold.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(STILL_HOLDING_MS);
    });
    expect(screen.getByTestId("brand-splash")).toBeOnTheScreen();
    expect(onFinished).not.toHaveBeenCalled();

    // Past hold + fade: the parent can remove the completed overlay.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(AFTER_FADE_MS - STILL_HOLDING_MS);
    });
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  // The native→JS handoff is seamless only while both layers use the same
  // logo, size, and background. These values live in different worlds (JSON
  // config vs. TS component), so pin the full contract here.
  it("matches the native splash handoff contract", async () => {
    await renderBrandSplash(false);

    expect(splashOptions).toMatchObject({
      backgroundColor: COLORS.background,
      image: "./assets/images/logo.png",
      imageWidth: LOGO_SIZE,
    });
    expect(screen.getByTestId("brand-splash-logo")).toHaveStyle({
      height: LOGO_SIZE,
      width: LOGO_SIZE,
    });
  });
});
