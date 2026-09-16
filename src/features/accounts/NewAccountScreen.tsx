import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

import { AccountEditorFields } from "@/features/accounts/AccountEditorFields";
import {
  AccountScreenshotUploader,
  type ScreenshotOutcome,
  type SelectedSourceImage,
} from "@/features/accounts/AccountScreenshotUploader";
import { Button } from "@/components/Button";
import { ButtonBase } from "@/components/ButtonBase";
import { FormField } from "@/components/FormField";
import { KeyboardAvoidingView } from "@/components/KeyboardAvoidingView";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ScreenIntro } from "@/components/ScreenIntro";
import { SectionHeader } from "@/components/SectionHeader";
import { SourceImageCleanupModal } from "@/features/accounts/SourceImageCleanupModal";
import {
  SwipePager,
  type SwipePagerHandle,
} from "@/features/accounts/SwipePager";
import { useSourceImageCleanup } from "@/features/accounts/use-source-image-cleanup";
import { useSwipePagerHardwareBack } from "@/features/accounts/use-swipe-pager-hardware-back";
import { WizardNav } from "@/features/accounts/WizardNav";
import {
  type AccountDraft,
  type RecognizedScreenshot,
  applyRecognizedToDrafts,
  draftHasContent,
  draftToValidAccount,
  isWorthDrafting,
  recognizedToDraft,
} from "@/features/accounts/account-draft";
import { invalidateAccounts } from "@/features/assets/accounts-query";
import {
  type AssetAccountGroup,
  findOrCreateGroupByName,
  hasDuplicateAccountKeys,
  listAssetAccountGroups,
  upsertAssetAccounts,
} from "@/features/assets/asset-repository";
import { type InstitutionId } from "@whole/ocr";
import { defaultDisplayCurrencyForLanguageTag } from "@/features/assets/currencies";
import { useAppLocale } from "@/i18n";
import { useReturnToOverview } from "@/lib/useReturnToOverview";
import { COLORS } from "@/theme/colors";
import { MIN_INTERACTIVE_SIZE } from "@/theme/layout";
import { screenStyles } from "@/theme/screen-styles";
import { SPACING } from "@/theme/spacing";
import { FONT_SIZE, FONT_WEIGHT } from "@/theme/typography";

// A detected InstitutionId's localized display-name i18n key, so the wizard can
// offer a suggested group name ("OCBC", "DBS", …) without coupling the pure OCR
// modules to display strings.
//
// The template literal type expands to the exact union of the 14 keys, so the
// strictly-typed `t` still rejects an institution the message catalogs don't
// name — which is the completeness check a hand-written key map was there for.
function institutionNameKey(institutionId: InstitutionId) {
  return `institutionNames.${institutionId}` as const;
}

// Whether every screenshot in a batch named the same institution.
//
// A batch of screenshots is a batch of institutions, so the institution lives
// on each draft (see `AccountDraft.institutionName`). But the common case — one
// screenshot, or several from one bank — is still one answer, and asking it
// once above the wizard is how that case reads. Disagreement is what demotes it
// to a per-page field, and it is decided from the SCREENSHOTS rather than from
// the drafts the user is editing: the drafts change under the keyboard, and a
// layout that changes with them tears the focused field out mid-word.
//
// An empty string counts as an answer. "The recognizer could not name this
// institution" is a shared state too, and a batch of unplaceable screenshots
// should still offer one field to name them all.
function screenshotsAgreeOnInstitution(
  screenshots: readonly RecognizedScreenshot[],
): boolean {
  return new Set(screenshots.map((shot) => shot.institutionName)).size <= 1;
}

