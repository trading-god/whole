import { useLocalSearchParams } from "expo-router";
import Head from "expo-router/head";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
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
  type AssetAccount,
  listAssetAccounts,
  updateAssetAccount,
} from "@/features/assets/asset-repository";
import { type RecognizedAccount } from "@/features/assets/screenshot-recognition";
import { useBalanceRows } from "@/features/assets/use-balance-rows";
import { useReturnToOverview } from "@/navigation/useReturnToOverview";
import { COLORS } from "@/theme/colors";
import { screenStyles } from "@/theme/screen-styles";
import { SPACING } from "@/theme/spacing";
import { FONT_SIZE, LINE_HEIGHT } from "@/theme/typography";

export default function AccountDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const returnToOverview = useReturnToOverview();

  const [account, setAccount] = useState<AssetAccount | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready">("loading");
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
  } = useBalanceRows([]);
  const [kind, setKind] = useState<AssetKind>("cash");
  const [isSaving, setIsSaving] = useState(false);
  const [selectedSourceImage, setSelectedSourceImage] =
    useState<SelectedSourceImage | null>(null);
  const [cleanupVisible, setCleanupVisible] = useState(false);

  const accountKindOptions = useMemo(() => assetKindPickerOptions(t), [t]);

  // Load the account once on mount. Reads the cached account list directly
  // (no rates fetch, no snapshot record) — the home screen's focus effect
  // handles snapshot recording when the user navigates back, so the detail
  // screen stays a plain read. If the account is gone (deleted elsewhere),
  // bail to the overview instead of rendering an empty form.
  useEffect(() => {
    let active = true;
    void (async () => {
      const accounts = await listAssetAccounts();
      if (!active) {
        return;
      }
      const found = accounts.find((a) => a.id === id) ?? null;
      if (!found) {
        returnToOverview();
        return;
      }
      setAccount(found);
      setAccountName(found.name);
      setAccountLastFourDigits(found.accountLastFourDigits);
      setBalanceRowsFromAccount(found.balances);
      setKind(found.kind);
      setLoadState("ready");
    })();
    return () => {
      active = false;
    };
  }, [id, returnToOverview, setBalanceRowsFromAccount]);

  // Applies the recognized fields to the form, but NOT the last four digits —
  // those are the account's immutable identity and stay as loaded. So uploading
  // a fresh screenshot of the same account updates its name/balances/kind,
  // while uploading a different account's screenshot still can't hijack this
  // account's last four. Each field is applied conditionally so a partial
  // recognition leaves the rest untouched.
  const handleRecognized = (recognized: RecognizedAccount) => {
    if (recognized.accountName) {
      setAccountName(recognized.accountName);
    }
    if (recognized.balances && recognized.balances.length > 0) {
      setBalanceRowsFromAccount(recognized.balances);
    }
    if (recognized.kind) {
      setKind(recognized.kind);
    }
  };

  // lastFour is already valid (it came from a saved account), so it isn't
  // re-validated here — unlike the new-account form.
  const canSave =
    accountName.trim().length > 0 &&
    validBalanceRows.length >= 1 &&
    !hasDuplicateCurrency &&
    !isSaving &&
    account !== null;

  const handleCleanupFinished = () => {
    setCleanupVisible(false);
    returnToOverview();
  };

  const saveAccount = async () => {
    if (!canSave || !account) {
      Alert.alert(
        t("accountDetail.validationTitle"),
        t("accountDetail.validationMessage"),
      );
      return;
    }

    setIsSaving(true);

    try {
      const result = await updateAssetAccount(account.id, {
        name: accountName.trim(),
        balances: validBalanceRows,
        kind,
      });
      if (result.ok) {
        if (selectedSourceImage) {
          setCleanupVisible(true);
        } else {
          returnToOverview();
        }
        return;
      }
      if (result.error.kind === "notFound") {
        // Account was deleted elsewhere — bail to the overview.
        returnToOverview();
        return;
      }
      Alert.alert(
        t("accountDetail.conflictTitle"),
        t("accountDetail.conflictMessage", {
          name: result.error.conflictingAccountName,
        }),
      );
    } catch {
      Alert.alert(
        t("accountDetail.saveErrorTitle"),
        t("accountDetail.saveErrorMessage"),
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <Head>
        <title>{t("metadata.accountDetailTitle")}</title>
        <meta
          name="description"
          content={t("metadata.accountDetailDescription")}
        />
        <meta name="robots" content="noindex,nofollow" />
      </Head>
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView style={styles.flex}>
          <ScreenHeader title={t("accountDetail.screenTitle")} />

          {loadState === "loading" ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator color={COLORS.brand} size="small" />
            </View>
          ) : (
            <ScrollView
              contentContainerStyle={styles.content}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.intro}>
                <Text style={styles.title}>
                  {t("accountDetail.introTitle")}
                </Text>
                <Text style={styles.subtitle}>
                  {t("accountDetail.introDescription")}
                </Text>
              </View>

              <AccountScreenshotUploader
                sourceImage={selectedSourceImage}
                onSourceImageChange={setSelectedSourceImage}
                onRecognized={handleRecognized}
              />

              <View style={styles.formHeader}>
                <SectionHeader
                  stacked
                  title={t("accountDetail.accountInformation")}
                  detail={
                    <Text style={styles.formHint}>
                      {t("accountDetail.formHint")}
                    </Text>
                  }
                />
              </View>

              <View style={styles.formCard}>
                <FormField
                  label={t("accountDetail.accountName")}
                  onChangeText={setAccountName}
                  placeholder={t("accountDetail.accountNameExample")}
                  value={accountName}
                />

                <View style={styles.fieldDivider} />

                <FormField
                  editable={false}
                  label={t("accountDetail.lastFourDigits")}
                  onChangeText={() => {}}
                  placeholder="0000"
                  prefix="••••"
                  value={accountLastFourDigits}
                />
                <Text style={styles.lastFourLockedHint}>
                  {t("accountDetail.lastFourDigitsLocked")}
                </Text>

                <View style={styles.fieldDivider} />

                <BalanceRowsField
                  balanceRows={balanceRows}
                  labels={{
                    accountBalance: t("accountDetail.accountBalance"),
                    currency: t("accountDetail.currency"),
                    removeCurrencyRow: t("accountDetail.removeCurrencyRow"),
                    addCurrency: t("accountDetail.addCurrency"),
                    allCurrenciesAdded: t("accountDetail.allCurrenciesAdded"),
                  }}
                  onAdd={addBalanceRow}
                  onUpdate={updateBalanceRow}
                  onRemove={removeBalanceRow}
                />

                <FieldShell label={t("accountDetail.accountKind")}>
                  <ChoiceChipGroup
                    options={accountKindOptions}
                    value={kind}
                    onChange={setKind}
                  />
                </FieldShell>
              </View>
            </ScrollView>
          )}

          <View style={styles.bottomBar}>
            <Button
              size="lg"
              variant="primary"
              elevated
              disabled={!canSave}
              onPress={() => void saveAccount()}
            >
              {isSaving
                ? t("accountDetail.saving")
                : t("accountDetail.saveAccount")}
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

const styles = StyleSheet.create({
  ...screenStyles,
  loadingContainer: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
  lastFourLockedHint: {
    color: COLORS.subtle,
    fontSize: FONT_SIZE.micro,
    lineHeight: LINE_HEIGHT.body,
    marginTop: SPACING.sm,
  },
});
