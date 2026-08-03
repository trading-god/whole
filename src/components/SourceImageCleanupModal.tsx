import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Linking, Platform, StyleSheet, Text } from "react-native";

import { Button } from "@/components/Button";
import { ButtonGroup } from "@/components/ButtonGroup";
import { type SelectedSourceImage } from "@/components/AccountScreenshotUploader";
import { ScrimModal } from "@/components/ScrimModal";
import {
  type DeleteSourceImageResult,
  deleteSourceImage,
  sourceImageDeletionIsSupported,
} from "@/features/assets/source-image-cleanup";
import { COLORS } from "@/theme/colors";
import { scrimCardBase } from "@/theme/screen-styles";
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

// Post-save "delete the source screenshot?" dialog, shared by the add-account
// and edit-account screens. Owns the delete logic and its failure prompts
// (limited photo access → deep-link to system settings; generic failure →
// retry alert) so both screens stay in lockstep. The parent controls visibility
// and supplies the captured image; `onFinished` is the single "we're done"
// signal back to the parent. Rendered through the shared `ScrimModal` (same
// scrim-dismiss + card surface as the currency picker sheet).
export function SourceImageCleanupModal({
  visible,
  sourceImage,
  onFinished,
}: SourceImageCleanupModalProps) {
  const { t } = useTranslation();
  const [isBeingDeleted, setIsBeingDeleted] = useState(false);

  // `typeof ... === "string"` would admit an empty id and render the delete
  // button, but `handleDelete` treats `""` as falsy and no-ops — leaving a
  // tappable button that does nothing. Require a non-empty id so the gate and
  // the handler agree.
  const sourceImageCanBeDeleted =
    sourceImageDeletionIsSupported && !!sourceImage?.assetId;

  const handleDismiss = () => {
    if (!isBeingDeleted) {
      onFinished();
    }
  };

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
    <ScrimModal
      cardStyle={styles.card}
      onDismiss={handleDismiss}
      visible={visible}
    >
      <Text style={styles.title}>{t("newAccount.accountSaved")}</Text>
      <Text style={styles.description}>
        {sourceImageCanBeDeleted
          ? t("newAccount.cleanupPrompt")
          : Platform.OS === "web"
            ? t("newAccount.cleanupManualBrowser")
            : t("newAccount.cleanupManualPhotoLibrary")}
      </Text>

      {sourceImageCanBeDeleted ? (
        <ButtonGroup style={styles.actions}>
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
          style={styles.actions}
          onPress={onFinished}
        >
          {t("newAccount.acknowledge")}
        </Button>
      )}
    </ScrimModal>
  );
}

const styles = StyleSheet.create({
  card: {
    ...scrimCardBase,
    maxWidth: 360,
    padding: SPACING.xl,
  },
  title: {
    color: COLORS.ink,
    fontSize: FONT_SIZE.title,
    fontWeight: FONT_WEIGHT.extrabold,
  },
  description: {
    color: COLORS.muted,
    fontSize: FONT_SIZE.body,
    lineHeight: LINE_HEIGHT.body,
    marginTop: SPACING.md,
  },
  actions: {
    marginTop: SPACING.xxl,
  },
});
