import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Animated,
  Image,
  StyleSheet,
  Text,
  useAnimatedValue,
  View,
} from "react-native";

import { COLORS } from "@/theme/colors";
import { screenStyles } from "@/theme/screen-styles";
import {
  FONT_SIZE,
  FONT_WEIGHT,
  LETTER_SPACING,
  LINE_HEIGHT,
} from "@/theme/typography";

// The native splash on BOTH platforms shows the logo alone (see
// scripts/generate-app-icons.mjs — Android 12+'s circular mask makes anything
// else impossible there, so iOS matches it for parity). This overlay continues
// it: it mounts on the first React frame with the logo in the exact spot the
// native splash had it, then — once the root layout hides the native splash —
// fades the wordmark and slogan in beneath it, holds the full brand lockup for
// a beat, and fades out to the app.
//
// The overlay sits above the router content but below the native splash until
// `SplashScreen.hideAsync()` lifts it, so the native→JS handoff has no seam:
// same background color, same logo, same position.

// Dead-center of the screen is where the native splash shows the logo (the iOS
// storyboard centers its image; so does Android 12+'s icon view), so anchoring
// there keeps the handoff invisible. 192dp is the safe-circle diameter
// Android 12+ never crops (Expo's splash guidance) — `app.json`'s
// `imageWidth` and this constant must stay equal — a guard test pins them.
export const LOGO_SIZE = 192;
const LOGO_RADIUS = LOGO_SIZE / 2;

// Lockup spacing inherited from the original baked splash image's proportions.
// Its typography comes from the shared theme scale below.
const TEXT_TOP_GAP = 40;

// The wordmark and slogan fade in only after the native splash is gone — the
// eye is on the logo, and text settling in beneath it reads as the brand
// arriving rather than as a flash. The hold keeps the lockup on screen long
// enough to be read; the overlay then fades so the app surfaces gently.
// All three follow community conventions: the fades sit at the MaterialFade
// incoming duration (150ms), and the hold keeps the whole takeover under a
// second — splash animations should complete within 1s, and every extra tick
// of artificial delay is user abandonment risk.
const TEXT_FADE_MS = 150;
const BRAND_HOLD_MS = 500;
const OVERLAY_FADE_MS = 150;

export type BrandSplashProps = {
  /** Flips once the root layout has hidden the native splash. */
  revealed: boolean;
  /** Removes the completed one-shot overlay from the root layout. */
  onFinished: () => void;
};

export function BrandSplash({ revealed, onFinished }: BrandSplashProps) {
  const textOpacity = useAnimatedValue(0);
  const overlayOpacity = useAnimatedValue(1);
  const { t } = useTranslation();

  useEffect(() => {
    if (!revealed) {
      return;
    }
    Animated.timing(textOpacity, {
      toValue: 1,
      duration: TEXT_FADE_MS,
      useNativeDriver: true,
    }).start();
    const exit = Animated.sequence([
      Animated.delay(BRAND_HOLD_MS),
      Animated.timing(overlayOpacity, {
        toValue: 0,
        duration: OVERLAY_FADE_MS,
        useNativeDriver: true,
      }),
    ]);
    exit.start(({ finished }) => {
      if (finished) {
        onFinished();
      }
    });
    return () => {
      exit.stop();
    };
  }, [onFinished, overlayOpacity, revealed, textOpacity]);

  return (
    <Animated.View
      testID="brand-splash"
      style={[styles.overlay, { opacity: overlayOpacity }]}
    >
      <View style={styles.logoAnchor}>
        <Image
          source={require("@/assets/images/logo.png")}
          style={styles.logo}
          testID="brand-splash-logo"
        />
      </View>
      {/* Anchored at 50% height and offset by the logo's radius plus the gap,
          so the text starts right beneath the logo on every screen height. */}
      <Animated.View style={[styles.textAnchor, { opacity: textOpacity }]}>
        <View style={styles.textBlock}>
          <Text style={styles.wordmark}>{t("common.wordmark")}</Text>
          <Text style={styles.slogan}>{t("common.sloganLine1")}</Text>
          <Text style={styles.slogan}>{t("common.sloganLine2")}</Text>
        </View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: COLORS.background,
  },
  // Absolute-fill + center puts the logo at the exact screen center, matching
  // the native splash's icon view for the seamless handoff.
  logoAnchor: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
  },
  logo: {
    width: LOGO_SIZE,
    height: LOGO_SIZE,
  },
  textAnchor: {
    position: "absolute",
    top: "50%",
    left: 0,
    right: 0,
    alignItems: "center",
  },
  textBlock: {
    marginTop: LOGO_RADIUS + TEXT_TOP_GAP,
  },
  // Same wordmark treatment as the home and onboarding headers (brand color,
  // extrabold weight), with the splash lockup's larger theme metrics layered
  // on top.
  wordmark: {
    ...screenStyles.wordmark,
    fontSize: FONT_SIZE.brand,
    letterSpacing: LETTER_SPACING.brand,
    textAlign: "center",
  },
  slogan: {
    color: COLORS.ink,
    fontSize: FONT_SIZE.bodySm,
    fontWeight: FONT_WEIGHT.medium,
    lineHeight: LINE_HEIGHT.tight,
    textAlign: "center",
  },
});