export default function NewAccountScreen() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { languageTag } = useAppLocale();
  const defaultCurrency = defaultDisplayCurrencyForLanguageTag(languageTag);
  const [selectedSourceImages, setSelectedSourceImages] = useState<
    SelectedSourceImage[]
  >([]);
  const [isSaving, setIsSaving] = useState(false);
  // Recognition in flight: the section header says so in place of its hint.
  const [isRecognizing, setIsRecognizing] = useState(false);

  // The institutions already on file, for the picker a hand-entered account
  // chooses from. Until this screen had one, an account added by hand could
  // only be filed under an institution by going back in through the edit
  // screen — the one place the picker existed.
  const [institutions, setInstitutions] = useState<AssetAccountGroup[]>([]);
  const [selectedInstitutionId, setSelectedInstitutionId] = useState("");
  useEffect(() => {
    let active = true;
    void listAssetAccountGroups()
      .then((groups) => {
        if (active) {
          setInstitutions(groups);
        }
      })
      // An unreadable group list leaves the picker empty; the account still
      // saves, ungrouped, which is what it did before the picker existed.
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  const handleCreateInstitution = useCallback(
    async (name: string): Promise<string | undefined> => {
      const group = await findOrCreateGroupByName(name);
      // The create has committed by the time the re-read below runs, so a
      // failed re-read must not read as a failed create: fall back to
      // appending the group so it stays selectable, and let the next full
      // load restore the canonical list.
      try {
        setInstitutions(await listAssetAccountGroups());
      } catch {
        setInstitutions((current) =>
          current.some((existing) => existing.id === group.id)
            ? current
            : [...current, group],
        );
      }
      return group.id;
    },
    [],
  );

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
  // Whether the drafts on screen came from a screenshot.
  //
  // It decides which institution CONTROL is shown, not what is saved: a
  // recognized account names its institution in a free-text field pre-filled
  // from the screenshot (which the user corrects — recognition is not
  // guaranteed), while a hand-entered one picks from the institutions already
  // on file. Both end up as a group at save time; only the question differs.
  const [isFromRecognition, setIsFromRecognition] = useState(false);
  // Whether the batch agreed on one institution — see the latch in
  // `handleRecognized`. It decides where the field LIVES; the drafts still hold
  // what it says.
  const [institutionIsShared, setInstitutionIsShared] = useState(true);
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
  //
  // What to call the institution one screenshot came from, in the order the
  // answers are worth trusting: the engine's own detection, which is an enum the
  // message catalogs name in the user's language; then the free text the MODEL
  // answered, which is all there is for an institution no config knows — and
  // which the app ignored until a batch made "which institution is this
  // screenshot from" stop being one question with one answer. Blank when neither
  // could place it, and the user names it themselves.
  const institutionNameFor = (outcome: ScreenshotOutcome): string => {
    const detected = outcome.institutionId;
    if (detected !== undefined && detected !== "unknown") {
      return t(institutionNameKey(detected));
    }
    return outcome.institutionName?.trim() ?? "";
  };

  const handleRecognized = (
    outcomes: ScreenshotOutcome[],
  ): Promise<boolean | "declined"> => {
    // One entry per screenshot, each carrying the institution its accounts are
    // filed under. Drop what isn't worth a draft at the form layer (recognition
    // keeps them — see `isWorthDrafting`), then drop a screenshot left with
    // nothing; if none survives, there is nothing to fill.
    const screenshots: RecognizedScreenshot[] = outcomes
      .map((outcome) => ({
        accounts: outcome.accounts.filter(isWorthDrafting),
        institutionName: institutionNameFor(outcome),
      }))
      .filter((screenshot) => screenshot.accounts.length > 0);
    if (screenshots.length === 0) {
      return Promise.resolve(false);
    }
    // The fold reads `prev` inside the updater, not this render's `drafts`:
    // recognition resolves seconds — for a batch, minutes — after it started,
    // and the fields the user typed in the meantime live only in the latest
    // state.
    const apply = () => {
      setIsFromRecognition(true);
      // LATCHED here, not derived per render. Whether the institution is asked
      // once above the pager or once per page is a property of the BATCH, and
      // the batch is fixed the moment recognition lands. Read off the drafts
      // each render instead, the answer changed while the user was typing into
      // the very field it controls: correcting page two's bank to match page
      // one's made the drafts agree on the final keystroke, which unmounted the
      // focused input under the keyboard — and the field that replaced it
      // rewrites EVERY draft, so the two accounts silently became one group
      // with no control left that could split them again.
      setInstitutionIsShared(screenshotsAgreeOnInstitution(screenshots));
      reseedDrafts((prev) =>
        applyRecognizedToDrafts(prev, screenshots, defaultCurrency),
      );
    };

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
            // "Declined", not "failed": the screenshot was read fine and the
            // user turned the replacement down. Reported as `false` the
            // uploader showed "none of the recognized accounts matched" under
            // the card, inviting a re-upload of the same image.
            onPress: () => resolve("declined"),
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
        // Android alerts are dismissable by tapping outside or pressing back,
        // and no button handler fires when they are. The uploader awaits this
        // promise, so an unresolved dismissal left the card spinning on
        // "Recognizing…" forever with no way back. Dismissing IS declining.
        { cancelable: true, onDismiss: () => resolve("declined") },
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
    selectedSourceImages,
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

  // What the shared field shows. Only read when `institutionIsShared` is true,
  // where every draft carries the same name by construction — `sharedInstitutionName`
  // is what decides that at recognition time, and `setBatchInstitutionName`
  // keeps it true afterwards.
  const batchInstitution = drafts[0]?.institutionName ?? "";

  // Renames the institution on EVERY draft, for the field above the pager.
  // Writing all of them is what keeps that one field honest: it claims to be
  // the batch's answer, so editing it has to be.
  const setBatchInstitutionName = useCallback((name: string) => {
    setDrafts((prev) =>
      prev.map((draft) => ({ ...draft, institutionName: name })),
    );
  }, []);

  // No clamps needed: WizardNav renders the next chevron only before the last
  // page and the back chevron only past the first.
  const handleNext = () => pagerRef.current?.goTo(currentIndex + 1);
  const handleBack = () => pagerRef.current?.goTo(currentIndex - 1);

  // Derived once and shared by the save button's disabled state and both save
  // paths so `draftToValidAccount` runs once per draft change, not again at
  // save. In single-account mode this is the one draft's validity.
  // Paired with the institution each draft names, because the two are written
  // together: a batch spanning three banks resolves three groups, and the
  // account has to keep hold of which one is its own.
  const validEntries = useMemo(
    () =>
      drafts.flatMap((draft) => {
        const account = draftToValidAccount(draft);
        return account === null
          ? []
          : [{ account, institutionName: draft.institutionName.trim() }];
      }),
    [drafts],
  );
  // Saving writes `validEntries`, so a draft that isn't saveable would simply
  // not be written — silently, with the section header still claiming the model
  // recognized it. Block instead and say how many are incomplete: the user
  // either completes them or removes them, and nothing on screen disappears
  // without being asked for. In single-account mode this is exactly the old
  // "the one draft must be valid" gate.
  const incompleteDraftCount = drafts.length - validEntries.length;
  // Two drafts sharing a business key (same name + same/empty last four)
  // would silently merge in applyAccountUpsert — for a shared currency the
  // second balance overwrites the first. Blocked via disabled-save + inline
  // hint, so the reason stays visible next to the drafts instead of behind a
  // dismissed alert. Vacuously false below two drafts, so it needs no
  // multi-account guard.
  const hasDuplicateDrafts = hasDuplicateAccountKeys(
    validEntries.map((entry) => entry.account),
  );
  const canSave =
    validEntries.length > 0 &&
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
      // Resolve each distinct institution NAME to a real group id: reuse an
      // existing same-named group (so re-uploading the same institution's
      // screenshot doesn't spawn duplicates), else create one. Both reads go
      // through the repository cache, and group creation is serialized through
      // `mutate`, so this stays consistent with a concurrent upsert.
      //
      // Once per NAME, not once per account — a five-account screenshot would
      // otherwise create the same group five times over, racing its own
      // `findOrCreate`. An empty name skips grouping entirely.
      const groupIds = new Map<string, string>();
      for (const name of new Set(
        validEntries
          .map((entry) => entry.institutionName)
          .filter((name) => name !== ""),
      )) {
        groupIds.set(name, (await findOrCreateGroupByName(name)).id);
      }
      const accountsToSave = validEntries.map(
        ({ account, institutionName }) => {
          // A recognized account is filed under the name on its own draft; a
          // hand-entered one under the institution the picker chose, which is
          // an id already on file rather than a name to resolve.
          const groupId = isFromRecognition
            ? groupIds.get(institutionName)
            : selectedInstitutionId || undefined;
          return groupId ? { ...account, groupId } : account;
        },
      );
      await upsertAssetAccounts(accountsToSave);
      // Mark the home screen's account list stale as soon as the write lands,
      // rather than leaving it to be re-read on focus. The query is not active
      // while this screen is on top, so this only flags it — the home screen
      // refetches when it mounts again, and never renders a frame of the list
      // as it was before this save.
      await invalidateAccounts(queryClient);
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
    finishSave(validEntries.length);
  };

  const saveLabel = t(
    isMultiAccount ? "multiAccount.saveAll" : "newAccount.saveAccount",
  );

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
            multiple
            sourceImages={selectedSourceImages}
            onSourceImagesChange={setSelectedSourceImages}
            onRecognized={handleRecognized}
            onRecognizingChange={setIsRecognizing}
          />

          <SectionHeader
            stacked
            title={
              isMultiAccount
                ? t("multiAccount.title", { count })
                : t("newAccount.accountInformation")
            }
            detail={
              <Text
                accessibilityLiveRegion="polite"
                style={[
                  screenStyles.formHint,
                  isRecognizing && styles.recognizingHint,
                ]}
              >
                {isRecognizing
                  ? t("accountScreenshot.recognizingHintBatch", {
                      count: selectedSourceImages.length,
                    })
                  : isMultiAccount
                    ? t("multiAccount.accountPosition", {
                        current: currentIndex + 1,
                        total: count,
                      })
                    : t("newAccount.formHint")}
              </Text>
            }
          />

          {/* When every draft names the same institution — one screenshot, or
              several from one bank — it is one answer, so it is asked once
              above the pages rather than repeated inside each of them, where
              the same field on three pages read as three fields and editing it
              on page two changed page one. A batch that spans institutions has
              no single answer, so the field moves INTO each page instead
              (`AccountEditorFields` renders it there). */}
          {isMultiAccount && isFromRecognition && institutionIsShared ? (
            <View style={styles.batchInstitutionCard}>
              <FormField
                label={t("accountForm.group")}
                onChangeText={setBatchInstitutionName}
                placeholder={t("accountForm.newGroupPlaceholder")}
                value={batchInstitution}
              />
              <Text style={styles.batchInstitutionHint}>
                {t("accountForm.batchGroupHint")}
              </Text>
            </View>
          ) : null}

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
                    // Only when the batch spans institutions. With one shared
                    // answer the field lives above the pager instead — the
                    // same field on three pages reads as three fields.
                    showInstitutionName={!institutionIsShared}
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
              // A recognized screenshot names its institution in a text field
              // the user can correct; a hand-entered account picks from the
              // ones on file, as the edit screen does.
              showInstitutionName={isFromRecognition}
              institutions={isFromRecognition ? undefined : institutions}
              selectedInstitutionId={selectedInstitutionId}
              onInstitutionChange={
                isFromRecognition ? undefined : setSelectedInstitutionId
              }
              onCreateInstitution={handleCreateInstitution}
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
            loading={isSaving}
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
  // The hint goes brand-coloured while recognition runs: it is the one live
  // thing on the screen, and grey would let it pass for the resting copy.
  recognizingHint: {
    color: COLORS.brand,
    fontWeight: FONT_WEIGHT.semibold,
  },
  // The batch-wide institution, in its own card above the pager so it reads
  // as belonging to the whole set rather than to whichever page is showing.
  batchInstitutionCard: {
    ...screenStyles.formCard,
    marginBottom: SPACING.md,
    paddingBottom: SPACING.md,
  },
  batchInstitutionHint: {
    ...screenStyles.fieldHint,
    marginTop: 0,
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
