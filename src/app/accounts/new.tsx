import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AccountEditorFields } from "@/components/AccountEditorFields";
import {
  AccountScreenshotUploader,
  type SelectedSourceImage,
} from "@/components/AccountScreenshotUploader";
import { Button } from "@/components/Button";
import { ButtonBase } from "@/components/ButtonBase";
import { KeyboardAvoidingView } from "@/components/KeyboardAvoidingView";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ScreenIntro } from "@/components/ScreenIntro";
import { SectionHeader } from "@/components/SectionHeader";
import { SourceImageCleanupModal } from "@/components/SourceImageCleanupModal";
import { SwipePager, type SwipePagerHandle } from "@/components/SwipePager";
import { useSourceImageCleanup } from "@/components/use-source-image-cleanup";
import { useSwipePagerHardwareBack } from "@/components/use-swipe-pager-hardware-back";
import { WizardNav } from "@/components/WizardNav";
import {
  type AccountDraft,
  applyRecognizedToDrafts,
  draftHasContent,
  draftToValidAccount,
  recognizedToDraft,
} from "@/features/assets/account-draft";
import {
  hasDuplicateAccountKeys,
  upsertAssetAccounts,
} from "@/features/assets/asset-repository";
import { defaultDisplayCurrencyForLanguageTag } from "@/features/assets/currencies";
import { type RecognizedAccount } from "@/features/assets/screenshot-recognition";
import { useAppLocale } from "@/i18n";
import { useReturnToOverview } from "@/navigation/useReturnToOverview";
import { COLORS } from "@/theme/colors";
import { MIN_INTERACTIVE_SIZE } from "@/theme/layout";
import { screenStyles } from "@/theme/screen-styles";
import { SPACING } from "@/theme/spacing";
import { FONT_SIZE, FONT_WEIGHT } from "@/theme/typography";

