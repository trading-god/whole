import { useLocales } from "expo-localization";
import { type ErrorBoundaryProps } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/Button";
import { defaultNamespace, pickAppLocale, resources } from "@/i18n/resources";
import { COLORS } from "@/theme/colors";
import { cardSurface } from "@/theme/screen-styles";
import { SPACING } from "@/theme/spacing";
import { FONT_SIZE, FONT_WEIGHT, LINE_HEIGHT } from "@/theme/typography";

// The app-level crash fallback. expo-router's `Try` REPLACES the subtree it
// wraps, so by the time this renders, `RootLayout` and everything it provides
// is gone. That rules out three things the rest of the app takes for granted:
//
//   - `useTranslation` — the i18next instance is created inside `I18nProvider`
//     via `createInstance()`, not as a module singleton, so react-i18next would
//     fall back to a global instance this app never initializes and render the
//     raw keys ("errorBoundary.title") at the user.
//   - `useAppLocale` — its `LocaleContext` went with the tree, and the hook
//     throws when the context is missing.
//   - `SafeAreaView` — `SafeAreaProvider` went with the tree too.
//
// So the copy is resolved straight from `resources` and the layout uses fixed
// padding. This screen is the one thing that must still render when everything
// else has failed; every dependency it takes is a way for it to fail with it.
export function AppErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  // `useLocales` reads the native locale settings directly — no React context
  // involved — so it survives the provider teardown that took i18next with it.
  const copy =
    resources[pickAppLocale(useLocales()).locale][defaultNamespace]
      .errorBoundary;

  return (
    <View style={styles.screen}>
      <View style={styles.card}>
        <Text style={styles.title}>{copy.title}</Text>
        <Text style={styles.description}>{copy.description}</Text>

        {/* The message is shown rather than swallowed, and is selectable. A
            crash caused by unreadable stored data will crash again the moment
            `retry` remounts the tree, so a lone Retry button would be a loop
            with no exit. With no crash reporter by design (account data stays
            on the device), this text is the only diagnostic that exists — the
            user copying it out is the whole reporting channel. */}
        <Text style={styles.detailLabel}>{copy.detailLabel}</Text>
        <ScrollView
          style={styles.detail}
          contentContainerStyle={styles.detailContent}
        >
          <Text selectable style={styles.detailText}>
            {error.message}
          </Text>
        </ScrollView>

        <Button fullWidth onPress={retry} size="lg" style={styles.button}>
          {copy.retry}
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    marginTop: SPACING.xl,
  },
  card: {
    ...cardSurface,
    maxWidth: 420,
    padding: SPACING.xxl,
    width: "100%",
  },
  description: {
    color: COLORS.muted,
    fontSize: FONT_SIZE.body,
    lineHeight: LINE_HEIGHT.body,
    marginTop: SPACING.md,
  },
  detail: {
    backgroundColor: COLORS.surfaceMuted,
    borderRadius: 12,
    marginTop: SPACING.sm,
    maxHeight: 160,
  },
  detailContent: {
    padding: SPACING.md,
  },
  detailLabel: {
    color: COLORS.subtle,
    fontSize: FONT_SIZE.bodySm,
    fontWeight: FONT_WEIGHT.semibold,
    marginTop: SPACING.lg,
  },
  detailText: {
    color: COLORS.muted,
    fontSize: FONT_SIZE.bodySm,
  },
  // A plain View with fixed padding: SafeAreaProvider may have unmounted with
  // the tree this replaced, so insets are not available here.
  screen: {
    alignItems: "center",
    backgroundColor: COLORS.background,
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.xxxl,
  },
  title: {
    color: COLORS.ink,
    fontSize: FONT_SIZE.heading,
    fontWeight: FONT_WEIGHT.extrabold,
  },
});
