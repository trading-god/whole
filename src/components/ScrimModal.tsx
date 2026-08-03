import { type ReactNode } from "react";
import {
  type AccessibilityRole,
  Modal,
  Pressable,
  type ViewStyle,
} from "react-native";

import { modalOverlay } from "@/theme/screen-styles";

type ScrimModalProps = {
  visible: boolean;
  // Invoked when the user taps the scrim or requests a close (Android back
  // gesture, web Esc). The parent owns any "not right now" guard — e.g. the
  // cleanup modal suppresses dismiss while a delete is in flight.
  onDismiss: () => void;
  // Card surface style. Callers spread `scrimCardBase` (borderless fill +
  // radius + full width) and add `maxWidth`/`padding` per their content, rather
  // than re-deriving the base — `cardSurface` is not used because its hairline
  // border is intentionally omitted on dialog cards.
  cardStyle: ViewStyle;
  // Optional label for the scrim region (e.g. the dialog title) and role for
  // the card content (e.g. "radiogroup" for a picker). Placed where each
  // consumer had them before extraction, so a11y behavior is unchanged.
  accessibilityLabel?: string;
  accessibilityRole?: AccessibilityRole;
  children: ReactNode;
};

// Centered scrim dialog: a transparent Modal over a dimmed scrim Pressable (tap
// to dismiss) wrapping a card Pressable that swallows taps so only the scrim
// dismisses — not taps on card content or whitespace. Shared by the currency
// picker sheet and the source-image cleanup dialog so the scrim-dismiss +
// tap-swallow idiom has one owner instead of being redeclared per screen.
export function ScrimModal({
  visible,
  onDismiss,
  cardStyle,
  accessibilityLabel,
  accessibilityRole,
  children,
}: ScrimModalProps) {
  return (
    <Modal
      animationType="fade"
      onRequestClose={onDismiss}
      transparent
      visible={visible}
    >
      <Pressable
        accessibilityLabel={accessibilityLabel}
        style={modalOverlay}
        onPress={onDismiss}
      >
        {/* Swallow taps inside the card so only the scrim dismisses the
            dialog, not taps on the title or content whitespace. */}
        <Pressable
          accessibilityRole={accessibilityRole}
          style={cardStyle}
          onPress={() => undefined}
        >
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