export default function NewAccountScreen() {
  const { t } = useTranslation();
  const { languageTag } = useAppLocale();
  const defaultCurrency = defaultDisplayCurrencyForLanguageTag(languageTag);
  const [selectedSourceImage, setSelectedSourceImage] =
    useState<SelectedSourceImage | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // One draft per account being added — the single blank form is the
  // one-draft case, so the plain form and the wizard share one state system
  // and one save rule. Recognizing a multi-account screenshot seeds one draft
  // per account and only the form area becomes a swipeable switcher: the
  // screen keeps its single vertical scroll (intro, screenshot, section
  // header, form), so both modes read as the same page and the uploader
  // scrolls away exactly like it does with one account. SwipePager gives
  // native finger-swipe paging (and falls back to animated transitions on
  // iOS < 17).
  const [drafts, setDrafts] = useState<AccountDraft[]>(() => [
    recognizedToDraft({}, defaultCurrency),
  ]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [session, setSession] = useState(0);
  const pagerRef = useRef<SwipePagerHandle>(null);

  const isMultiAccount = drafts.length >= 2;

  // Page height for the form pager. Inside a ScrollView the pager cannot size
  // itself — the scroll content box is content-driven, so `flex: 1` has
  // nothing to fill — and every page is absolutely positioned/flex-filled
  // within it. So each page measures its own natural height and the pager
  // takes the tallest (pages share a field structure; they differ only when a
  // validation hint wraps). Until the first measurement lands, the window
  // height stands in: seeding `0` would flatten the pages to zero height and
  // the measurement could never recover.
  const { height: windowHeight } = useWindowDimensions();
  const [pageHeights, setPageHeights] = useState<Record<number, number>>({});
  const pageHeight = Math.max(0, ...Object.values(pageHeights)) || windowHeight;

  const handlePageLayout = useCallback((index: number, height: number) => {
    setPageHeights((prev) =>
      prev[index] === height ? prev : { ...prev, [index]: height },
    );
  }, []);

  // Reseeds the drafts and moves the switcher to `nextIndex`. The pager is
  // uncontrolled (it reads `initialIndex` once), so `session` remounts it to
  // make the move land; the fields themselves are controlled and follow the new
  // drafts on their own. The measured page heights belong to the outgoing pages
  // (a reseed can change how many there are), so they reset with them and are
  // re-measured by the remounted pager.
  const reseedDrafts = (
    next: (prev: AccountDraft[]) => AccountDraft[],
    nextIndex = 0,
  ) => {
    setDrafts(next);
    setCurrentIndex(nextIndex);
    setSession((value) => value + 1);
    setPageHeights({});
  };

  // Applies whatever the model returned to the form and reports whether it
  // landed (the uploader's badge follows that). What lands is the shared draft
  // rule (`applyRecognizedToDrafts`); this screen only owns the switcher
  // bookkeeping that has to reset alongside it.
  //
  // A re-upload replaces the whole batch rather than merging into it — a new
  // screenshot can hold a different set of accounts, so there is no position to
  // merge along — which means it discards whatever the user has typed so far.
  // That is worth doing, but not worth doing silently, so anything with content
  // in it is confirmed first. Answering after the prompt is why this returns a
  // promise: the badge should say "Recognized" only if the user let it through.
  const handleRecognized = (
    accounts: RecognizedAccount[],
  ): Promise<boolean> => {
    if (accounts.length === 0) {
      return Promise.resolve(false);
    }
    // The fold reads `prev` inside the updater, not this render's `drafts`:
    // recognition resolves seconds after it started, and the fields the user
    // typed in the meantime live only in the latest state.
    const apply = () =>
      reseedDrafts((prev) =>
        applyRecognizedToDrafts(prev, accounts, defaultCurrency),
      );

    if (!drafts.some(draftHasContent)) {
      apply();
      return Promise.resolve(true);
    }

    return new Promise((resolve) => {
      Alert.alert(
        t("multiAccount.replaceDraftsTitle"),
        t("multiAccount.replaceDraftsMessage", { count: drafts.length }),
        [
          {
            style: "cancel",
            text: t("common.cancel"),
            onPress: () => resolve(false),
          },
          {
            style: "destructive",
            text: t("multiAccount.replaceDraftsConfirm"),
            onPress: () => {
              apply();
              resolve(true);
            },
          },
        ],
      );
    });
  };

  // Drops one recognized account from the batch. Without this a screenshot that
  // yields a draft the user doesn't want — a duplicate business key, or a row
  // the model misread badly enough to be unsaveable — has no exit: the save
  // gate below blocks on it, and the only alternative is leaving the screen and
  // losing everything else typed. Reseeds because the page count is changing,
  // and lands on the page that took the removed one's place.
  const removeDraft = (index: number) => {
    reseedDrafts(
      (prev) => prev.filter((_, position) => position !== index),
      Math.max(0, Math.min(index, drafts.length - 2)),
    );
  };

  const returnToAssetOverview = useReturnToOverview();
  const { finishSave, cleanupProps } = useSourceImageCleanup(
    selectedSourceImage,
    returnToAssetOverview,
  );

  // Index-keyed draft sync: every page is mounted simultaneously under the
  // native pager, so onChange carries the page index it applies to rather
  // than relying on the currently visible page. Untouched drafts keep their
  // identity, so only the edited page re-renders.
  const handleDraftChange = useCallback(
    (update: (previous: AccountDraft) => AccountDraft, index: number) => {
      setDrafts((prev) =>
        prev.map((item, idx) => (idx === index ? update(item) : item)),
      );
    },
    [],
  );

  // No clamps needed: WizardNav renders the next chevron only before the last
  // page and the back chevron only past the first.
  const handleNext = () => pagerRef.current?.goTo(currentIndex + 1);
  const handleBack = () => pagerRef.current?.goTo(currentIndex - 1);

  // Derived once and shared by the save button's disabled state and both save
  // paths so `draftToValidAccount` runs once per draft change, not again at
  // save. In single-account mode this is the one draft's validity.
  const validAccounts = useMemo(
    () => drafts.map(draftToValidAccount).filter((account) => account !== null),
    [drafts],
  );
  // Saving writes `validAccounts`, so a draft that isn't saveable would simply
  // not be written — silently, with the section header still claiming the model
  // recognized it. Block instead and say how many are incomplete: the user
  // either completes them or removes them, and nothing on screen disappears
  // without being asked for. In single-account mode this is exactly the old
  // "the one draft must be valid" gate.
  const incompleteDraftCount = drafts.length - validAccounts.length;
  // Two drafts sharing a business key (same name + same/empty last four)
  // would silently merge in applyAccountUpsert — for a shared currency the
  // second balance overwrites the first. Blocked via disabled-save + inline
  // hint, so the reason stays visible next to the drafts instead of behind a
  // dismissed alert. Vacuously false below two drafts, so it needs no
  // multi-account guard.
  const hasDuplicateDrafts = hasDuplicateAccountKeys(validAccounts);
  const canSave =
    validAccounts.length > 0 &&
    incompleteDraftCount === 0 &&
    !hasDuplicateDrafts &&
    !isSaving;

  // Android hardware back: step back within the switcher before letting the
  // router pop the screen — matching the visible back chevron. At the first
  // account (and outside multi-account mode) the default back-to-overview
  // applies.
  useSwipePagerHardwareBack({
    pagerRef,
    index: currentIndex,
    busy: isSaving,
    enabled: isMultiAccount,
  });

  const count = drafts.length;
  const isLast = currentIndex === count - 1;

  // One save path for both modes: saving the single form is the one-draft
  // case of the batch upsert (same serializer, same merge rule, one write).
  // `canSave` already blocks duplicate-key drafts (surfaced by the inline
  // hint above the button); alert copy follows the mode like `saveLabel`
  // below.
  const save = async () => {
    setIsSaving(true);
    // The try wraps only the fallible write, and the outcome flows on as a
    // flag: React Compiler bails out of an entire component that contains a
    // `finally` clause, which would leave this screen with no memoization at
    // all. Same reason the branches below sit outside the try.
    let failed = false;
    try {
      await upsertAssetAccounts(validAccounts);
    } catch {
      failed = true;
    }
    setIsSaving(false);

    if (failed) {
      Alert.alert(
        t("newAccount.saveErrorTitle"),
        t(
          isMultiAccount
            ? "multiAccount.saveErrorMessage"
            : "newAccount.saveErrorMessage",
        ),
      );
      return;
    }
    finishSave();
  };

  const saveLabel = isSaving
    ? t("newAccount.saving")
    : t(isMultiAccount ? "multiAccount.saveAll" : "newAccount.saveAccount");

  return (
    <SafeAreaView style={screenStyles.safeArea}>
      <KeyboardAvoidingView style={screenStyles.flex}>
        <ScreenHeader title={t("newAccount.screenTitle")} />

        {/* One scroll for both modes — the screenshot, the section header
              and the form all move together, and multi-account only swaps the
              form block for a pager over the same fields. */}
        <ScrollView
          contentContainerStyle={screenStyles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <ScreenIntro
            title={t("newAccount.introTitle")}
            subtitle={t("newAccount.introDescription")}
          />

          <AccountScreenshotUploader
            sourceImage={selectedSourceImage}
            onSourceImageChange={setSelectedSourceImage}
            onRecognized={handleRecognized}
          />

          <SectionHeader
            stacked
            title={
              isMultiAccount
                ? t("multiAccount.title", { count })
                : t("newAccount.accountInformation")
            }
            detail={
              <Text style={screenStyles.formHint}>
                {isMultiAccount
                  ? t("multiAccount.accountPosition", {
                      current: currentIndex + 1,
                      total: count,
                    })
                  : t("newAccount.formHint")}
              </Text>
            }
          />

          {isMultiAccount ? (
            <SwipePager
              key={session}
              ref={pagerRef}
              count={count}
              initialIndex={currentIndex}
              onIndexChange={setCurrentIndex}
              scrollEnabled={!isSaving}
              style={[styles.pager, { height: pageHeight }]}
              renderPage={(pageIndex) => (
                // Plain (non-filling) wrapper: it reports the fields' own
                // height, which is what sizes the pager, and carries the
                // screen inset the full-bleed pager gave up.
                <View
                  style={styles.page}
                  onLayout={(event) =>
                    handlePageLayout(pageIndex, event.nativeEvent.layout.height)
                  }
                >
                  <AccountEditorFields
                    draft={drafts[pageIndex]}
                    index={pageIndex}
                    onChange={handleDraftChange}
                  />
                  {/* Per-page escape hatch. Lives inside the page, next to the
                      account it removes, so which account it applies to is
                      never in doubt — WizardNav is shared and only knows the
                      position. No confirmation: the action names its target
                      and nothing has been saved yet. */}
                  <ButtonBase
                    accessibilityLabel={t("multiAccount.removeAccount")}
                    disabled={isSaving}
                    onPress={() => removeDraft(pageIndex)}
                    baseStyle={styles.removeDraftButton}
                    pressedStyle={screenStyles.pressed}
                  >
                    <Text style={styles.removeDraftText}>
                      {t("multiAccount.removeAccount")}
                    </Text>
                  </ButtonBase>
                </View>
              )}
            />
          ) : (
            <AccountEditorFields
              draft={drafts[0]}
              index={0}
              onChange={handleDraftChange}
            />
          )}
        </ScrollView>

        {isMultiAccount ? (
          <WizardNav
            count={count}
            current={currentIndex}
            backLabel={t("multiAccount.previous")}
            nextLabel={t("multiAccount.next")}
            onBack={handleBack}
            onNext={handleNext}
            backDisabled={isSaving}
            nextDisabled={isSaving}
            nextHidden={isLast}
          />
        ) : null}

        <View style={screenStyles.bottomBar}>
          {isMultiAccount && incompleteDraftCount > 0 ? (
            <Text
              accessibilityLiveRegion="polite"
              style={[screenStyles.errorHint, styles.saveBlockedHint]}
            >
              {t("multiAccount.incompleteAccounts", {
                count: incompleteDraftCount,
              })}
            </Text>
          ) : null}
          {hasDuplicateDrafts ? (
            <Text
              accessibilityLiveRegion="polite"
              style={[screenStyles.errorHint, styles.saveBlockedHint]}
            >
              {t("multiAccount.duplicateAccounts")}
            </Text>
          ) : null}
          <Button
            size="lg"
            variant="primary"
            elevated
            disabled={!canSave}
            onPress={() => void save()}
          >
            {saveLabel}
          </Button>
        </View>
      </KeyboardAvoidingView>

      <SourceImageCleanupModal {...cleanupProps} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  saveBlockedHint: {
    marginBottom: SPACING.sm,
    textAlign: "center",
  },
  // Quiet, full-width destructive action closing out a wizard page — it must
  // read as an exit from this one account, not as competition for the primary
  // save button in the bar below.
  removeDraftButton: {
    alignItems: "center",
    justifyContent: "center",
    marginTop: SPACING.md,
    minHeight: MIN_INTERACTIVE_SIZE,
  },
  removeDraftText: {
    color: COLORS.danger,
    fontSize: FONT_SIZE.bodySm,
    fontWeight: FONT_WEIGHT.semibold,
  },
  // Full-bleed pager: it cancels the scroll content's horizontal padding so a
  // page can travel edge to edge instead of being clipped at the padding
  // line, and each page re-applies that inset itself. The two insets meeting
  // mid-swipe are what separate one account's form from the next — pages abut
  // exactly, so without them the forms would slide past as one continuous
  // strip.
  pager: {
    marginHorizontal: -SPACING.xl,
  },
  page: {
    paddingHorizontal: SPACING.xl,
  },
});
