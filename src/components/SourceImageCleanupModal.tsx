import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { Button } from "@/components/Button";
import { ButtonGroup } from "@/components/ButtonGroup";
import { type SelectedSourceImage } from "@/components/AccountScreenshotUploader";
import {
  type DeleteSourceImageResult,
  deleteSourceImage,
  sourceImageDeletionIsSupported,
} from "@/features/assets/source-image-cleanup";
import { COLORS } from "@/theme/colors";
import { modalOverlay } from "@/theme/screen-styles";
import { CARD_RADIUS } from "@/theme/sizes";
import { SPACING } from "@/theme/spacing";
import { FONT_SIZE, FONT_WEIGHT, LINE_HEIGHT } from "@/theme/typography";

type SourceImageCleanupModalProps = {
  visible: boolean;
  // The image captured by the uploader. The modal reads its assetId to delete
  // it; null is allowed so the parent can keep the modal mounted and just toggle
  // `visible`, matching the add-account screen's existing lifecycle.
  sourceImage: SelectedSourceImage | null;
  // Called when the cleanup flow is done — whether the user kept or deleted the
  // screenshot, or dismissed the modal. The parent closes the modal and
  // navigates back to the overview.
  onFinished: () => void;
};

// Post-save "delete the source screenshot?" sheet, shared by the add-account
// and edit-account screens. Owns the delete logic and its failure prompts
// (limited photo access → deep-link to system settings; generic failure →
// retry alert) so both screens stay in lockstep. The parent controls visibility
// and supplies the captured image; `onFinished` is the single "we're done"
// signal back to the parent.
export function SourceImageCleanupModal({
  visible,
  sourceImage,
  onFinished,
}: SourceImageCleanupModalProps) {
  const { t } = useTranslation();
  const [isBeingDeleted, setIsBeingDeleted] = useState(false);

  const sourceImageCanBeDeleted =
    sourceImageDeletionIsSupported && typeof sourceImage?.assetId === "string";

  const handleDelete = async () => {
    if (!sourceImage?.assetId) {
      return;
    }

    setIsBeingDeleted(true);

    try {
      const result: DeleteSourceImageResult = await deleteSourceImage(
        sourceImage.assetId,
      );
      if (result.ok) {
        onFinished();
        return;
      }

      // Limited (or absent) photo access: guide the user to grant full access
      // in system settings rather than showing a generic failure.
      if (result.reason === "permission") {
        Alert.alert(
          t("newAccount.deletionPermissionTitle"),
          t("newAccount.deletionPermissionMessage"),
          [
            {
              style: "cancel",
              text: t("newAccount.keepScreenshot"),
              onPress: onFinished,
            },
            {
              text: t("newAccount.openSystemSettings"),
              onPress: () => {
                void Linking.openSettings();
                onFinished();
              },
            },
          ],
        );
        return;
      }
    } catch {
      // Fall through to the shared error alert below.
    }

    setIsBeingDeleted(false);
    Alert.alert(
      t("newAccount.deletionErrorTitle"),
      t("newAccount.deletionErrorMessage"),
    );
  };

  return (
    <Modal
      animationType="fade"
      onRequestClose={() => {
        if (!isBeingDeleted) {
          onFinished();
        }
      }}
      transparent
      visible={visible}
    >
      <View style={styles.cleanupOverlay}>
        <ScrollView
          contentContainerStyle={styles.cleanupCardContent}
          showsVerticalScrollIndicator={false}
          style={styles.cleanupCard}
        >
          <Text style={styles.cleanupTitle}>
            {t("newAccount.accountSaved")}
          </Text>
          <Text style={styles.cleanupDescription}>
            {sourceImageCanBeDeleted
              ? t("newAccount.cleanupPrompt")
              : Platform.OS === "web"
                ? t("newAccount.cleanupManualBrowser")
                : t("newAccount.cleanupManualPhotoLibrary")}
          </Text>

          {sourceImageCanBeDeleted ? (
            <ButtonGroup style={styles.cleanupActions}>
              <Button
                size="md"
                variant="secondary"
                disabled={isBeingDeleted}
                onPress={onFinished}
              >
                {t("newAccount.keepScreenshot")}
              </Button>
              <Button
                size="md"
                variant="primary"
                disabled={isBeingDeleted}
                onPress={() => void handleDelete()}
              >
                {isBeingDeleted
                  ? t("newAccount.deletingScreenshot")
                  : t("newAccount.deleteScreenshot")}
              </Button>
            </ButtonGroup>
          ) : (
            <Button
              size="md"
              variant="primary"
              style={styles.cleanupSingleButton}
              onPress={onFinished}
            >
              {t("newAccount.acknowledge")}
            </Button>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  cleanupOverlay: {
    ...modalOverlay,
  },
  cleanupCard: {
    backgroundColor: COLORS.card,
    borderRadius: CARD_RADIUS,
    maxHeight: "85%",
    maxWidth: 420,
    width: "100%",
  },
  cleanupCardContent: {
    padding: SPACING.xl,
  },
  cleanupTitle: {
    color: COLORS.ink,
    fontSize: FONT_SIZE.title,
    fontWeight: FONT_WEIGHT.extrabold,
  },
  cleanupDescription: {
    color: COLORS.muted,
    fontSize: FONT_SIZE.body,
    lineHeight: LINE_HEIGHT.body,
    marginTop: SPACING.md,
  },
  cleanupActions: {
    marginTop: SPACING.xxl,
  },
  cleanupSingleButton: {
    marginTop: SPACING.xxl,
  },
});
