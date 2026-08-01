import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { Icon } from "@/components/Icon";
import { PrivacyNote } from "@/components/PrivacyNote";
import {
  MissingLlmConfigError,
  type RecognizedAccount,
  recognizeAccountFromScreenshot,
} from "@/features/assets/screenshot-recognition";
import { COLORS } from "@/theme/colors";
import { screenStyles } from "@/theme/screen-styles";
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
  // Fired with whatever the model returned (fields the model couldn't determine
  // are omitted). The parent decides which fields to apply — the add-account
  // screen writes the last four digits, the edit screen keeps the existing
  // account's last four (immutable) and only updates name/balances/kind.
  onRecognized: (recognized: RecognizedAccount) => void;
};

// Screenshot picker + LLM recognition + preview card, shared by the add-account
// and edit-account screens. Owns the recognizing/recognized UI state and the
// recognition error prompts (missing LLM config → deep-link to settings; picker
// / recognition failures → generic alerts) so both screens stay in lockstep.
// The parent owns the selected image (so it can decide whether to run the
// post-save cleanup flow) and applies recognized fields to its own form.
export function AccountScreenshotUploader({
  sourceImage,
  onSourceImageChange,
  onRecognized,
}: AccountScreenshotUploaderProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const [isRecognizing, setIsRecognizing] = useState(false);
  const [hasRecognized, setHasRecognized] = useState(false);

  const recognizeScreenshot = async (uri: string, originalWidth?: number) => {
    setIsRecognizing(true);
    try {
      const recognized = await recognizeAccountFromScreenshot(
        uri,
        originalWidth,
      );
      onRecognized(recognized);
      setHasRecognized(true);
    } catch (error) {
      if (error instanceof MissingLlmConfigError) {
        Alert.alert(
          t("newAccount.missingLlmConfigTitle"),
          t("newAccount.missingLlmConfigMessage"),
          [
            { style: "cancel", text: t("common.cancel") },
            {
              text: t("newAccount.goToSettings"),
              onPress: () => router.push("/settings"),
            },
          ],
        );
      } else {
        Alert.alert(t("newAccount.recognitionFailed"));
      }
    } finally {
      setIsRecognizing(false);
    }
  };

  const pickImage = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: false,
        quality: 1,
      });

      if (result.canceled) {
        return;
      }

      const selectedAsset = result.assets[0];
      onSourceImageChange({
        assetId: selectedAsset.assetId ?? null,
        uri: selectedAsset.uri,
      });
      setHasRecognized(false);
      await recognizeScreenshot(selectedAsset.uri, selectedAsset.width);
    } catch {
      Alert.alert(
        t("newAccount.pickerErrorTitle"),
        t("newAccount.pickerErrorMessage"),
      );
    }
  };

  return (
    <>
      <Pressable
        accessibilityLabel={
          sourceImage
            ? t("newAccount.changeScreenshot")
            : t("newAccount.uploadScreenshot")
        }
        accessibilityRole="button"
        disabled={isRecognizing}
        onPress={pickImage}
        style={({ pressed }) => [
          styles.uploadCard,
          sourceImage && styles.uploadCardWithImage,
          pressed && screenStyles.pressed,
        ]}
      >
        {sourceImage ? (
          <>
            <Image
              contentFit="cover"
              source={{ uri: sourceImage.uri }}
              style={styles.previewImage}
            />
            <View style={styles.previewScrim} />
            <View style={styles.previewContent}>
              <View style={styles.readyBadge}>
                {isRecognizing ? (
                  <ActivityIndicator color={COLORS.brand} size="small" />
                ) : (
                  <Icon name="check" size={14} color={COLORS.brand} />
                )}
                <Text style={styles.readyBadgeText}>
                  {isRecognizing
                    ? t("newAccount.recognizing")
                    : hasRecognized
                      ? t("newAccount.recognized")
                      : t("newAccount.screenshotReady")}
                </Text>
              </View>
              <Text style={styles.changeImageText}>
                {t("newAccount.tapToChangeScreenshot")}
              </Text>
            </View>
          </>
        ) : (
          <View style={styles.uploadContent}>
            <View style={styles.uploadIcon}>
              <Icon name="arrow-up" size="lg" color={COLORS.brand} />
            </View>
            <Text style={styles.uploadTitle}>
              {t("newAccount.uploadScreenshot")}
            </Text>
            <Text style={styles.uploadDescription}>
              {t("newAccount.screenshotGuidance")}
            </Text>
            <View style={styles.uploadAction}>
              <Text style={styles.uploadActionText}>
                {t("newAccount.chooseScreenshot")}
              </Text>
            </View>
          </View>
        )}
      </Pressable>
      <PrivacyNote message={t("newAccount.screenshotPrivacy")} />
    </>
  );
}

const styles = StyleSheet.create({
  uploadCard: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.brandSoftBorder,
    borderRadius: CARD_RADIUS,
    borderStyle: "dashed",
    borderWidth: 1.5,
    minHeight: 218,
    overflow: "hidden",
  },
  uploadCardWithImage: {
    borderColor: COLORS.brand,
    borderStyle: "solid",
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
  previewImage: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  previewScrim: {
    backgroundColor: COLORS.scrim,
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  previewContent: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 218,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.xxl,
  },
  readyBadge: {
    alignItems: "center",
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
    textAlign: "center",
  },
  changeImageText: {
    color: COLORS.white,
    fontSize: FONT_SIZE.eyebrow,
    fontWeight: FONT_WEIGHT.semibold,
    marginTop: SPACING.md,
    textAlign: "center",
  },
});
