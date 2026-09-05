import { memo, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type AccessibilityActionEvent,
  type LayoutChangeEvent,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { ButtonBase } from "@/components/ButtonBase";
import {
  getAccountAppearance,
  getAccountInitial,
} from "@/features/assets/account-appearance";
import {
  type AssetAccount,
  sumBalancesByKindInCurrency,
} from "@/features/assets/asset-repository";
import { maskAssetAmount } from "@/features/assets/asset-privacy-store";
import { type ExchangeRates } from "@/features/assets/currency-conversion";
import { type Currency } from "@/features/assets/currencies";
import { useAppLocale } from "@/i18n";
import { COLORS } from "@/theme/colors";
import { PRESSED_OPACITY } from "@/theme/interaction";
import { ACCOUNT_ROW_HEIGHT } from "@/theme/sizes";
import { SPACING } from "@/theme/spacing";
import {
  FONT_SIZE,
  FONT_VARIANT,
  FONT_WEIGHT,
  LETTER_SPACING,
} from "@/theme/typography";

// Horizontal travel required to start dragging a row.
const ACTIVATION_OFFSET = 10;
const SNAP_CONFIG = { duration: 200, easing: Easing.out(Easing.ease) };
// The avatar's footprint: its width plus the gap to the identity block. A row
// without an avatar (a child of an institution group) indents its text by the
// same amount so every account name in the card starts on one line.
const AVATAR_SIZE = 44;
const AVATAR_SLOT_WIDTH = AVATAR_SIZE + SPACING.md;

type AccountRowProps = {
  account: AssetAccount;
  displayCurrency: Currency;
  rates: ExchangeRates;
  // When true, the converted balance renders as the shared asset mask instead
  // of the formatted figure. An account whose balance couldn't convert still
  // renders its "—" so missing data isn't mistaken for a hidden amount.
  isBalanceHidden: boolean;
  // Rows under an institution header drop the avatar: the header already names
  // where the account lives, and three identical tinted initials under one
  // "OCBC" said nothing the header hadn't. The text keeps the avatar's indent
  // so grouped and ungrouped names align.
  showAvatar?: boolean;
  isFirst: boolean;
  isActive: boolean;
  onActivate: (id: string | null) => void;
  onOpenAccount: (id: string) => void;
  onRemove: (id: string) => void;
};

// A swipe-to-reveal account row with a two-step inline delete confirmation.
// Extracted from the home screen so the screen orchestrates data and composes
// components instead of implementing a complex interaction control inline
// (mirroring NetWorthChart and CurrencyPicker).
export const AccountRow = memo(function AccountRow({
  account,
  displayCurrency,
  rates,
  isBalanceHidden,
  showAvatar = true,
  isFirst,
  isActive,
  onActivate,
  onOpenAccount,
  onRemove,
}: AccountRowProps) {
  const { t } = useTranslation();
  const { formatCurrency } = useAppLocale();
  const appearance = getAccountAppearance(account.kind);
  const initial = getAccountInitial(account.name);
  // Fold the account's per-currency balances into the display currency so a
  // multi-currency account shows one comparable total. `null` (no balance had
  // a rate) is rendered as a dash below.
  const convertedTotal = useMemo(
    () => sumBalancesByKindInCurrency([account], displayCurrency, rates).total,
    [account, displayCurrency, rates],
  );
  // A negative total is money owed (a credit card), and the sign alone is easy
  // to miss in a column of figures. The amount takes the caution ink and the
  // subtitle says so in words.
  const isLiability = convertedTotal !== null && convertedTotal < 0;
  // Subtitle: currency count for multi-currency accounts, the lone currency
  // code for single-currency ones, nothing for an empty account. A liability
  // leads with the word for it.
  const currencySubtitle =
    account.balances.length > 1
      ? t("home.accountCurrencies", { count: account.balances.length })
      : (account.balances[0]?.currency ?? "");
  const subtitleText = isLiability
    ? `${t("home.liability")} ${currencySubtitle}`.trim()
    : currencySubtitle;
  const [confirming, setConfirming] = useState(false);
  const translateX = useSharedValue(0);
  const startX = useSharedValue(0);
  const actionWidth = useSharedValue(0);

  // Reanimated shared values are mutated by assigning to `.value` — that is
  // the library's API.
  // Close this row when another row opens, and reset the two-step confirmation
  // so reopening always starts from the "delete" state.
  useAnimatedReaction(
    () => isActive,
    (active, previous) => {
      if (active || active === previous) {
        return;
      }
      translateX.value = withTiming(0, SNAP_CONFIG);
      scheduleOnRN(setConfirming, false);
    },
    [isActive],
  );

  const handleActionLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const nextWidth = Math.ceil(event.nativeEvent.layout.width);
      if (nextWidth === actionWidth.value) {
        return;
      }

      actionWidth.value = nextWidth;
      if (isActive) {
        translateX.value = withTiming(-nextWidth, SNAP_CONFIG);
      }
    },
    [actionWidth, isActive, translateX],
  );

  const openDeleteAction = useCallback(() => {
    if (actionWidth.value <= 0) {
      return;
    }
    onActivate(account.id);
    translateX.value = withTiming(-actionWidth.value, SNAP_CONFIG);
  }, [account.id, actionWidth, onActivate, translateX]);

  const handleAccessibilityAction = useCallback(
    (event: AccessibilityActionEvent) => {
      if (event.nativeEvent.actionName === "delete") {
        openDeleteAction();
      }
    },
    [openDeleteAction],
  );

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-ACTIVATION_OFFSET, ACTIVATION_OFFSET])
        .failOffsetY([-ACTIVATION_OFFSET, ACTIVATION_OFFSET])
        .onBegin(() => {
          startX.value = translateX.value;
        })
        .onUpdate((event) => {
          translateX.value = Math.max(
            -actionWidth.value,
            Math.min(0, startX.value + event.translationX),
          );
        })
        .onEnd((event) => {
          const shouldOpen =
            actionWidth.value > 0 &&
            (translateX.value < -actionWidth.value / 2 ||
              event.velocityX < -300);
          if (shouldOpen) {
            translateX.value = withTiming(-actionWidth.value, SNAP_CONFIG);
            scheduleOnRN(onActivate, account.id);
          } else {
            translateX.value = withTiming(0, SNAP_CONFIG);
            scheduleOnRN(onActivate, null);
          }
        }),
    [account.id, actionWidth, onActivate, startX, translateX],
  );

  // Tap navigates to the account detail screen, but only when the row is
  // closed. When swiped open (delete action revealed), a tap collapses it
  // instead so the user can dismiss the action without leaving the screen.
  // Raced with pan: a tap (displacement under ~10px) resolves to Tap, a drag
  // (over the pan's activeOffsetX) resolves to Pan — they don't interfere.
  const tap = useMemo(
    () =>
      Gesture.Tap().onEnd(() => {
        if (translateX.value === 0) {
          scheduleOnRN(onOpenAccount, account.id);
        } else {
          scheduleOnRN(onActivate, null);
        }
      }),
    [account.id, onActivate, onOpenAccount, translateX],
  );

  const composed = useMemo(() => Gesture.Race(tap, pan), [tap, pan]);

  const rowAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  // Two-step inline confirmation: first tap reveals "Confirm", second tap
  // removes the account. No modal prompt.
  const handleDeletePress = () => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    onActivate(null);
    onRemove(account.id);
  };

  return (
    <View>
      {isFirst ? null : <View style={styles.separator} />}
      <View style={styles.rowShell}>
        {/* The delete action sits behind the row as a full-height red tray;
            the opaque row slides left to uncover it, the way a list row does
            on either platform. A tray rather than a floating pill: the
            uncovered strip is then all action, with no card-coloured gap
            around a button for the eye to explain. */}
        <View
          aria-hidden={!isActive}
          accessibilityElementsHidden={!isActive}
          importantForAccessibility={isActive ? "auto" : "no-hide-descendants"}
          style={styles.deleteSlot}
        >
          <ButtonBase
            baseStyle={styles.deleteAction}
            pressedStyle={styles.deleteActionPressed}
            onLayout={handleActionLayout}
            accessibilityLabel={
              confirming
                ? t("home.confirmDeleteAccount")
                : t("home.deleteAccount")
            }
            focusable={isActive}
            onPress={handleDeletePress}
          >
            <Text style={styles.deleteActionText}>
              {confirming ? t("home.confirm") : t("home.delete")}
            </Text>
          </ButtonBase>
        </View>
        <GestureDetector gesture={composed}>
          <Animated.View
            accessible
            accessibilityRole="button"
            accessibilityLabel={account.name}
            accessibilityHint={t("home.openAccountHint")}
            accessibilityActions={[
              { name: "delete", label: t("home.deleteAccount") },
            ]}
            onAccessibilityAction={handleAccessibilityAction}
            style={[styles.accountRow, rowAnimatedStyle]}
          >
            {showAvatar ? (
              <View
                style={[
                  styles.accountIcon,
                  { backgroundColor: appearance.tint },
                ]}
              >
                <Text
                  style={[styles.accountInitial, { color: appearance.color }]}
                >
                  {initial}
                </Text>
              </View>
            ) : null}
            <View
              style={[
                styles.accountIdentity,
                !showAvatar && styles.accountIdentityIndented,
              ]}
            >
              <Text
                ellipsizeMode="tail"
                numberOfLines={2}
                style={styles.accountName}
              >
                {account.name}
              </Text>
              {account.accountLastFourDigits ? (
                <Text style={styles.accountNumber}>
                  **** {account.accountLastFourDigits}
                </Text>
              ) : null}
            </View>
            <View style={styles.accountValue}>
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.5}
                style={[
                  styles.accountBalance,
                  isLiability && styles.accountBalanceLiability,
                ]}
              >
                {convertedTotal !== null
                  ? maskAssetAmount(
                      formatCurrency(convertedTotal, displayCurrency),
                      isBalanceHidden,
                    )
                  : "—"}
              </Text>
              {subtitleText ? (
                <Text style={styles.accountCurrency}>{subtitleText}</Text>
              ) : null}
            </View>
          </Animated.View>
        </GestureDetector>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  rowShell: {
    minHeight: ACCOUNT_ROW_HEIGHT,
    overflow: "hidden",
    position: "relative",
  },
  deleteSlot: {
    alignItems: "flex-end",
    bottom: 0,
    justifyContent: "center",
    position: "absolute",
    right: 0,
    top: 0,
  },
  // Full height of the row, wide enough to read as a target; the row's
  // translation is measured off this box, so the tray is exactly what gets
  // uncovered.
  deleteAction: {
    alignItems: "center",
    backgroundColor: COLORS.danger,
    height: "100%",
    justifyContent: "center",
    minWidth: 88,
    paddingHorizontal: SPACING.lg,
  },
  deleteActionPressed: {
    opacity: PRESSED_OPACITY,
  },
  deleteActionText: {
    color: COLORS.white,
    fontSize: FONT_SIZE.bodySm,
    fontWeight: FONT_WEIGHT.bold,
  },
  accountRow: {
    alignItems: "center",
    backgroundColor: COLORS.card,
    flexDirection: "row",
    minHeight: ACCOUNT_ROW_HEIGHT,
    paddingHorizontal: SPACING.lg,
  },
  accountIcon: {
    alignItems: "center",
    borderRadius: 14,
    flexShrink: 0,
    height: AVATAR_SIZE,
    justifyContent: "center",
    width: AVATAR_SIZE,
  },
  accountInitial: {
    fontSize: FONT_SIZE.bodySm,
    fontWeight: FONT_WEIGHT.extrabold,
  },
  accountIdentity: {
    flex: 1,
    flexShrink: 1,
    marginLeft: SPACING.md,
    minWidth: 0,
  },
  accountIdentityIndented: {
    marginLeft: AVATAR_SLOT_WIDTH,
  },
  accountName: {
    color: COLORS.ink,
    fontSize: FONT_SIZE.body,
    fontWeight: FONT_WEIGHT.bold,
  },
  accountNumber: {
    color: COLORS.subtle,
    fontSize: FONT_SIZE.micro,
    letterSpacing: LETTER_SPACING.numeric,
    marginTop: SPACING.sm,
  },
  accountValue: {
    alignItems: "flex-end",
    flexShrink: 0,
    marginLeft: SPACING.sm,
  },
  accountBalance: {
    color: COLORS.ink,
    fontSize: FONT_SIZE.body,
    fontVariant: FONT_VARIANT.tabular,
    fontWeight: FONT_WEIGHT.bold,
    maxWidth: 150,
  },
  accountBalanceLiability: {
    color: COLORS.caution,
  },
  accountCurrency: {
    color: COLORS.subtle,
    fontSize: FONT_SIZE.caption,
    marginTop: SPACING.sm,
  },
  // The separator starts where the account name does: the row's horizontal
  // padding plus the avatar slot.
  separator: {
    backgroundColor: COLORS.border,
    height: StyleSheet.hairlineWidth,
    marginLeft: SPACING.lg + AVATAR_SLOT_WIDTH,
  },
});
