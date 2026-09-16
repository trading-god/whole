import { memo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Linking, StyleSheet, Text } from "react-native";

import { Button } from "@/components/Button";
import { ButtonGroup } from "@/components/ButtonGroup";
import { type SelectedSourceImage } from "@/features/accounts/AccountScreenshotUploader";
import { ScrimModal } from "@/components/ScrimModal";
import {
  type DeleteSourceImageResult,
  deleteSourceImages,
  sourceImageDeletionIsSupported,
} from "@/features/assets/source-image-cleanup";
import { COLORS } from "@/theme/colors";
import { scrimCardBase } from "@/theme/screen-styles";
import { SPACING } from "@/theme/spacing";
import { FONT_SIZE, FONT_WEIGHT, LINE_HEIGHT } from "@/theme/typography";

type SourceImageCleanupModalProps = {
  visible: boolean;
  // The images the uploader captured, in the order they were picked. The modal
  // reads their assetIds to delete them; an empty list is allowed so the parent
  // can keep the modal mounted and just toggle `visible`, matching the
  // add-account screen's existing lifecycle.
  //
  // A LIST, because the add screen recognizes a batch: one screenshot per
  // institution, several institutions in one sitting. They are deleted in one
  // change block, which is also one system confirmation — see
  // `deleteSourceImages`.
  sourceImages: readonly SelectedSourceImage[];
  // How many accounts the save wrote, for the title. The modal opens on a
  // success and says so; a batch that saved four accounts from three
  // screenshots should not announce "Account saved".
  savedCount: number;
  // Called when the cleanup flow is done — whether the user kept or deleted the
  // screenshots, or dismissed the modal. The parent closes the modal and
  // navigates back to the overview.
  onFinished: () => void;
};

// Post-save "delete the source screenshots?" dialog, shared by the add-account
// and edit-account screens. Owns the delete logic and its failure prompts
// (limited photo access → deep-link to system settings; generic failure →
// retry alert) so both screens stay in lockstep. The parent controls visibility
// and supplies the captured images; `onFinished` is the single "we're done"
// signal back to the parent. Rendered through the shared `ScrimModal` (same
// scrim-dismiss + card surface as the currency picker sheet).
//
// The whole batch goes in ONE prompt and one delete. Asking per screenshot
// would put the user through five dialogs for a five-screenshot sitting, and a
// cancel partway through would leave them unable to tell which had gone.
//
// `memo`-ized because both screens keep it mounted and only toggle `visible`:
// without it, every keystroke in the form behind it re-ran the deletable-id
// scan and its half-dozen `t()` lookups for a dialog that isn't on screen. All
// four props are already stable — two primitives, the parent's `sourceImages`
// state, and a `useCallback`'d `onFinished`.
export const SourceImageCleanupModal = memo(function SourceImageCleanupModal({
  visible,
  sourceImages,
  savedCount,
  onFinished,
}: SourceImageCleanupModalProps) {
  const { t } = useTranslation();
  const [isBeingDeleted, setIsBeingDeleted] = useState(false);

  // Only the images this device can actually delete. An empty id is dropped
  // rather than counted: it would render a delete button `handleDelete` then
  // no-ops on, and on a mixed batch it would promise to delete more than it
  // can. On Android none of them is deletable (see `sourceImageDeletionIsSupported`),
  // so the list is empty and the modal falls through to the manual copy.
  const deletableIds = sourceImageDeletionIsSupported
    ? sourceImages.flatMap((image) => (image.assetId ? [image.assetId] : []))
    : [];
  const sourceImageCanBeDeleted = deletableIds.length > 0;

  const handleDismiss = () => {
    if (!isBeingDeleted) {
      onFinished();
    }
  };

  const handleDelete = async () => {
    if (deletableIds.length === 0) {
      return;
    }

    setIsBeingDeleted(true);

    try {
      const result: DeleteSourceImageResult =
        await deleteSourceImages(deletableIds);
      if (result.ok) {
        onFinished();
        return;
      }

      // Limited (or absent) photo access: guide the user to grant full access
      // in system settings rather than showing a generic failure.
      if (result.reason === "permission") {
        Alert.alert(
          t("accountScreenshot.deletionPermissionTitle", {
            count: deletableIds.length,
          }),
          t("accountScreenshot.deletionPermissionMessage", {
            count: deletableIds.length,
          }),
          [
            {
              style: "cancel",
              text: t("accountScreenshot.keepScreenshot", {
                count: deletableIds.length,
              }),
              onPress: onFinished,
            },
            {
              text: t("accountScreenshot.openSystemSettings"),
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
    // `count` is not decoration here: both keys are plural-only (`_one`/
    // `_other`), and i18next resolves a plural key ONLY when it is given a
    // count — without one it looks up the bare key, misses, and hands back the
    // key string itself. The alert read "accountScreenshot.deletionErrorTitle"
    // to the user.
    Alert.alert(
      t("accountScreenshot.deletionErrorTitle", {
        count: deletableIds.length,
      }),
      t("accountScreenshot.deletionErrorMessage", {
        count: deletableIds.length,
      }),
    );
  };

  return (
    <ScrimModal
      cardStyle={styles.card}
      onDismiss={handleDismiss}
      visible={visible}
    >
      <Text style={styles.title}>
        {t("accountScreenshot.accountSaved", { count: savedCount })}
      </Text>
      <Text style={styles.description}>
        {sourceImageCanBeDeleted
          ? t("accountScreenshot.cleanupPrompt", { count: deletableIds.length })
          : t("accountScreenshot.cleanupManualPhotoLibrary", {
              count: Math.max(1, sourceImages.length),
            })}
      </Text>

      {sourceImageCanBeDeleted ? (
        <ButtonGroup style={styles.actions}>
          <Button
            size="md"
            variant="secondary"
            disabled={isBeingDeleted}
            onPress={onFinished}
          >
            {t("accountScreenshot.keepScreenshot", {
              count: deletableIds.length,
            })}
          </Button>
          <Button
            size="md"
            variant="danger"
            loading={isBeingDeleted}
            onPress={() => void handleDelete()}
          >
            {t("accountScreenshot.deleteScreenshot", {
              count: deletableIds.length,
            })}
          </Button>
        </ButtonGroup>
      ) : (
        <Button
          size="md"
          variant="primary"
          style={styles.actions}
          onPress={onFinished}
        >
          {t("accountScreenshot.acknowledge")}
        </Button>
      )}
    </ScrimModal>
  );
});

const styles = StyleSheet.create({
  card: {
    ...scrimCardBase,
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.md,
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
