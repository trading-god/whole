import Head from "expo-router/head";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  AccountScreenshotUploader,
  type SelectedSourceImage,
} from "@/components/AccountScreenshotUploader";
import { BalanceRowsField } from "@/components/BalanceRowsField";
import { Button } from "@/components/Button";
import { ChoiceChipGroup } from "@/components/ChoiceChipGroup";
import { FieldShell } from "@/components/FieldShell";
import { FormField } from "@/components/FormField";
import { KeyboardAvoidingView } from "@/components/KeyboardAvoidingView";
import { ScreenHeader } from "@/components/ScreenHeader";
import { SectionHeader } from "@/components/SectionHeader";
import { SourceImageCleanupModal } from "@/components/SourceImageCleanupModal";
import {
  type AssetKind,
  assetKindPickerOptions,
} from "@/features/assets/account-appearance";
import {
  lastFourDigitsSchema,
  upsertAssetAccount,
} from "@/features/assets/asset-repository";
import { defaultDisplayCurrencyForLanguageTag } from "@/features/assets/currencies";
import { type RecognizedAccount } from "@/features/assets/screenshot-recognition";
import {
  createBalanceRow,
  useBalanceRows,
} from "@/features/assets/use-balance-rows";
import { useAppLocale } from "@/i18n";
import { useReturnToOverview } from "@/navigation/useReturnToOverview";
import { screenStyles } from "@/theme/screen-styles";

export default function NewAccountScreen() {
  const { t } = useTranslation();
  const { languageTag } = useAppLocale();
  const [selectedSourceImage, setSelectedSourceImage] =
    useState<SelectedSourceImage | null>(null);
  const [accountName, setAccountName] = useState("");
  const [accountLastFourDigits, setAccountLastFourDigits] = useState("");
  const {
    balanceRows,
    addBalanceRow,
    updateBalanceRow,
    removeBalanceRow,
    setBalanceRowsFromAccount,
    validBalanceRows,
    hasDuplicateCurrency,
  } = useBalanceRows([
    createBalanceRow(defaultDisplayCurrencyForLanguageTag(languageTag)),
  ]);
  const [kind, setKind] = useState<AssetKind>("cash");
  const [isSaving, setIsSaving] = useState(false);
  const [cleanupVisible, setCleanupVisible] = useState(false);

  const accountKindOptions = useMemo(() => assetKindPickerOptions(t), [t]);

  // Applies whatever the model returned to the form. Each field is applied
  // conditionally so a model that only returned some fields leaves the rest
  // untouched for the user to fill in.
  const handleRecognized = (recognized: RecognizedAccount) => {
    if (recognized.accountName) {
      setAccountName(recognized.accountName);
    }
    if (recognized.accountLastFourDigits) {
      setAccountLastFourDigits(recognized.accountLastFourDigits);
    }
    if (recognized.balances && recognized.balances.length > 0) {
      setBalanceRowsFromAccount(recognized.balances);
    }
    if (recognized.kind) {
      setKind(recognized.kind);
    }
  };

  const canSave =
    accountName.trim().length > 0 &&
    lastFourDigitsSchema.safeParse(accountLastFourDigits).success &&
    validBalanceRows.length >= 1 &&
    !hasDuplicateCurrency &&
    !isSaving;

  const returnToAssetOverview = useReturnToOverview();

  const handleCleanupFinished = () => {
    setCleanupVisible(false);
    returnToAssetOverview();
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
      await upsertAssetAccount({
        name: accountName.trim(),
        accountLastFourDigits,
        balances: validBalanceRows,
        kind,
      });

      if (selectedSourceImage) {
        setCleanupVisible(true);
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
      <SafeAreaView style={screenStyles.safeArea}>
        <KeyboardAvoidingView style={screenStyles.flex}>
          <ScreenHeader title={t("newAccount.screenTitle")} />

          <ScrollView
            contentContainerStyle={screenStyles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={screenStyles.intro}>
              <Text style={screenStyles.title}>
                {t("newAccount.introTitle")}
              </Text>
              <Text style={screenStyles.subtitle}>
                {t("newAccount.introDescription")}
              </Text>
            </View>

            <AccountScreenshotUploader
              sourceImage={selectedSourceImage}
              onSourceImageChange={setSelectedSourceImage}
              onRecognized={handleRecognized}
            />

            <View style={screenStyles.formHeader}>
              <SectionHeader
                stacked
                title={t("newAccount.accountInformation")}
                detail={
                  <Text style={screenStyles.formHint}>
                    {t("newAccount.formHint")}
                  </Text>
                }
              />
            </View>

            <View style={screenStyles.formCard}>
              <FormField
                label={t("newAccount.accountName")}
                onChangeText={setAccountName}
                placeholder={t("newAccount.accountNameExample")}
                value={accountName}
              />

              <View style={screenStyles.fieldDivider} />

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

              <View style={screenStyles.fieldDivider} />

              <BalanceRowsField
                balanceRows={balanceRows}
                labels={{
                  accountBalance: t("newAccount.accountBalance"),
                  currency: t("newAccount.currency"),
                  removeCurrencyRow: t("newAccount.removeCurrencyRow"),
                  addCurrency: t("newAccount.addCurrency"),
                  allCurrenciesAdded: t("newAccount.allCurrenciesAdded"),
                }}
                onAdd={addBalanceRow}
                onUpdate={updateBalanceRow}
                onRemove={removeBalanceRow}
              />

              <FieldShell label={t("newAccount.accountKind")}>
                <ChoiceChipGroup
                  options={accountKindOptions}
                  value={kind}
                  onChange={setKind}
                />
              </FieldShell>
            </View>
          </ScrollView>

          <View style={screenStyles.bottomBar}>
            <Button
              size="lg"
              variant="primary"
              elevated
              disabled={!canSave}
              onPress={() => void saveAccount()}
            >
              {isSaving ? t("newAccount.saving") : t("newAccount.saveAccount")}
            </Button>
          </View>
        </KeyboardAvoidingView>

        <SourceImageCleanupModal
          visible={cleanupVisible}
          sourceImage={selectedSourceImage}
          onFinished={handleCleanupFinished}
        />
      </SafeAreaView>
    </>
  );
}
