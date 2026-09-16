import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { IconButton } from "@/components/IconButton";
import { PrivacyNote } from "@/components/PrivacyNote";
import { Spinner } from "@/components/Spinner";
import { ScreenshotMediaViewer } from "@/features/accounts/ScreenshotMediaViewer";
import {
  type ScreenshotIssue,
  type ScreenshotOutcome,
  recognizeScreenshots,
} from "@/features/recognition/batch-recognition";
import { COLORS } from "@/theme/colors";
import { MIN_INTERACTIVE_SIZE } from "@/theme/layout";
import { cardSurface, screenStyles } from "@/theme/screen-styles";
import { ELEVATED_SHADOW } from "@/theme/shadow";
import { CARD_RADIUS, RADIUS } from "@/theme/sizes";
import { SPACING } from "@/theme/spacing";
import { TONES } from "@/theme/tones";
import { FONT_SIZE, FONT_WEIGHT } from "@/theme/typography";

export type SelectedSourceImage = {
  assetId: string | null;
  uri: string;
  width?: number;
  height?: number;
};

export type { ScreenshotOutcome };

/**
 * How many screenshots one pick may carry.
 *
 * Not a storage limit — it is a TIME limit. Each screenshot is an OCR pass plus
 * a decode over the on-device model, and the batch runs them one at a time
 * (`recognizeScreenshots` says why), so ten is already several minutes of
 * waiting that the user cannot shorten. Someone with more institutions than
 * this is better served adding them in two sittings than watching one progress
 * count for a quarter of an hour.
 */
const MAX_SCREENSHOTS = 10;

type AccountScreenshotUploaderProps = {
  sourceImages: readonly SelectedSourceImage[];
  onSourceImagesChange: (images: SelectedSourceImage[]) => void;
  // Fired with one outcome per screenshot, in pick order — a single-account
  // screenshot yields a one-account outcome, an institution-overview screenshot
  // yields several accounts in one outcome, and a batch yields one outcome per
  // image. The parent decides how to apply them (the add screen seeds a draft
  // per account and groups each screenshot's accounts under its own
  // institution; the edit screen applies the entry matching its account) and
  // reports whether anything was applied, so the badge only reads "Recognized"
  // when the result actually landed on the form. May answer asynchronously:
  // the add screen confirms before a re-upload replaces drafts the user has
  // edited, and the badge waits on that answer rather than guessing it.
  // `true` when the parent applied the result, `false` when it could not (no
  // matching account, nothing fillable), and `"declined"` when the USER turned
  // it down — a confirmation they cancelled. The third case is not a failure of
  // the screenshots, so it must not render the "none of these matched" hint that
  // invites re-uploading the same images.
  onRecognized: (
    outcomes: ScreenshotOutcome[],
  ) => boolean | "declined" | Promise<boolean | "declined">;
  // Fired when recognition starts and when it settles, so the screen can say
  // so where the user is looking. The badge on the preview card is the
  // uploader's own word on it, but the card scrolls away while the form
  // stays, and a form that sits empty with a grey Save button for half a
  // minute reads as broken.
  onRecognizingChange?: (isRecognizing: boolean) => void;
  // `compact` renders the empty slot as one row — icon, label, chevron —
  // instead of the full upload card. The edit screen uses it: there a
  // screenshot is a way to refresh a balance, not the subject of the page,
  // and the 220pt card pushed the form it annotates below the fold.
  compact?: boolean;
  // Whether one pick may carry several screenshots. The ADD screen sets it:
  // there a screenshot is an institution, and a person has several. The edit
  // screen does not — it is refreshing ONE account, and a second screenshot
  // there has no account to belong to.
  multiple?: boolean;
};

// One height for both states of the screenshot slot (empty upload card and
// selected preview card) so choosing a screenshot doesn't shift the layout.
const SCREENSHOT_CARD_HEIGHT = 220;

