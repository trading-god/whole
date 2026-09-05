import { type ReactNode, useContext } from "react";
import {
  type AccessibilityRole,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type ViewStyle,
} from "react-native";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";

import { COLORS } from "@/theme/colors";
import { modalOverlay } from "@/theme/screen-styles";
import { SPACING } from "@/theme/spacing";

type ScrimModalProps = {
  visible: boolean;
  // Invoked when the user taps the scrim or requests a close (e.g. the Android
  // back gesture). The parent owns any "not right now" guard — e.g. the
  // cleanup modal suppresses dismiss while a delete is in flight.
  onDismiss: () => void;
  // Sheet surface style. Callers spread `scrimCardBase` (borderless fill +
  // top radius + full width) and add `padding` per their content, rather than
  // re-deriving the base — `cardSurface` is not used because its hairline
  // border is intentionally omitted on dialog cards.
  cardStyle: ViewStyle;
  // Optional label for the scrim region (e.g. the dialog title) and role for
  // the card content (e.g. "radiogroup" for a picker). Placed where each
  // consumer had them before extraction, so a11y behavior is unchanged.
  accessibilityLabel?: string;
  accessibilityRole?: AccessibilityRole;
  children: ReactNode;
};

// The sheet never takes the whole screen: the scrim above it is what says
// "tap here to go back", and a sheet that reaches the status bar has none.
const SHEET_MAX_HEIGHT_RATIO = 0.8;

// Bottom sheet over a dimmed scrim: a transparent Modal whose scrim Pressable
// dismisses on tap, sliding a sheet up from the bottom edge. The sheet swallows
// taps so only the scrim dismisses — not taps on content or whitespace — and
// its body scrolls once the content outgrows the sheet, so a long option list
// (the institution picker) never runs off the screen. Shared by every
// single-select picker and the source-image cleanup dialog so the
// scrim-dismiss + tap-swallow + scroll idiom has one owner.
//
// A sheet rather than a centred card because that is what a phone user
// expects a transient choice to look like: it sits under the thumb, it slides
// in the direction it dismisses, and the content above it stays legible for
// context.
export function ScrimModal({
  visible,
  onDismiss,
  cardStyle,
  accessibilityLabel,
  accessibilityRole,
  children,
}: ScrimModalProps) {
  // Read through the context rather than `useSafeAreaInsets`, which throws
  // when no provider is above it: the sheet degrades to its own minimum
  // padding instead of taking a screen down with it.
  const bottomInset = useContext(SafeAreaInsetsContext)?.bottom ?? 0;
  const { height: windowHeight } = useWindowDimensions();

  return (
    <Modal
      animationType="slide"
      onRequestClose={onDismiss}
      transparent
      visible={visible}
    >
      <Pressable
        accessibilityLabel={accessibilityLabel}
        style={modalOverlay}
        onPress={onDismiss}
      >
        {/* Swallow taps inside the sheet so only the scrim dismisses the
            dialog, not taps on the title or content whitespace. */}
        <Pressable
          accessibilityRole={accessibilityRole}
          style={[
            cardStyle,
            {
              maxHeight: windowHeight * SHEET_MAX_HEIGHT_RATIO,
              // The home indicator sits inside the sheet's bottom edge, so the
              // sheet pads itself past it rather than letting the last option
              // land under the indicator.
              paddingBottom: Math.max(bottomInset, SPACING.lg),
            },
          ]}
          onPress={() => undefined}
        >
          <View style={styles.grabber} />
          <ScrollView
            bounces={false}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            style={styles.body}
          >
            {children}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // The drag affordance every bottom sheet carries. Decorative here (the sheet
  // dismisses on scrim tap and the back gesture), but it is the shape users
  // read as "this slides away", which the old centred card never signalled.
  grabber: {
    alignSelf: "center",
    backgroundColor: COLORS.border,
    borderRadius: 2,
    height: 4,
    marginBottom: SPACING.md,
    width: 36,
  },
  // `flexGrow: 0` keeps a short list at its content height instead of the
  // ScrollView stretching the sheet to its maximum.
  body: {
    flexGrow: 0,
  },
});
