import * as Clipboard from "expo-clipboard";
import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/Button";
import { ScreenshotMediaViewer } from "@/components/ScreenshotMediaViewer";
import { SectionHeader } from "@/components/SectionHeader";
import {
  isOcrSupported,
  normalizeOcrResult,
  recognizeTextOnDevice,
} from "@/features/assets/ocr-engine";
import {
  blocksJsonFromNormalized,
  expectedTemplateFromAccounts,
} from "@/features/assets/ocr-fixture";
import { parseOcrBlocks } from "@/features/assets/ocr-parser";
import type { OcrTextBlock } from "@/features/assets/ocr-types";
import type { RecognizedAccount } from "@/features/assets/recognition-types";
import { COLORS } from "@/theme/colors";
import { cardSurface, screenStyles } from "@/theme/screen-styles";
import { CARD_RADIUS } from "@/theme/sizes";
import { SPACING } from "@/theme/spacing";
import { FONT_SIZE, FONT_WEIGHT } from "@/theme/typography";

// Dev-only capture screen for generating OCR regression fixtures (`packages/ocr-eval`).
// Picks a screenshot, runs the real on-device pipeline (native OCR → normalize →
// parse), and hands the user the two fixture files via the clipboard:
//   - blocks.json  — the normalized 0..1 OCR output the eval harness replays
//   - expected.json — the recognized accounts, as an editable template
// The screen deliberately calls the pipeline steps directly rather than
// `recognizeAccountFromScreenshot`, which only returns the final accounts: the
// fixtures need the intermediate blocks too. Follows the same capability gate
// and image-picker choices as the account uploader's production path.
export function AccountScreenshotCapture() {
  const { t } = useTranslation();
  const [uri, setUri] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<OcrTextBlock[] | null>(null);
  const [accounts, setAccounts] = useState<RecognizedAccount[] | null>(null);

  const pickAndRecognize = async () => {
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
      setStatus(t("devOcr.pickerFailed"));
      return;
    }
    if (!picked) {
      setStatus(t("devOcr.pickerFailed"));
      return;
    }
    setUri(picked.uri);
    if (!isOcrSupported()) {
      setStatus(t("devOcr.ocrUnsupported"));
      return;
    }
    setIsRunning(true);
    setStatus(t("devOcr.recognizing"));
    setBlocks(null);
    setAccounts(null);
    let failed = false;
    try {
      // Same three steps as `recognizeAccountFromScreenshot` (screenshot-
      // recognition.ts), but keeping the intermediate normalized blocks that
      // the fixtures need. The picker already decoded the image, so hand its
      // pixel dimensions straight in like the production uploader does.
      const native = await recognizeTextOnDevice(picked.uri);
      const normalized = normalizeOcrResult(
        native,
        picked.width,
        picked.height,
      );
      setBlocks(normalized);
      setAccounts(parseOcrBlocks(normalized));
    } catch {
      failed = true;
    }
    if (!failed) {
      setStatus(null);
    } else {
      setStatus(t("devOcr.recognitionFailed"));
    }
    setIsRunning(false);
  };

  const copyBlocks = async () => {
    if (!blocks) {
      return;
    }
    try {
      await Clipboard.setStringAsync(
        JSON.stringify(blocksJsonFromNormalized(blocks), null, 2),
      );
      Alert.alert(t("devOcr.copyTitle"), t("devOcr.copyBlocksSuccess"));
    } catch {
      Alert.alert(t("devOcr.copyTitle"), t("devOcr.copyFailed"));
    }
  };

  const copyExpected = async () => {
    if (!accounts) {
      return;
    }
    try {
      await Clipboard.setStringAsync(
        JSON.stringify(expectedTemplateFromAccounts(accounts), null, 2),
      );
      Alert.alert(t("devOcr.copyTitle"), t("devOcr.copyExpectedSuccess"));
    } catch {
      Alert.alert(t("devOcr.copyTitle"), t("devOcr.copyFailed"));
    }
  };

  const renderBlocksPreview = () => {
    if (!blocks || blocks.length === 0) {
      return null;
    }
    const visible = blocks.slice(0, 6);
    return (
      <View style={styles.previewList}>
        {visible.map((block, index) => (
          <Text key={index} numberOfLines={1} style={styles.previewLine}>
            {block.text}
          </Text>
        ))}
        {blocks.length > visible.length ? (
          <Text style={styles.previewMore}>
            {t("devOcr.moreBlocks", { count: blocks.length - visible.length })}
          </Text>
        ) : null}
      </View>
    );
  };

  const renderAccountsPreview = () => {
    if (!accounts || accounts.length === 0) {
      return <Text style={styles.previewEmpty}>{t("devOcr.noAccounts")}</Text>;
    }
    return accounts.map((account, index) => (
      <View key={index} style={styles.accountRow}>
        <Text style={styles.accountName} numberOfLines={1}>
          {account.accountName ?? t("devOcr.unnamed")}
        </Text>
        <Text style={styles.accountMeta}>
          {account.balances
            ?.map((b) => `${b.currency} ${b.balance}`)
            .join(", ") ?? t("devOcr.noBalances")}
        </Text>
        {account.accountLastFourDigits ? (
          <Text style={styles.accountMeta}>
            {t("devOcr.lastFour")} {account.accountLastFourDigits}
          </Text>
        ) : null}
        <Text style={styles.accountMeta}>
          {t("devOcr.kindLabel")} {account.kind ?? t("devOcr.unknownKind")}
        </Text>
      </View>
    ));
  };

  return (
    <View style={screenStyles.flex}>
      <ScrollView
        contentContainerStyle={screenStyles.content}
        showsVerticalScrollIndicator={false}
      >
        <Button
          variant="primary"
          onPress={() => void pickAndRecognize()}
          disabled={isRunning}
        >
          {isRunning ? t("devOcr.recognizing") : t("devOcr.pickScreenshot")}
        </Button>

        {status ? (
          <Text accessibilityLiveRegion="polite" style={screenStyles.errorHint}>
            {status}
          </Text>
        ) : null}

        {uri ? (
          <View style={styles.previewCard}>
            <ScreenshotMediaViewer uri={uri} />
          </View>
        ) : null}

        {blocks || accounts ? (
          <SectionHeader title={t("devOcr.resultsTitle")} />
        ) : null}

        {blocks ? (
          <>
            <Text style={styles.sectionLabel}>
              {t("devOcr.blocksLabel", { count: blocks.length })}
            </Text>
            {renderBlocksPreview()}
            <Button
              variant="secondary"
              onPress={() => void copyBlocks()}
              style={styles.copyButton}
            >
              {t("devOcr.copyBlocks")}
            </Button>
          </>
        ) : null}

        {accounts ? (
          <>
            <Text style={styles.sectionLabel}>
              {t("devOcr.accountsLabel", { count: accounts.length })}
            </Text>
            {renderAccountsPreview()}
            <Button
              variant="secondary"
              onPress={() => void copyExpected()}
              style={styles.copyButton}
            >
              {t("devOcr.copyExpected")}
            </Button>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  copyButton: {
    marginTop: SPACING.md,
  },
  previewCard: {
    ...cardSurface,
    height: 240,
    marginTop: SPACING.xl,
    overflow: "hidden",
  },
  previewList: {
    borderColor: COLORS.cardBorder,
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    gap: SPACING.xs,
    padding: SPACING.md,
  },
  previewLine: {
    color: COLORS.ink,
    fontSize: FONT_SIZE.bodySm,
  },
  previewMore: {
    color: COLORS.subtle,
    fontSize: FONT_SIZE.micro,
    marginTop: SPACING.xs,
  },
  previewEmpty: {
    color: COLORS.subtle,
    fontSize: FONT_SIZE.body,
  },
  sectionLabel: {
    color: COLORS.ink,
    fontSize: FONT_SIZE.bodyLg,
    fontWeight: FONT_WEIGHT.bold,
    marginBottom: SPACING.sm,
    marginTop: SPACING.lg,
  },
  accountRow: {
    borderColor: COLORS.cardBorder,
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: SPACING.xs,
    padding: SPACING.md,
  },
  accountName: {
    color: COLORS.ink,
    fontSize: FONT_SIZE.bodyLg,
    fontWeight: FONT_WEIGHT.bold,
  },
  accountMeta: {
    color: COLORS.muted,
    fontSize: FONT_SIZE.bodySm,
  },
});
