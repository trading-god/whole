import {
  type TextStyle,
  type ViewStyle,
  Platform,
  StyleSheet,
} from "react-native";

import { COLORS } from "@/theme/colors";
import { PRESSED_OPACITY_SURFACE } from "@/theme/interaction";
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

// Shared scrim overlay for bottom sheets (currency picker, chart range,
// institution picker, add-account cleanup). The sheet is pinned to the bottom
// edge; the scrim fills the rest. Spread into a screen-specific style so the
// sheets stay in lockstep instead of each redeclaring the same overlay rules.
export const modalOverlay: ViewStyle = {
  backgroundColor: COLORS.scrim,
  flex: 1,
  justifyContent: "flex-end",
};

// Shared base for the sheet rendered inside `ScrimModal` — borderless (dialog
// sheets intentionally omit the `cardSurface` hairline), with the card fill,
// the top-only radius of a sheet rising from the screen edge, and full width.
// Spread into a screen-specific style and add `padding` per content. Keeps the
// scrim sheets in lockstep instead of each re-deriving fill + radius + width.
export const scrimCardBase: ViewStyle = {
  backgroundColor: COLORS.card,
  borderTopLeftRadius: CARD_RADIUS,
  borderTopRightRadius: CARD_RADIUS,
  width: "100%",
};

// Shared "action link" — brand-colored bold text, used for the account form's
// inline add-currency action. Centralized so the style has one owner instead
// of being redeclared per screen.
export const actionLink: TextStyle = {
  color: COLORS.brand,
  fontSize: FONT_SIZE.bodySm,
  fontWeight: FONT_WEIGHT.bold,
};

// Horizontal inset shared by `content` and `contentScrollEnd` so the
// screen-edge padding has one owner instead of being redeclared per variant.
const contentPadding: ViewStyle = {
  paddingHorizontal: SPACING.xl,
};

// Shared layout primitives for the secondary form screens (add-account, edit
// account, settings) and the home screen: safe area, scroll content padding,
// wordmark, form card, field divider, hint/error copy, pressed feedback, and
// the bottom action bar. Centralized so these screens stay in lockstep instead
// of each redeclaring the same rules and drifting. Blocks with their own
// structure (screen intro, section header) are components, not fragments —
// see ScreenIntro and SectionHeader.
export const screenStyles = StyleSheet.create({
  safeArea: {
    backgroundColor: COLORS.background,
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  content: {
    ...contentPadding,
    paddingBottom: SPACING.xxl,
  },
  // Content inset for scroll screens with no fixed bottom bar — one step more
  // bottom breathing room than `content` so the last card clears the screen
  // edge instead of sitting flush against it (home, dev tools).
  contentScrollEnd: {
    ...contentPadding,
    paddingBottom: SPACING.xxxl,
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
  formHint: {
    color: COLORS.muted,
    fontSize: FONT_SIZE.micro,
  },
  // Explanatory copy under an individual field, spaced off the input it
  // annotates — quieter than `formHint`, which sits under a section header.
  fieldHint: {
    color: COLORS.subtle,
    fontSize: FONT_SIZE.micro,
    lineHeight: LINE_HEIGHT.body,
    marginTop: SPACING.sm,
  },
  // Inline validation/error hint — the danger twin of `formHint`. Shared so
  // blocking-error copy renders identically on every screen and stays on
  // screen next to the field it blocks, instead of a dismissable alert.
  errorHint: {
    color: COLORS.danger,
    fontSize: FONT_SIZE.micro,
    fontWeight: FONT_WEIGHT.semibold,
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
