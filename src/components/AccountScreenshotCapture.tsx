import * as Clipboard from "expo-clipboard";
import { Directory, File, Paths } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import * as Sharing from "expo-sharing";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { zip } from "react-native-zip-archive";

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

// One captured screenshot's OCR result, staged for the batch zip.
type CapturedSample = {
  slug: string;
  blocks: OcrTextBlock[];
  imageUri: string;
};

// Runs the on-device OCR pipeline on one picked image, returning the normalized
// blocks. Shared by the single-pick and batch paths so a change to the capture
// pipeline (engine call, normalization, dimensions) is one edit, not two.
async function runOcrOnAsset(
  asset: ImagePicker.ImagePickerAsset,
): Promise<OcrTextBlock[]> {
  const native = await recognizeTextOnDevice(asset.uri);
  return normalizeOcrResult(native, asset.width, asset.height);
}

// Dev-only capture screen for generating OCR regression fixtures (`packages/ocr-eval`).
// Two modes:
//   - Single: pick one screenshot, run OCR, copy blocks.json / expected.json via clipboard.
//   - Batch: pick multiple screenshots, run OCR on each, pack into a zip (one folder per
//     image: samples/<slug>/blocks.json + samples/<slug>/screenshot.png), share the zip.
//     The zip's folder structure matches what `pnpm eval:ocr:import <folder>` expects,
//     so after sharing + unzipping on a Mac, the import script places everything.
export function AccountScreenshotCapture() {
  const { t } = useTranslation();
  const [uri, setUri] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<OcrTextBlock[] | null>(null);
  const [accounts, setAccounts] = useState<RecognizedAccount[] | null>(null);

  // Batch state.
  const [batch, setBatch] = useState<CapturedSample[]>([]);

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
      const normalized = await runOcrOnAsset(picked);
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

  // Batch: pick multiple screenshots, OCR each, stage them for zip export.
  const pickAndRecognizeBatch = async () => {
    if (!isOcrSupported()) {
      setStatus(t("devOcr.ocrUnsupported"));
      return;
    }
    let assets: ImagePicker.ImagePickerAsset[] = [];
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsMultipleSelection: true,
        allowsEditing: false,
        quality: 1,
      });
      if (result.canceled) {
        return;
      }
      assets = result.assets;
    } catch {
      setStatus(t("devOcr.pickerFailed"));
      return;
    }
    if (assets.length === 0) {
      return;
    }

    setIsRunning(true);
    const captured: CapturedSample[] = [];
    for (let i = 0; i < assets.length; i++) {
      const asset = assets[i];
      setStatus(
        t("devOcr.batchProgress", { current: i + 1, total: assets.length }),
      );
      try {
        const normalized = await runOcrOnAsset(asset);
        captured.push({
          slug: slugFromAsset(asset, i),
          blocks: normalized,
          imageUri: asset.uri,
        });
      } catch {
        setStatus(t("devOcr.batchFailed", { current: i + 1 }));
        setIsRunning(false);
        return;
      }
    }
    setBatch(captured);
    setStatus(t("devOcr.batchDone", { count: captured.length }));
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

  // Packs the staged batch into a zip whose structure mirrors the eval
  // samples directory:
  //   samples/<slug>/blocks.json
  //   samples/<slug>/screenshot.png
  // Then shares it via the system share sheet. The recipient unzips and runs
  // `pnpm eval:ocr:import <folder>` to place the samples.
  const shareBatchZip = async () => {
    if (batch.length === 0) {
      return;
    }
    setIsRunning(true);
    setStatus(t("devOcr.recognizing"));
    try {
      // Stage under the app's document directory. `Paths.document` is the
      // app-private folder that survives across launches; we clean and
      // recreate the staging tree each share so a re-share doesn't accumulate
      // old samples.
      const stagingDir = new Directory(Paths.document, "ocr-batch");
      const samplesDir = new Directory(stagingDir, "samples");
      if (stagingDir.exists) {
        stagingDir.delete();
      }
      samplesDir.create({ intermediates: true });

      for (const sample of batch) {
        const sampleDir = new Directory(samplesDir, sample.slug);
        sampleDir.create();
        const blocksFile = new File(sampleDir, "blocks.json");
        blocksFile.write(
          JSON.stringify(blocksJsonFromNormalized(sample.blocks), null, 2),
        );
        const screenshotFile = new File(sampleDir, "screenshot.png");
        await new File(sample.imageUri).copy(screenshotFile, {
          overwrite: true,
        });
      }

      // `zip` takes a source folder URI and a destination URI (both file paths).
      // The staging tree was recreated above, so the zip file is always fresh.
      const zipFile = new File(stagingDir, "ocr-fixtures.zip");
      await zip(samplesDir.uri, zipFile.uri);

      await Sharing.shareAsync(zipFile.uri, {
        mimeType: "application/zip",
        dialogTitle: t("devOcr.batchShareTitle"),
      });

      // Clean the staging tree so the next batch starts fresh.
      stagingDir.delete();
      setStatus(null);
    } catch {
      setStatus(t("devOcr.shareFailed"));
    }
    setIsRunning(false);
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

        <SectionHeader title={t("devOcr.batchTitle")} />
        <Text style={screenStyles.formHint}>{t("devOcr.batchHint")}</Text>
        <Button
          variant="secondary"
          onPress={() => void pickAndRecognizeBatch()}
          disabled={isRunning}
          style={styles.copyButton}
        >
          {t("devOcr.pickBatch")}
        </Button>

        {batch.length > 0 ? (
          <>
            <Text style={styles.sectionLabel}>
              {t("devOcr.batchDone", { count: batch.length })}
            </Text>
            <View style={styles.previewList}>
              {batch.map((sample, index) => (
                <Text key={index} numberOfLines={1} style={styles.previewLine}>
                  {sample.slug} —{" "}
                  {t("devOcr.blocksLabel", { count: sample.blocks.length })}
                </Text>
              ))}
            </View>
            <Button
              variant="primary"
              onPress={() => void shareBatchZip()}
              disabled={isRunning}
              style={styles.copyButton}
            >
              {t("devOcr.batchShareTitle")}
            </Button>
          </>
        ) : null}

        {status ? (
          <Text accessibilityLiveRegion="polite" style={screenStyles.errorHint}>
            {status}
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

// Derives a sample slug from the picked asset. Uses the asset's filename when
// available (sans extension, lowercased, spaces→dashes); falls back to a
// 1-based index so every sample has a stable, filesystem-safe slug.
function slugFromAsset(
  asset: ImagePicker.ImagePickerAsset,
  index: number,
): string {
  const fromName = asset.fileName
    ?.replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return fromName && fromName.length > 0 ? fromName : `sample-${index + 1}`;
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
