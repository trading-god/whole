import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import Head from "expo-router/head";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  addAssetAccount,
  isValidLastFourDigits,
} from "@/features/assets/asset-repository";
import {
  type Currency,
  defaultAssetCurrency,
  supportedAssetCurrencies,
} from "@/features/assets/currencies";
import {
  deleteSourceImage,
  sourceImageDeletionIsSupported,
} from "@/features/assets/source-image-cleanup";
import { COLORS } from "@/theme/colors";

type FieldProps = {
  label: string;
  placeholder: string;
  value: string;
  onChangeText: (value: string) => void;
  keyboardType?: "default" | "decimal-pad" | "number-pad";
  maxLength?: number;
  prefix?: string;
};

type SelectedSourceImage = {
  assetId: string | null;
  uri: string;
};

function FormField({
  label,
  placeholder,
  value,
  onChangeText,
  keyboardType = "default",
  maxLength,
  prefix,
}: FieldProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.inputShell}>
        {prefix ? <Text style={styles.inputPrefix}>{prefix}</Text> : null}
        <TextInput
          autoCorrect={false}
          keyboardType={keyboardType}
          maxLength={maxLength}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={COLORS.subtle}
          selectionColor={COLORS.brand}
          style={styles.input}
          value={value}
        />
      </View>
    </View>
  );
}

