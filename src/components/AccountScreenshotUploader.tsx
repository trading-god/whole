import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { Icon } from "@/components/Icon";
import { IconButton } from "@/components/IconButton";
import { PrivacyNote } from "@/components/PrivacyNote";
import { ScreenshotMediaViewer } from "@/components/ScreenshotMediaViewer";
import {
  MissingLlmConfigError,
  type RecognizedAccount,
  recognizeAccountFromScreenshot,
} from "@/features/assets/screenshot-recognition";
import { COLORS } from "@/theme/colors";
import {
  actionLink,
  actionLinkButton,
  cardSurface,
  screenStyles,
} from "@/theme/screen-styles";
import { CARD_RADIUS, RADIUS } from "@/theme/sizes";
import { SPACING } from "@/theme/spacing";
import { FONT_SIZE, FONT_WEIGHT } from "@/theme/typography";

export type SelectedSourceImage = {
  assetId: string | null;
  uri: string;
};

type AccountScreenshotUploaderProps = {
  sourceImage: SelectedSourceImage | null;
  onSourceImageChange: (image: SelectedSourceImage | null) => void;
  // Fired with every account the model returned — a single-account screenshot
  // yields a one-element list, a bank-overview screenshot yields several. The
  // parent decides how to apply them (the add screen routes ≥2 accounts to
  // the multi-account wizard and otherwise fills the single-account form; the
  // edit screen applies the entry matching its account) and reports whether
  // anything was applied, so the badge only reads "Recognized" when the result
  // actually landed on the form. May answer asynchronously: the add screen
  // confirms before a re-upload replaces drafts the user has edited, and the
  // badge waits on that answer rather than guessing it.
  onRecognized: (accounts: RecognizedAccount[]) => boolean | Promise<boolean>;
};

// One height for both states of the screenshot slot (empty upload card and
// selected preview card) so choosing a screenshot doesn't shift the layout.
const SCREENSHOT_CARD_HEIGHT = 220;

// Which failure to surface under the card. Rendered as an inline error hint
// rather than Alert.alert, so the reason stays anchored to the screenshot slot
// that failed instead of vanishing on dismiss.
// "missingConfig" additionally renders a link to the settings screen.
type UploadIssue =
  "missingConfig" | "recognitionFailed" | "noMatchingAccount" | "pickerFailed";

const ISSUE_MESSAGE_KEY = {
  missingConfig: "accountScreenshot.missingLlmConfigMessage",
  recognitionFailed: "accountScreenshot.recognitionFailed",
  noMatchingAccount: "accountScreenshot.noMatchingAccount",
  pickerFailed: "accountScreenshot.pickerErrorMessage",
} as const;

