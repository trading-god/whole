import { memo } from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  getAccountAppearance,
  getAccountInitial,
  type AssetKind,
} from "@/features/assets/account-appearance";
import { ACCOUNT_LIST_LEADING_SIZE } from "@/features/accounts/account-list-constants";
import { RADIUS } from "@/theme/sizes";
import { FONT_SIZE, FONT_WEIGHT } from "@/theme/typography";

type AccountAvatarProps = {
  kind: AssetKind;
  name: string;
};

// The account list's visual identifier. Initials identify the account itself;
// the tint identifies its asset kind, so grouped leaves remain distinguishable.
export const AccountAvatar = memo(function AccountAvatar({
  kind,
  name,
}: AccountAvatarProps) {
  const appearance = getAccountAppearance(kind);

  return (
    <View
      aria-hidden
      style={[styles.avatar, { backgroundColor: appearance.tint }]}
    >
      <Text style={[styles.initial, { color: appearance.color }]}>
        {getAccountInitial(name)}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  avatar: {
    alignItems: "center",
    borderRadius: RADIUS.sm,
    flexShrink: 0,
    height: ACCOUNT_LIST_LEADING_SIZE,
    justifyContent: "center",
    width: ACCOUNT_LIST_LEADING_SIZE,
  },
  initial: {
    fontSize: FONT_SIZE.bodySm,
    fontWeight: FONT_WEIGHT.extrabold,
  },
});