export default function NewAccountScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const [selectedSourceImage, setSelectedSourceImage] =
    useState<SelectedSourceImage | null>(null);
  const [accountName, setAccountName] = useState("");
  const [accountLastFourDigits, setAccountLastFourDigits] = useState("");
  const [balance, setBalance] = useState("");
  const [currency, setCurrency] = useState<Currency>(defaultAssetCurrency);
  const [isSaving, setIsSaving] = useState(false);
  const [sourceImageCleanupIsVisible, setSourceImageCleanupIsVisible] =
    useState(false);
  const [sourceImageIsBeingDeleted, setSourceImageIsBeingDeleted] =
    useState(false);

  const sourceImageCanBeDeleted =
    sourceImageDeletionIsSupported &&
    typeof selectedSourceImage?.assetId === "string";

  const normalizedBalance = Number(balance.replace(/[,\s]/g, ""));

  const canSave =
    accountName.trim().length > 0 &&
    isValidLastFourDigits(accountLastFourDigits) &&
    balance.trim().length > 0 &&
    Number.isFinite(normalizedBalance) &&
    normalizedBalance >= 0 &&
    !isSaving;

  const pickImage = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: false,
        quality: 1,
      });

      if (!result.canceled) {
        const selectedAsset = result.assets[0];

        setSelectedSourceImage({
          assetId: selectedAsset.assetId ?? null,
          uri: selectedAsset.uri,
        });
      }
    } catch {
      Alert.alert(
        t("newAccount.pickerErrorTitle"),
        t("newAccount.pickerErrorMessage"),
      );
    }
  };

  const returnToAssetOverview = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace("/");
  };

  const finishSourceImageCleanup = () => {
    setSourceImageCleanupIsVisible(false);
    returnToAssetOverview();
  };

  const deleteSelectedSourceImage = async () => {
    if (!selectedSourceImage?.assetId) {
      return;
    }

    setSourceImageIsBeingDeleted(true);

    try {
      if (await deleteSourceImage(selectedSourceImage.assetId)) {
        finishSourceImageCleanup();
        return;
      }
    } catch {
      // Fall through to the shared error alert below.
    }

    setSourceImageIsBeingDeleted(false);
    Alert.alert(
      t("newAccount.deletionErrorTitle"),
      t("newAccount.deletionErrorMessage"),
    );
  };

  const saveAccount = async () => {
    if (!canSave) {
      Alert.alert(
        t("newAccount.validationTitle"),
        t("newAccount.validationMessage"),
      );
      return;
    }

    setIsSaving(true);

    try {
      await addAssetAccount({
        name: accountName.trim(),
        accountLastFourDigits,
        balance: normalizedBalance,
        currency,
      });

      if (selectedSourceImage) {
        setSourceImageCleanupIsVisible(true);
      } else {
        returnToAssetOverview();
      }
    } catch {
      Alert.alert(
        t("newAccount.saveErrorTitle"),
        t("newAccount.saveErrorMessage"),
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <Head>
        <title>{t("metadata.newAccountTitle")}</title>
        <meta
          name="description"
          content={t("metadata.newAccountDescription")}
        />
        <meta name="robots" content="noindex,nofollow" />
      </Head>
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.flex}
        >
          <View style={styles.navigation}>
            <Pressable
              accessibilityLabel={t("common.backToAssetOverview")}
              hitSlop={12}
              onPress={returnToAssetOverview}
              style={({ pressed }) => [
                styles.backButton,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.backIcon}>‹</Text>
            </Pressable>
            <Text style={styles.navigationTitle}>
              {t("newAccount.screenTitle")}
            </Text>
            <View style={styles.navigationSpacer} />
          </View>

          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.intro}>
              <Text style={styles.title}>{t("newAccount.introTitle")}</Text>
              <Text style={styles.subtitle}>
                {t("newAccount.introDescription")}
              </Text>
            </View>

            <Pressable
              accessibilityLabel={
                selectedSourceImage
                  ? t("newAccount.changeScreenshot")
                  : t("newAccount.uploadScreenshot")
              }
              onPress={pickImage}
              style={({ pressed }) => [
                styles.uploadCard,
                selectedSourceImage && styles.uploadCardWithImage,
                pressed && styles.pressed,
              ]}
            >
              {selectedSourceImage ? (
                <>
                  <Image
                    contentFit="cover"
                    source={{ uri: selectedSourceImage.uri }}
                    style={styles.previewImage}
                  />
                  <View style={styles.previewScrim} />
                  <View style={styles.previewContent}>
                    <View style={styles.readyBadge}>
                      <Text style={styles.readyBadgeText}>
                        ✓ {t("newAccount.screenshotReady")}
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
                    <Text style={styles.uploadArrow}>↑</Text>
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

            <View style={styles.privacyRow}>
              <View style={styles.privacyIcon}>
                <Text style={styles.privacyIconText}>✓</Text>
              </View>
              <Text style={styles.privacyText}>
                {t("newAccount.screenshotPrivacy")}
              </Text>
            </View>

            <View style={styles.formHeader}>
              <Text style={styles.formTitle}>
                {t("newAccount.accountInformation")}
              </Text>
              <Text style={styles.formHint}>{t("newAccount.formHint")}</Text>
            </View>

            <View style={styles.formCard}>
              <FormField
                label={t("newAccount.accountName")}
                onChangeText={setAccountName}
                placeholder={t("newAccount.accountNameExample")}
                value={accountName}
              />

              <View style={styles.fieldDivider} />

              <FormField
                keyboardType="number-pad"
                label={t("newAccount.accountNumberLastFour")}
                maxLength={4}
                onChangeText={(value) =>
                  setAccountLastFourDigits(value.replace(/\D/g, ""))
                }
                placeholder="0000"
                prefix="••••"
                value={accountLastFourDigits}
              />

              <View style={styles.fieldDivider} />

              <FormField
                keyboardType="decimal-pad"
                label={t("newAccount.accountBalance")}
                onChangeText={setBalance}
                placeholder="0.00"
                value={balance}
              />

              <View style={styles.fieldDivider} />

              <View style={styles.field}>
                <Text style={styles.fieldLabel}>
                  {t("newAccount.currency")}
                </Text>
                <View style={styles.currencyRow}>
                  {supportedAssetCurrencies.map((item) => {
                    const isSelected = currency === item;

                    return (
                      <Pressable
                        key={item}
                        onPress={() => setCurrency(item)}
                        style={({ pressed }) => [
                          styles.currencyChip,
                          isSelected && styles.currencyChipSelected,
                          pressed && styles.pressed,
                        ]}
                      >
                        <Text
                          style={[
                            styles.currencyText,
                            isSelected && styles.currencyTextSelected,
                          ]}
                        >
                          {item}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            </View>
          </ScrollView>

          <View style={styles.bottomBar}>
            <Pressable
              accessibilityRole="button"
              disabled={!canSave}
              onPress={() => void saveAccount()}
              style={({ pressed }) => [
                styles.saveButton,
                !canSave && styles.saveButtonDisabled,
                pressed && styles.saveButtonPressed,
              ]}
            >
              <Text
                style={[
                  styles.saveButtonText,
                  !canSave && styles.saveButtonTextDisabled,
                ]}
              >
                {isSaving
                  ? t("newAccount.saving")
                  : t("newAccount.saveAccount")}
              </Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>

        <Modal
          animationType="fade"
          onRequestClose={() => {
            if (!sourceImageIsBeingDeleted) {
              finishSourceImageCleanup();
            }
          }}
          transparent
          visible={sourceImageCleanupIsVisible}
        >
          <View style={styles.cleanupOverlay}>
            <View style={styles.cleanupCard}>
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
                <View style={styles.cleanupActions}>
                  <Pressable
                    disabled={sourceImageIsBeingDeleted}
                    onPress={finishSourceImageCleanup}
                    style={({ pressed }) => [
                      styles.cleanupActionButton,
                      styles.cleanupSecondaryButton,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={styles.cleanupSecondaryButtonText}>
                      {t("newAccount.keepScreenshot")}
                    </Text>
                  </Pressable>
                  <Pressable
                    disabled={sourceImageIsBeingDeleted}
                    onPress={() => void deleteSelectedSourceImage()}
                    style={({ pressed }) => [
                      styles.cleanupActionButton,
                      styles.cleanupPrimaryButton,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={styles.cleanupPrimaryButtonText}>
                      {sourceImageIsBeingDeleted
                        ? t("newAccount.deletingScreenshot")
                        : t("newAccount.deleteScreenshot")}
                    </Text>
                  </Pressable>
                </View>
              ) : (
                <Pressable
                  onPress={finishSourceImageCleanup}
                  style={({ pressed }) => [
                    styles.cleanupPrimaryButton,
                    styles.cleanupSingleButton,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.cleanupPrimaryButtonText}>
                    {t("newAccount.acknowledge")}
                  </Text>
                </Pressable>
              )}
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: COLORS.background,
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  navigation: {
    alignItems: "center",
    flexDirection: "row",
    height: 52,
    justifyContent: "space-between",
    paddingHorizontal: 16,
  },
  navigationTitle: {
    color: COLORS.ink,
    fontSize: 16,
    fontWeight: "700",
  },
  navigationSpacer: {
    width: 40,
  },
  backButton: {
    alignItems: "center",
    backgroundColor: COLORS.card,
    borderColor: COLORS.border,
    borderRadius: 20,
    borderWidth: 1,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  backIcon: {
    color: COLORS.ink,
    fontSize: 31,
    fontWeight: "300",
    lineHeight: 33,
    marginLeft: -2,
    marginTop: -3,
  },
  pressed: {
    opacity: 0.72,
  },
  content: {
    paddingBottom: 24,
    paddingHorizontal: 20,
  },
  intro: {
    paddingBottom: 20,
    paddingTop: 12,
  },
  title: {
    color: COLORS.ink,
    fontSize: 28,
    fontWeight: "700",
    letterSpacing: -0.8,
  },
  subtitle: {
    color: COLORS.muted,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 8,
  },
  uploadCard: {
    backgroundColor: COLORS.card,
    borderColor: "#A9CDBF",
    borderRadius: 24,
    borderStyle: "dashed",
    borderWidth: 1.5,
    height: 218,
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
  },
  uploadIcon: {
    alignItems: "center",
    backgroundColor: COLORS.brandSoft,
    borderRadius: 22,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  uploadArrow: {
    color: COLORS.brand,
    fontSize: 23,
    fontWeight: "500",
    marginTop: -3,
  },
  uploadTitle: {
    color: COLORS.ink,
    fontSize: 16,
    fontWeight: "700",
    marginTop: 14,
  },
  uploadDescription: {
    color: COLORS.muted,
    fontSize: 12,
    marginTop: 6,
  },
  uploadAction: {
    backgroundColor: COLORS.brand,
    borderRadius: 15,
    marginTop: 16,
    paddingHorizontal: 18,
    paddingVertical: 9,
  },
  uploadActionText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },
  previewImage: {
    height: "100%",
    width: "100%",
  },
  previewScrim: {
    backgroundColor: "rgba(8, 28, 22, 0.46)",
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  previewContent: {
    alignItems: "center",
    bottom: 0,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  readyBadge: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  readyBadgeText: {
    color: COLORS.brand,
    fontSize: 12,
    fontWeight: "800",
  },
  changeImageText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "600",
    marginTop: 12,
  },
  privacyRow: {
    alignItems: "center",
    flexDirection: "row",
    marginTop: 12,
    paddingHorizontal: 4,
  },
  privacyIcon: {
    alignItems: "center",
    backgroundColor: COLORS.brandSoft,
    borderRadius: 8,
    height: 16,
    justifyContent: "center",
    width: 16,
  },
  privacyIconText: {
    color: COLORS.brand,
    fontSize: 9,
    fontWeight: "900",
  },
  privacyText: {
    color: COLORS.muted,
    flex: 1,
    fontSize: 11,
    lineHeight: 16,
    marginLeft: 7,
  },
  formHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 12,
    marginTop: 28,
    paddingHorizontal: 2,
  },
  formTitle: {
    color: COLORS.ink,
    fontSize: 17,
    fontWeight: "700",
  },
  formHint: {
    color: COLORS.muted,
    fontSize: 11,
  },
  formCard: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.cardBorder,
    borderRadius: 22,
    borderWidth: 1,
    paddingHorizontal: 16,
  },
  field: {
    paddingVertical: 15,
  },
  fieldLabel: {
    color: COLORS.muted,
    fontSize: 11,
    fontWeight: "600",
    marginBottom: 8,
  },
  inputShell: {
    alignItems: "center",
    flexDirection: "row",
  },
  inputPrefix: {
    color: COLORS.subtle,
    fontSize: 16,
    letterSpacing: 1.2,
    marginRight: 8,
  },
  input: {
    color: COLORS.ink,
    flex: 1,
    fontSize: 16,
    fontWeight: "600",
    minHeight: 24,
    padding: 0,
  },
  fieldDivider: {
    backgroundColor: COLORS.border,
    height: StyleSheet.hairlineWidth,
  },
  currencyRow: {
    flexDirection: "row",
    gap: 8,
  },
  currencyChip: {
    alignItems: "center",
    backgroundColor: COLORS.surfaceMuted,
    borderColor: "transparent",
    borderRadius: 13,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  currencyChipSelected: {
    backgroundColor: COLORS.brandSoft,
    borderColor: "#BBDCCF",
  },
  currencyText: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: "700",
  },
  currencyTextSelected: {
    color: COLORS.brand,
  },
  bottomBar: {
    backgroundColor: COLORS.background,
    borderTopColor: COLORS.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingBottom: Platform.OS === "ios" ? 8 : 14,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  saveButton: {
    alignItems: "center",
    backgroundColor: COLORS.brand,
    borderRadius: 18,
    minHeight: 54,
    justifyContent: "center",
    shadowColor: COLORS.brandShadow,
    shadowOffset: { width: 0, height: 7 },
    shadowOpacity: 0.16,
    shadowRadius: 12,
  },
  saveButtonDisabled: {
    backgroundColor: "#E1E6E2",
    shadowOpacity: 0,
  },
  saveButtonPressed: {
    opacity: 0.82,
    transform: [{ scale: 0.99 }],
  },
  saveButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800",
  },
  saveButtonTextDisabled: {
    color: "#A0ABA4",
  },
  cleanupOverlay: {
    alignItems: "center",
    backgroundColor: "rgba(8, 28, 22, 0.46)",
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  cleanupCard: {
    backgroundColor: COLORS.card,
    borderRadius: 24,
    maxWidth: 420,
    padding: 22,
    width: "100%",
  },
  cleanupTitle: {
    color: COLORS.ink,
    fontSize: 20,
    fontWeight: "800",
  },
  cleanupDescription: {
    color: COLORS.muted,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 10,
  },
  cleanupActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 24,
  },
  cleanupActionButton: {
    flex: 1,
  },
  cleanupSecondaryButton: {
    alignItems: "center",
    backgroundColor: COLORS.surfaceMuted,
    borderRadius: 16,
    justifyContent: "center",
    minHeight: 48,
  },
  cleanupSecondaryButtonText: {
    color: COLORS.ink,
    fontSize: 14,
    fontWeight: "700",
  },
  cleanupPrimaryButton: {
    alignItems: "center",
    backgroundColor: COLORS.brand,
    borderRadius: 16,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 18,
  },
  cleanupPrimaryButtonText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800",
  },
  cleanupSingleButton: {
    marginTop: 24,
  },
});
