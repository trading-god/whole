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

import { Button } from "@/components/Button";
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
import { ACCOUNT_ROW_HEIGHT } from "@/theme/sizes";
import { SPACING } from "@/theme/spacing";
import { FONT_SIZE, FONT_WEIGHT, LETTER_SPACING } from "@/theme/typography";

// Horizontal travel required to start dragging a row.
const ACTIVATION_OFFSET = 10;
const ACTION_TRAILING_INSET = 18;
const SNAP_CONFIG = { duration: 200, easing: Easing.out(Easing.ease) };

type AccountRowProps = {
  account: AssetAccount;
  displayCurrency: Currency;
  rates: ExchangeRates;
  // When true, the converted balance renders as the shared asset mask instead
  // of the formatted figure. An account whose balance couldn't convert still
  // renders its "—" so missing data isn't mistaken for a hidden amount.
  isBalanceHidden: boolean;
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
  // Subtitle: currency count for multi-currency accounts, the lone currency
  // code for single-currency ones, nothing for an empty account.
  const subtitleText =
    account.balances.length > 1
      ? t("home.accountCurrencies", { count: account.balances.length })
      : (account.balances[0]?.currency ?? "");
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
      const nextWidth = Math.ceil(
        event.nativeEvent.layout.width + ACTION_TRAILING_INSET,
      );
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
        {/* The delete button sits behind the row; the opaque row slides left
            to reveal it like a drawer. */}
        <View
          aria-hidden={!isActive}
          accessibilityElementsHidden={!isActive}
          importantForAccessibility={isActive ? "auto" : "no-hide-descendants"}
          style={styles.deleteSlot}
        >
          <Button
            variant="danger"
            size="sm"
            fullWidth={false}
            onLayout={handleActionLayout}
            accessibilityLabel={
              confirming
                ? t("home.confirmDeleteAccount")
                : t("home.deleteAccount")
            }
            focusable={isActive}
            onPress={handleDeletePress}
          >
            {confirming ? t("home.confirm") : t("home.delete")}
          </Button>
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
            <View
              style={[styles.accountIcon, { backgroundColor: appearance.tint }]}
            >
              <Text
                style={[styles.accountInitial, { color: appearance.color }]}
              >
                {initial}
              </Text>
            </View>
            <View style={styles.accountIdentity}>
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
                style={styles.accountBalance}
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
    paddingRight: ACTION_TRAILING_INSET,
    position: "absolute",
    right: 0,
    top: 0,
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
    height: 44,
    justifyContent: "center",
    width: 44,
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
    fontWeight: FONT_WEIGHT.bold,
    maxWidth: 150,
  },
  accountCurrency: {
    color: COLORS.subtle,
    fontSize: FONT_SIZE.caption,
    marginTop: SPACING.sm,
  },
  // 72pt inset aligns the separator with the account name (icon width + identity
  // inset); it is a layout-specific constant, not a rhythm value.
  separator: {
    backgroundColor: COLORS.border,
    height: StyleSheet.hairlineWidth,
    marginLeft: 72,
  },
});