// Screenshot picker + LLM recognition + preview card, shared by the add-account
// and edit-account screens. Owns the recognizing/recognized UI state and the
// recognition error hints (missing LLM config → inline link to settings;
// picker / recognition failures → inline error text) so both screens stay in
// lockstep. The parent owns the selected image (so it can decide whether to
// run the post-save cleanup flow) and applies recognized accounts to its own
// form.
export function AccountScreenshotUploader({
  sourceImage,
  onSourceImageChange,
  onRecognized,
}: AccountScreenshotUploaderProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const [isRecognizing, setIsRecognizing] = useState(false);
  const [hasRecognized, setHasRecognized] = useState(false);
  const [issue, setIssue] = useState<UploadIssue | null>(null);

  // Recognition resolves 1-3s after `pickImage` captured this render's
  // `onRecognized`, by which time the parent may have re-rendered — the user
  // can keep typing into the form while recognition runs. Calling the captured
  // callback would read stale state: the add screen's "replace edited drafts?"
  // guard would see the pre-typing blank draft and silently overwrite the
  // typed input. Reading through the ref always invokes the parent's current
  // handler instead. Synced in an effect (not during render) so the ref stays
  // current without violating the render-time ref-write rule.
  const onRecognizedRef = useRef(onRecognized);
  useEffect(() => {
    onRecognizedRef.current = onRecognized;
  }, [onRecognized]);
  // Drops the recognition side effects if the uploader unmounts before the LLM
  // call resolves. Without it, navigating away mid-recognition still fires
  // `onRecognized` (and the add screen's replace-drafts alert) on whatever
  // screen came next, and calls setState on a gone component.
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const recognizeScreenshot = async (uri: string, originalWidth?: number) => {
    setIsRecognizing(true);
    setIssue(null);
    // The outcome leaves the try as a plain variable rather than a `finally`
    // clause, and the failure kind is picked with if/else rather than a
    // ternary: React Compiler bails out of an entire component containing
    // either a finalizer or a conditional expression inside a try/catch, which
    // would leave this component with no memoization at all. Same reason
    // `pickImage` below resolves its `?? null` after the try.
    let failure: UploadIssue | null = null;
    let recognizedCount = 0;
    let applied = false;
    try {
      const accounts = await recognizeAccountFromScreenshot(uri, originalWidth);
      if (!isMountedRef.current) {
        return;
      }
      recognizedCount = accounts.length;
      // The parent reports whether it applied anything — an unparseable/empty
      // response or an ignored result (e.g. no matching account on the edit
      // screen) must not flip the badge to "Recognized" over an unchanged
      // form.
      applied = await onRecognizedRef.current(accounts);
    } catch (error) {
      if (error instanceof MissingLlmConfigError) {
        failure = "missingConfig";
      } else {
        failure = "recognitionFailed";
      }
    }
    if (!isMountedRef.current) {
      return;
    }
    setIsRecognizing(false);
    setHasRecognized(applied);

    if (failure || applied) {
      setIssue(failure);
      return;
    }
    // Nothing threw and nothing landed. Say which of the two it was: the model
    // read no account at all, or it read accounts and none of them was the one
    // being edited. Without this the badge just reverts to "ready" with every
    // field unchanged, and the user cannot tell a failed endpoint from a
    // screenshot of the wrong account — so they retry the same upload.
    setIssue(recognizedCount === 0 ? "recognitionFailed" : "noMatchingAccount");
  };

  const pickImage = async () => {
    let picked: ImagePicker.ImagePickerAsset | null = null;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: false,
        quality: 1,
      });
      if (result.canceled) {
        return;
      }
      picked = result.assets[0];
    } catch {
      setIssue("pickerFailed");
      return;
    }

    onSourceImageChange({ assetId: picked.assetId ?? null, uri: picked.uri });
    setHasRecognized(false);
    // Cannot throw — recognizeScreenshot funnels every failure into `issue`.
    await recognizeScreenshot(picked.uri, picked.width);
  };

  const badgeLabel = isRecognizing
    ? t("accountScreenshot.recognizing")
    : hasRecognized
      ? t("accountScreenshot.recognized")
      : t("accountScreenshot.screenshotReady");

  return (
    <>
      {sourceImage ? (
        // With a screenshot selected, the image renders through MediaViewer:
        // tapping the thumbnail opens a fullscreen pinch-to-zoom viewer so the
        // user can verify the auto-filled name/last-four/balance against the
        // screenshot — it does NOT re-open the picker. Replacing the screenshot
        // is a separate button on the overlay so inspect and replace don't
        // share one tap. The overlay is `box-none`, so taps pass through to the
        // thumbnail everywhere except on the replace button itself.
        <View style={styles.previewCard}>
          <ScreenshotMediaViewer uri={sourceImage.uri} />
          <View style={styles.overlayLayer} pointerEvents="box-none">
            <View style={styles.readyBadge} pointerEvents="none">
              {isRecognizing ? (
                <ActivityIndicator color={COLORS.brand} size="small" />
              ) : (
                <Icon name="check" size={14} color={COLORS.brand} />
              )}
              <Text style={styles.readyBadgeText}>{badgeLabel}</Text>
            </View>
            <IconButton
              accessibilityHint={t("accountScreenshot.replaceScreenshotHint")}
              accessibilityLabel={t("accountScreenshot.replaceScreenshot")}
              disabled={isRecognizing}
              name="arrow-up"
              onPress={pickImage}
              size="sm"
              style={styles.replaceButton}
              variant="secondary"
            />
          </View>
        </View>
      ) : (
        <Pressable
          accessibilityLabel={t("accountScreenshot.uploadScreenshot")}
          accessibilityRole="button"
          disabled={isRecognizing}
          onPress={pickImage}
          style={({ pressed }) => [
            styles.uploadCard,
            pressed && screenStyles.pressed,
          ]}
        >
          <View style={styles.uploadContent}>
            <View style={styles.uploadIcon}>
              <Icon name="arrow-up" size="lg" color={COLORS.brand} />
            </View>
            <Text style={styles.uploadTitle}>
              {t("accountScreenshot.uploadScreenshot")}
            </Text>
            <Text style={styles.uploadDescription}>
              {t("accountScreenshot.screenshotGuidance")}
            </Text>
            <View style={styles.uploadAction}>
              <Text style={styles.uploadActionText}>
                {t("accountScreenshot.chooseScreenshot")}
              </Text>
            </View>
          </View>
        </Pressable>
      )}
      {issue ? (
        <View style={styles.errorRow}>
          <Text accessibilityLiveRegion="polite" style={screenStyles.errorHint}>
            {t(ISSUE_MESSAGE_KEY[issue])}
          </Text>
          {issue === "missingConfig" ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push("/settings")}
              style={({ pressed }) => [
                actionLinkButton,
                pressed && screenStyles.pressed,
              ]}
            >
              <Text style={actionLink}>
                {t("accountScreenshot.goToSettings")}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      <PrivacyNote message={t("accountScreenshot.screenshotPrivacy")} />
    </>
  );
}

const styles = StyleSheet.create({
  errorRow: {
    gap: SPACING.xs,
    marginTop: SPACING.md,
  },
  previewCard: {
    ...cardSurface,
    borderColor: COLORS.brand,
    borderWidth: 1.5,
    height: SCREENSHOT_CARD_HEIGHT,
    overflow: "hidden",
  },
  // Scrim and overlay content are one layer: the padding insets the badge and
  // replace button without pulling the tint off the card's edges, and the
  // layer's own background never intercepts taps under `box-none`.
  overlayLayer: {
    backgroundColor: COLORS.scrim,
    bottom: 0,
    justifyContent: "space-between",
    left: 0,
    padding: SPACING.md,
    position: "absolute",
    right: 0,
    top: 0,
  },
  // `alignSelf` keeps each overlay child at its own content width instead of
  // being stretched across the column — no wrapper row needed either side.
  readyBadge: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.md,
    flexDirection: "row",
    gap: SPACING.xs,
    maxWidth: "100%",
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
  },
  readyBadgeText: {
    color: COLORS.brand,
    flexShrink: 1,
    fontSize: FONT_SIZE.eyebrow,
    fontWeight: FONT_WEIGHT.extrabold,
  },
  replaceButton: {
    alignSelf: "flex-end",
  },
  uploadCard: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.brandSoftBorder,
    borderRadius: CARD_RADIUS,
    borderStyle: "dashed",
    borderWidth: 1.5,
    minHeight: SCREENSHOT_CARD_HEIGHT,
    overflow: "hidden",
  },
  uploadContent: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.xxl,
  },
  uploadIcon: {
    alignItems: "center",
    backgroundColor: COLORS.brandSoft,
    borderRadius: 22,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  uploadTitle: {
    color: COLORS.ink,
    fontSize: FONT_SIZE.subtitle,
    fontWeight: FONT_WEIGHT.bold,
    marginTop: SPACING.md,
    textAlign: "center",
  },
  uploadDescription: {
    color: COLORS.muted,
    fontSize: FONT_SIZE.eyebrow,
    marginTop: SPACING.sm,
    textAlign: "center",
  },
  uploadAction: {
    backgroundColor: COLORS.brand,
    borderRadius: RADIUS.md,
    marginTop: SPACING.lg,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
  },
  uploadActionText: {
    color: COLORS.white,
    fontSize: FONT_SIZE.eyebrow,
    fontWeight: FONT_WEIGHT.bold,
  },
});
