// Shared option-row styles for the centered "pick one of these" sheet every
// single-select control opens (OptionPicker's currency/chart switchers and the
// account form's InstitutionPicker). The option row, selection highlight,
// pressed feedback, and label text render identically across them, so they live
// once rather than being copy-pasted into each picker — a theming pass edits one
// file instead of three. Per-picker `card` insets and trigger surfaces stay
// local because they size to each context (a compact picker vs. a form field).
import { StyleSheet } from "react-native";

import { COLORS } from "@/theme/colors";
import { PRESSED_OPACITY_SURFACE } from "@/theme/interaction";
import { CHIP_RADIUS } from "@/theme/sizes";
import { SPACING } from "@/theme/spacing";
import { FONT_SIZE, FONT_WEIGHT } from "@/theme/typography";

export const optionSheetStyles = StyleSheet.create({
  option: {
    alignItems: "center",
    borderRadius: CHIP_RADIUS,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
  },
  optionSelected: {
    backgroundColor: COLORS.brandSoft,
  },
  optionPressed: {
    opacity: PRESSED_OPACITY_SURFACE,
  },
  optionText: {
    color: COLORS.ink,
    flexShrink: 1,
    fontSize: FONT_SIZE.bodyLg,
    fontWeight: FONT_WEIGHT.semibold,
  },
  optionTextSelected: {
    color: COLORS.brand,
  },
});