// Which failure to surface under the card. Rendered as an inline error hint
// rather than Alert.alert, so the reason stays anchored to the screenshot slot
// that failed instead of vanishing on dismiss.
// `ScreenshotIssue` covers every way one screenshot's recognition can decline —
// each with its own next step for the user, which is why they are not one
// state. The two added here are this component's own: the picker failing, and
// none of the recognized accounts matching the account being edited.
type UploadIssue = ScreenshotIssue | "noMatchingAccount" | "pickerFailed";

const ISSUE_MESSAGE_KEY = {
  recognitionFailed: "accountScreenshot.recognitionFailed",
  recognitionEmpty: "accountScreenshot.recognitionEmpty",
  modelLoadFailed: "accountScreenshot.modelLoadFailed",
  modelUnusable: "accountScreenshot.modelUnusable",
  modelInterrupted: "accountScreenshot.modelInterrupted",
  remoteFailed: "accountScreenshot.remoteFailed",
  noMatchingAccount: "accountScreenshot.noMatchingAccount",
  pickerFailed: "accountScreenshot.pickerErrorMessage",
  ocrUnsupported: "accountScreenshot.ocrUnsupported",
  engineNotReady: "settings.engineSetup.notReady",
} as const satisfies Record<UploadIssue, string>;

/** Where one screenshot has got to, for its own badge in the strip. */
type SlotStatus =
  | { state: "waiting" }
  | { state: "recognizing" }
  | { state: "recognized" }
  | { state: "issue"; issue: ScreenshotIssue };

