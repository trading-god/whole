import {
  type TextStyle,
  type ViewStyle,
  Platform,
  StyleSheet,
} from "react-native";

import { COLORS } from "@/theme/colors";
import { PRESSED_OPACITY_SURFACE } from "@/theme/interaction";
import { MIN_INTERACTIVE_SIZE } from "@/theme/layout";
import { CARD_RADIUS } from "@/theme/sizes";
import { SPACING } from "@/theme/spacing";
import {
  FONT_SIZE,
  FONT_WEIGHT,
  LETTER_SPACING,
  LINE_HEIGHT,
} from "@/theme/typography";

// Shared card surface: card fill, hairline border, 22pt radius. Spread into a
// screen-specific style to add padding/overflow without redeclaring the base.
export const cardSurface: ViewStyle = {
  backgroundColor: COLORS.card,
  borderColor: COLORS.cardBorder,
  borderRadius: CARD_RADIUS,
  borderWidth: 1,
};

// Shared centered scrim overlay for modal sheets/dialogs (currency picker,
// add-account cleanup). Spread into a screen-specific style so the modals stay
// in lockstep instead of each redeclaring the same overlay rules.
export const modalOverlay: ViewStyle = {
  alignItems: "center",
  backgroundColor: COLORS.scrim,
  flex: 1,
  justifyContent: "center",
  paddingHorizontal: SPACING.xl,
};

// Shared base for a card rendered inside `ScrimModal` — borderless (dialog
// cards intentionally omit the `cardSurface` hairline), with the card fill,
// radius, and full width that every scrim-dialog card shares. Spread into a
// screen-specific style and add `maxWidth`/`padding` per content. Keeps the
// scrim dialogs in lockstep instead of each re-deriving fill + radius + width.
export const scrimCardBase: ViewStyle = {
  backgroundColor: COLORS.card,
  borderRadius: CARD_RADIUS,
  width: "100%",
};

// Shared "action link" — brand-colored bold text in a minimum-size pressable,
// used for the home screen's inline add-account action. Centralized so the
// style has one owner instead of being redeclared per screen.
export const actionLinkButton: ViewStyle = {
  alignItems: "center",
  alignSelf: "flex-start",
  justifyContent: "center",
  minHeight: MIN_INTERACTIVE_SIZE,
  minWidth: MIN_INTERACTIVE_SIZE,
  paddingHorizontal: SPACING.sm,
};

export const actionLink: TextStyle = {
  color: COLORS.brand,
  fontSize: FONT_SIZE.bodySm,
  fontWeight: FONT_WEIGHT.bold,
};

// Shared layout primitives for the secondary form screens (add-account,
// settings) and the home screen: safe area, scroll content padding, intro
// block, form card, field divider, action link, pressed feedback, and the
// bottom action bar. Centralized so these screens stay in lockstep instead of
// each redeclaring the same rules and drifting.
export const screenStyles = StyleSheet.create({
  safeArea: {
    backgroundColor: COLORS.background,
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  content: {
    paddingBottom: SPACING.xxl,
    paddingHorizontal: SPACING.xl,
  },
  intro: {
    paddingBottom: SPACING.xl,
    paddingTop: SPACING.md,
  },
  title: {
    color: COLORS.ink,
    fontSize: 28,
    fontWeight: FONT_WEIGHT.bold,
    letterSpacing: -0.8,
  },
  subtitle: {
    color: COLORS.muted,
    fontSize: FONT_SIZE.body,
    lineHeight: LINE_HEIGHT.body,
    marginTop: SPACING.sm,
  },
  // Brand wordmark shown in the home and onboarding headers. Centralized so a
  // change to the wordmark treatment lands in one place instead of per screen.
  wordmark: {
    color: COLORS.brand,
    fontSize: FONT_SIZE.eyebrow,
    fontWeight: FONT_WEIGHT.extrabold,
    letterSpacing: LETTER_SPACING.wordmark,
  },
  formCard: {
    ...cardSurface,
    paddingHorizontal: SPACING.lg,
  },
  fieldDivider: {
    backgroundColor: COLORS.border,
    height: StyleSheet.hairlineWidth,
  },
  // Section header above a form card (the "Account information" block on the
  // add-account and edit-account screens). Shared so the two forms stay in
  // lockstep instead of each redeclaring it.
  formHeader: {
    marginBottom: SPACING.md,
    marginTop: SPACING.xxl,
    paddingHorizontal: 2,
  },
  formHint: {
    color: COLORS.muted,
    fontSize: FONT_SIZE.micro,
  },
  pressed: {
    opacity: PRESSED_OPACITY_SURFACE,
  },
  bottomBar: {
    backgroundColor: COLORS.background,
    borderTopColor: COLORS.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingBottom: Platform.OS === "ios" ? SPACING.sm : SPACING.md,
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.md,
  },
});
