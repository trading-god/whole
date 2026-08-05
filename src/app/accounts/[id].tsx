import { useLocalSearchParams } from "expo-router";
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

import { AccountEditorFields } from "@/components/AccountEditorFields";
import {
  AccountScreenshotUploader,
  type SelectedSourceImage,
} from "@/components/AccountScreenshotUploader";
import { Button } from "@/components/Button";
import { KeyboardAvoidingView } from "@/components/KeyboardAvoidingView";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ScreenIntro } from "@/components/ScreenIntro";
import { SectionHeader } from "@/components/SectionHeader";
import { SourceImageCleanupModal } from "@/components/SourceImageCleanupModal";
import { useSourceImageCleanup } from "@/components/use-source-image-cleanup";
import {
  type AccountDraft,
  accountToDraft,
  draftToValidAccount,
  mergeRecognizedIntoDraft,
  selectRecognizedForAccount,
} from "@/features/assets/account-draft";
import {
  type AssetAccount,
  listAssetAccounts,
  updateAssetAccount,
  type UpdateAssetAccountResult,
} from "@/features/assets/asset-repository";
import { type RecognizedAccount } from "@/features/assets/screenshot-recognition";
import { useReturnToOverview } from "@/navigation/useReturnToOverview";
import { COLORS } from "@/theme/colors";
import { screenStyles } from "@/theme/screen-styles";

export default function AccountDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const returnToOverview = useReturnToOverview();

  // `account` doubles as the load gate: it is set exactly once, in the same
  // batch as the draft below, and never cleared — so "still loading" is simply
  // "no account yet", with no second state to keep in lockstep.
  const [account, setAccount] = useState<AssetAccount | null>(null);
  // The same draft shape the add-account screen edits, so both screens share
  // one field set (AccountEditorFields), one account → draft mapping
  // (accountToDraft), and one save rule (draftToValidAccount). The placeholder
  // below is never rendered — the form waits on `account`, which is set in the
  // same batch as the real draft.
  const [draft, setDraft] = useState<AccountDraft>(() => ({
    name: "",
    lastFour: "",
    balances: [],
    kind: "cash",
  }));
  const [isSaving, setIsSaving] = useState(false);
  const [selectedSourceImage, setSelectedSourceImage] =
    useState<SelectedSourceImage | null>(null);
  const { finishSave, cleanupProps } = useSourceImageCleanup(
    selectedSourceImage,
    returnToOverview,
  );

  // Load the account once on mount. Reads the cached account list directly
  // (no rates fetch, no snapshot record) — the home screen's focus effect
  // handles snapshot recording when the user navigates back, so the detail
  // screen stays a plain read. If the account is gone (deleted elsewhere),
  // bail to the overview instead of rendering an empty form.
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const accounts = await listAssetAccounts();
        if (!active) {
          return;
        }
        const found = accounts.find((a) => a.id === id);
        if (!found) {
          returnToOverview();
          return;
        }
        setAccount(found);
        setDraft(accountToDraft(found));
      } catch {
        // Corrupt or unreadable account store — `listAssetAccounts` threw
        // (JSON.parse or the schema cascade in parseStoredAssetAccounts). The
        // detail screen has no error surface of its own, just a loading
        // spinner, so bail to the overview — whose own load surfaces the
        // failure — instead of spinning forever on a screen that can never
        // populate. `if/else` rather than a ternary so React Compiler keeps
        // memoizing this component (a conditional expression inside a
        // try/catch would bail it out).
        if (active) {
          returnToOverview();
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [id, returnToOverview]);

  // Applies the recognized fields through the shared merge (only fields the
  // model returned overwrite the draft), then pins the last four back — those
  // are the account's immutable identity. So uploading a fresh screenshot of
  // the same account updates its name/balances/kind, while a different
  // account's screenshot still can't hijack this account's last four. Returns
  // whether anything was applied (the uploader's badge follows that).
  const handleRecognized = (accounts: RecognizedAccount[]): boolean => {
    const recognized = selectRecognizedForAccount(
      accounts,
      account?.accountLastFourDigits,
    );
    if (!recognized) {
      return false;
    }
    setDraft((prev) => ({
      ...mergeRecognizedIntoDraft(prev, recognized),
      lastFour: prev.lastFour,
    }));
    return true;
  };

  // The saveable form of the current draft via the shared
  // `draftToValidAccount` rule — the same one gating the add form and wizard
  // batch save — so the edit screen can't drift from "what is a saveable
  // account". The last four is locked once the account has one, so the
  // empty-or-4-digits clause only gates the fill-in path here.
  const valid = useMemo(() => draftToValidAccount(draft), [draft]);
  const canSave = valid !== null && !isSaving && account !== null;
  // Fill-once identity: the last four is editable only while the account
  // still lacks one.
  const lastFourLocked = Boolean(account?.accountLastFourDigits);

  const saveAccount = async () => {
    // Mirrors `canSave` (which already disables the button) so the narrowing
    // holds for TypeScript — an unsaveable draft can't reach here.
    if (!valid || !account) {
      return;
    }

    setIsSaving(true);
    // The try wraps only the fallible write; a throw becomes a null result and
    // every branch runs after it. React Compiler bails out of an entire
    // component that contains a `finally` clause, which would leave this
    // screen with no memoization at all.
    let result: UpdateAssetAccountResult | null = null;
    try {
      result = await updateAssetAccount(account.id, {
        name: valid.name,
        // Fill-once at the repository: an existing last four always wins
        // there, so sending the (locked) current value is a no-op and only a
        // previously-empty last four actually lands.
        accountLastFourDigits: valid.accountLastFourDigits,
        balances: valid.balances,
        kind: draft.kind,
      });
    } catch {
      result = null;
    }
    setIsSaving(false);

    if (!result) {
      Alert.alert(
        t("accountDetail.saveErrorTitle"),
        t("accountDetail.saveErrorMessage"),
      );
      return;
    }
    if (result.ok) {
      finishSave();
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
  };

  return (
    <SafeAreaView style={screenStyles.safeArea}>
      <KeyboardAvoidingView style={screenStyles.flex}>
        <ScreenHeader title={t("accountDetail.screenTitle")} />

        {account === null ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator color={COLORS.brand} size="small" />
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={screenStyles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <ScreenIntro
              title={t("accountDetail.introTitle")}
              subtitle={t("accountDetail.introDescription")}
            />

            <AccountScreenshotUploader
              sourceImage={selectedSourceImage}
              onSourceImageChange={setSelectedSourceImage}
              onRecognized={handleRecognized}
            />

            <SectionHeader
              stacked
              title={t("accountDetail.accountInformation")}
              detail={
                <Text style={screenStyles.formHint}>
                  {t("accountDetail.formHint")}
                </Text>
              }
            />

            <AccountEditorFields
              draft={draft}
              index={0}
              onChange={setDraft}
              lastFourEditable={!lastFourLocked}
              lastFourHint={
                lastFourLocked
                  ? t("accountDetail.lastFourDigitsLocked")
                  : t("accountDetail.lastFourDigitsOptional")
              }
            />
          </ScrollView>
        )}

        <View style={screenStyles.bottomBar}>
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

      <SourceImageCleanupModal {...cleanupProps} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
});