// Screenshot picker + recognition + preview card, shared by the add-account and
// edit-account screens. Owns the recognizing/recognized UI state and the
// recognition error hints (recognition / picker failures → inline error text)
// so both screens stay in lockstep. The parent owns the selected images (so it
// can decide whether to run the post-save cleanup flow) and applies the
// recognized accounts to its own form.
export function AccountScreenshotUploader({
  sourceImages,
  onSourceImagesChange,
  onRecognized,
  onRecognizingChange,
  compact = false,
  multiple = false,
}: AccountScreenshotUploaderProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const [isRecognizing, setIsRecognizing] = useState(false);
  // Per-screenshot progress. `null` when nothing is running; the strip reads it
  // for the badge over each thumbnail, and the card's summary badge reads its
  // length against the batch's.
  const [statuses, setStatuses] = useState<SlotStatus[]>([]);
  // Mirrors the local flag out to the parent. An effect rather than a call
  // beside each `setIsRecognizing`, so the two can never disagree about
  // whether recognition is running.
  const onRecognizingChangeRef = useRef(onRecognizingChange);
  useEffect(() => {
    onRecognizingChangeRef.current = onRecognizingChange;
  }, [onRecognizingChange]);
  useEffect(() => {
    onRecognizingChangeRef.current?.(isRecognizing);
  }, [isRecognizing]);
  const [hasRecognized, setHasRecognized] = useState(false);
  const [issue, setIssue] = useState<UploadIssue | null>(null);
  // How many screenshots could not be read, when several were picked. The
  // inline hint names the reason for one screenshot and the COUNT for a batch:
  // with a thumbnail strip on screen, which ones failed is already shown by
  // their badges, and repeating six reasons under the card would bury the four
  // that worked.
  const [failedCount, setFailedCount] = useState(0);

  // Recognition resolves seconds — or, for a batch, minutes — after `pickImages`
  // captured this render's `onRecognized`, by which time the parent may have
  // re-rendered: the user can keep typing into the form while recognition runs.
  // Calling the captured callback would read stale state: the add screen's
  // "replace edited drafts?" guard would see the pre-typing blank draft and
  // silently overwrite the typed input. Reading through the ref always invokes
  // the parent's current handler instead. Synced in an effect (not during
  // render) so the ref stays current without violating the render-time
  // ref-write rule.
  const onRecognizedRef = useRef(onRecognized);
  useEffect(() => {
    onRecognizedRef.current = onRecognized;
  }, [onRecognized]);
  // Drops the recognition side effects if the uploader unmounts before the pass
  // resolves. Without it, navigating away mid-recognition still fires
  // `onRecognized` (and the add screen's replace-drafts alert) on whatever
  // screen came next, and calls setState on a gone component. For a batch it
  // does one thing more: `recognizeScreenshots` reads it between screenshots
  // and stops, so a screen the user has left does not spend another minute of
  // the phone's battery finishing a list nobody will see.
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Returns "declined" when the parent turned the result down, so `pickImages`
  // can put back the screenshots and the badge the user chose to keep.
  const recognizeBatch = async (
    images: SelectedSourceImage[],
  ): Promise<"declined" | undefined> => {
    setIsRecognizing(true);
    setIssue(null);
    setFailedCount(0);
    setStatuses(images.map(() => ({ state: "waiting" })));
    // The outcome leaves the try as a plain variable rather than a `finally`
    // clause, and the failure kind is picked with if/else rather than a
    // ternary: React Compiler bails out of an entire component containing
    // either a finalizer or a conditional expression inside a try/catch, which
    // would leave this component with no memoization at all.
    let failure: UploadIssue | null = null;
    let failures = 0;
    let applied = false;
    let declined = false;
    try {
      setStatuses((current) =>
        current.map((status, index) =>
          index === 0 ? { state: "recognizing" } : status,
        ),
      );
      const outcomes = await recognizeScreenshots(
        images,
        (index, outcome) => {
          if (!isMountedRef.current) {
            return;
          }
          setStatuses((current) =>
            current.map((status, position) => {
              if (position === index) {
                return outcome.issue === null
                  ? { state: "recognized" }
                  : { state: "issue", issue: outcome.issue };
              }
              // The next screenshot starts the moment this one lands, so its
              // badge turns over in the same update rather than a frame later.
              return position === index + 1 ? { state: "recognizing" } : status;
            }),
          );
        },
        () => !isMountedRef.current,
      );
      if (!isMountedRef.current) {
        return;
      }
      failures = outcomes.filter((outcome) => outcome.issue !== null).length;
      // One screenshot's reason is worth naming; a batch's are summarized by
      // count. Either way the FIRST issue is what the hint names, because a
      // batch that stopped early stopped on a reason that applies to all of
      // them (the engine is not set up, this device cannot run OCR).
      failure =
        outcomes.find((outcome) => outcome.issue !== null)?.issue ?? null;
      // A failed recognition still carries the engine's read where there was
      // one, so the parent is offered every outcome and decides what lands.
      const result = await onRecognizedRef.current(outcomes);
      declined = result === "declined";
      applied = result === true;
    } catch {
      // `recognizeScreenshots` maps the recognizer's typed errors itself, so
      // anything thrown past it is the loop or the parent's handler failing —
      // neither of which the user can act on beyond filling the form in.
      failure = "recognitionFailed";
    }
    if (!isMountedRef.current) {
      return;
    }
    setIsRecognizing(false);
    setFailedCount(failures);
    // Stand the pre-armed slot back down. `onOutcome` turns the NEXT
    // screenshot's badge over in the same update that lands this one, but
    // `recognizeScreenshots` may break immediately afterwards — on
    // `engineNotReady` or `ocrUnsupported` it always does — and that slot then
    // spun forever over a screenshot nothing was ever going to read.
    setStatuses((current) =>
      current.map((status) =>
        status.state === "recognizing" ? { state: "waiting" } : status,
      ),
    );
    // Declining leaves the badge as it was: the user turned down a REPLACEMENT,
    // so whatever the previous screenshots filled in is still on the form and
    // still recognized. Clearing it said "nothing was recognized" over fields
    // that plainly were.
    if (!declined) {
      setHasRecognized(applied);
    }

    // Two outcomes, and `failure` decides between them.
    //
    // A null issue on every outcome means recognition produced accounts, so
    // `failure === null` with nothing applied means the parent was offered some
    // and took none: the screenshots are of a different account. That is a
    // message this screen can only give when nothing else went wrong —
    // `failure` otherwise names something the user can act on (the model would
    // not load, OCR is unsupported, the picker failed), and speaking over one
    // of those would send them to re-upload against a problem no upload fixes.
    //
    // Everything else is `failure`, which is null when something DID land — and
    // setting null is what clears a stale issue off a successful pass.
    setIssue(
      failure === null && !applied && !declined ? "noMatchingAccount" : failure,
    );
    return declined ? "declined" : undefined;
  };

  const pickImages = async () => {
    let picked: ImagePicker.ImagePickerAsset[] = [];
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: false,
        quality: 1,
        allowsMultipleSelection: multiple,
        selectionLimit: multiple ? MAX_SCREENSHOTS : 1,
      });
      if (result.canceled) {
        return;
      }
      picked = result.assets;
    } catch {
      setIssue("pickerFailed");
      return;
    }
    // `assets` is typed non-empty when not canceled, but the contract doesn't
    // guarantee it — guard against an empty array rather than crashing below.
    if (picked.length === 0) {
      setIssue("pickerFailed");
      return;
    }

    // The previous outcome is held until this pick produces its own. Clearing
    // it here meant a DECLINED replacement left the badge reading "screenshots
    // ready" over fields the earlier screenshots had filled in — and the card
    // showing the new images beside the old form data.
    const previous = [...sourceImages];
    const previouslyRecognized = hasRecognized;
    // The picker already decoded each image, so its pixel dimensions travel
    // with it instead of the recognizer re-decoding just to read them.
    const images = picked.map((asset) => ({
      assetId: asset.assetId ?? null,
      uri: asset.uri,
      width: asset.width,
      height: asset.height,
    }));
    onSourceImagesChange(images);
    setHasRecognized(false);
    const outcome = await recognizeBatch(images);
    if (outcome === "declined" && isMountedRef.current) {
      // Put back what the user chose to keep: the screenshots they had, and the
      // badge that describes the fields still on the form.
      onSourceImagesChange(previous);
      setHasRecognized(previouslyRecognized);
      // The per-slot badges belong to the batch that was just turned down, and
      // `renderSlotBadge` reads them POSITIONALLY — left in place they would
      // draw the declined batch's verdicts over the restored thumbnails, up to
      // a red "couldn't be read" over a screenshot that filled the form in.
      // Cleared rather than restored: the card's own badge still says what the
      // kept screenshots did, and it is the only claim that is still true.
      setStatuses([]);
      setFailedCount(0);
    }
  };

  const recognizedCount = statuses.filter(
    (status) => status.state !== "waiting" && status.state !== "recognizing",
  ).length;

  // The card's title and its accessibility label are the same words; naming it
  // once is what keeps them so.
  const uploadLabel = t(
    multiple
      ? "accountScreenshot.uploadScreenshots"
      : "accountScreenshot.uploadScreenshot",
  );

  const badgeLabel = isRecognizing
    ? sourceImages.length > 1
      ? t("accountScreenshot.recognizingProgress", {
          current: Math.min(recognizedCount + 1, sourceImages.length),
          total: sourceImages.length,
        })
      : t("accountScreenshot.recognizing")
    : hasRecognized
      ? t("accountScreenshot.recognized")
      : t("accountScreenshot.screenshotReady", { count: sourceImages.length });

  // One screenshot's badge in the strip. Only drawn for a batch: with a single
  // image the card's own badge already says the same thing, and a second copy
  // of it over the same picture is noise.
  //
  // Memoized, along with `previewUris` below, because `ScreenshotMediaViewer`
  // is `memo`-ized on the promise that an uploader re-render does not reach the
  // heavier MediaViewer — and a fresh array literal plus a fresh closure per
  // render is a shallow compare that can never hold. A batch re-renders once
  // per screenshot as its status lands, and each of those would otherwise
  // rebuild the viewer's whole `items` list.
  const slotCount = sourceImages.length;
  const renderSlotBadge = useCallback(
    (index: number) => {
      const status = statuses[index];
      if (slotCount < 2 || status === undefined) {
        return null;
      }
      if (status.state === "recognizing") {
        return (
          <View style={styles.slotBadge} pointerEvents="none">
            <Spinner color={COLORS.brand} size={12} />
          </View>
        );
      }
      if (status.state === "waiting") {
        return null;
      }
      const recognized = status.state === "recognized";
      return (
        <View
          accessibilityLabel={t(
            recognized
              ? "accountScreenshot.slotRecognized"
              : "accountScreenshot.slotFailed",
            { position: index + 1 },
          )}
          style={styles.slotBadge}
          pointerEvents="none"
        >
          <Icon
            name={recognized ? "check" : "triangle-alert"}
            size={12}
            // Caution, not danger: the rest of the batch landed, so this badge
            // means "one thing left to type", not "a destructive thing
            // happened". `tones.ts` reserves red for the latter.
            color={recognized ? COLORS.brand : TONES.caution.ink}
          />
        </View>
      );
    },
    [slotCount, statuses, t],
  );

  const previewUris = useMemo(
    () => sourceImages.map((image) => image.uri),
    [sourceImages],
  );

  return (
    <>
      {sourceImages.length > 0 ? (
        // With screenshots selected, they render through MediaViewer: tapping a
        // thumbnail opens a fullscreen pinch-to-zoom pager over the whole batch
        // so the user can verify each auto-filled name/last-four/balance against
        // the screenshot it came from — it does NOT re-open the picker.
        // Replacing them is a separate button on the overlay so inspect and
        // replace don't share one tap. The overlay is `box-none`, so taps pass
        // through to the thumbnails everywhere except on the button itself.
        <View style={styles.previewCard}>
          <ScreenshotMediaViewer
            uris={previewUris}
            renderBadge={renderSlotBadge}
          />
          {/* No scrim over the images: the user is about to check the form
              against exactly these pictures, and a dimmed screenshot is a
              harder one to read. The badge and the button carry their own
              opaque surfaces instead. */}
          <View style={styles.overlayLayer} pointerEvents="box-none">
            <View style={styles.readyBadge} pointerEvents="none">
              {isRecognizing ? (
                <Spinner color={COLORS.brand} size={14} />
              ) : (
                <Icon name="check" size={14} color={COLORS.brand} />
              )}
              <Text style={styles.readyBadgeText}>{badgeLabel}</Text>
            </View>
            <IconButton
              accessibilityHint={t("accountScreenshot.replaceScreenshotHint", {
                count: sourceImages.length,
              })}
              accessibilityLabel={t("accountScreenshot.replaceScreenshot", {
                count: sourceImages.length,
              })}
              disabled={isRecognizing}
              name="arrow-up"
              onPress={pickImages}
              size="sm"
              style={styles.replaceButton}
              variant="secondary"
            />
          </View>
        </View>
      ) : compact ? (
        <Pressable
          accessibilityLabel={t("accountScreenshot.updateFromScreenshot")}
          accessibilityRole="button"
          disabled={isRecognizing}
          onPress={pickImages}
          style={({ pressed }) => [
            styles.uploadRow,
            pressed && screenStyles.pressed,
          ]}
        >
          <View style={styles.uploadRowIcon}>
            <Icon name="arrow-up" size="sm" color={COLORS.brand} />
          </View>
          <Text style={styles.uploadRowTitle}>
            {t("accountScreenshot.updateFromScreenshot")}
          </Text>
          <Icon name="chevron-right" size="sm" color={COLORS.muted} />
        </Pressable>
      ) : (
        <Pressable
          accessibilityLabel={uploadLabel}
          accessibilityRole="button"
          disabled={isRecognizing}
          onPress={pickImages}
          style={({ pressed }) => [
            styles.uploadCard,
            pressed && screenStyles.pressed,
          ]}
        >
          <View style={styles.uploadContent}>
            <View style={styles.uploadIcon}>
              <Icon name="arrow-up" size="lg" color={COLORS.brand} />
            </View>
            <Text style={styles.uploadTitle}>{uploadLabel}</Text>
            <Text style={styles.uploadDescription}>
              {t(
                multiple
                  ? "accountScreenshot.screenshotsGuidance"
                  : "accountScreenshot.screenshotGuidance",
              )}
            </Text>
            <View style={styles.uploadAction}>
              <Text style={styles.uploadActionText}>
                {t(
                  multiple
                    ? "accountScreenshot.chooseScreenshots"
                    : "accountScreenshot.chooseScreenshot",
                )}
              </Text>
            </View>
          </View>
        </Pressable>
      )}
      {issue ? (
        <View style={styles.errorRow}>
          <Text accessibilityLiveRegion="polite" style={screenStyles.errorHint}>
            {/* PARTIAL means some landed and some did not, which is a count
                against the batch rather than a count on its own. Gated only on
                `failedCount > 1` it was wrong at both ends: one failure out of
                five fell through to "Couldn't read the screenshot. Please fill
                in the details manually." over four forms the app had just
                filled in, and five failures out of five promised "The others
                filled in below" over nothing at all. */}
            {failedCount > 0 && failedCount < sourceImages.length
              ? t("accountScreenshot.batchPartialFailure", {
                  count: failedCount,
                })
              : t(ISSUE_MESSAGE_KEY[issue])}
          </Text>
          {issue === "engineNotReady" ? (
            // The way out, not just the reason: the engine being unset up is
            // the one failure whose fix lives on another screen, so the
            // button goes where the reason is (AGENTS.md: an inline hint
            // anchored to what failed, not a dismissable alert).
            <Button
              size="xs"
              variant="ghost"
              fullWidth={false}
              onPress={() => void router.push("/settings")}
            >
              {t("settings.engineSetup.goToSettings")}
            </Button>
          ) : null}
        </View>
      ) : null}
      <PrivacyNote
        message={t("accountScreenshot.screenshotPrivacy", {
          count: Math.max(1, sourceImages.length),
        })}
      />
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
  // Overlay content only — no tint. The padding insets the badge and replace
  // button, and the layer never intercepts taps under `box-none`.
  overlayLayer: {
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
    ...ELEVATED_SHADOW,
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
  // One screenshot's own verdict, pinned to the corner of its thumbnail. Small
  // and opaque: it sits over the picture it describes, and the picture is what
  // the user is reading.
  slotBadge: {
    ...ELEVATED_SHADOW,
    alignItems: "center",
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.sm,
    height: 22,
    justifyContent: "center",
    margin: SPACING.xs,
    position: "absolute",
    right: 0,
    top: 0,
    width: 22,
  },
  replaceButton: {
    ...ELEVATED_SHADOW,
    alignSelf: "flex-end",
  },
  // The compact slot: a single row in the card voice, so on the edit screen
  // the screenshot reads as one more thing the user can do, not the thing the
  // page is about.
  uploadRow: {
    ...cardSurface,
    alignItems: "center",
    flexDirection: "row",
    gap: SPACING.md,
    minHeight: MIN_INTERACTIVE_SIZE,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
  },
  uploadRowIcon: {
    alignItems: "center",
    backgroundColor: COLORS.brandSoft,
    borderRadius: 16,
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  uploadRowTitle: {
    color: COLORS.ink,
    flex: 1,
    fontSize: FONT_SIZE.body,
    fontWeight: FONT_WEIGHT.semibold,
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
