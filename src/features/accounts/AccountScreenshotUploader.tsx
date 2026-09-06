import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { IconButton } from "@/components/IconButton";
import { PrivacyNote } from "@/components/PrivacyNote";
import { ScreenshotMediaViewer } from "@/features/accounts/ScreenshotMediaViewer";
import {
  type RecognitionIssue,
  issueForRecognition,
} from "@/features/recognition/recognition-issue";
import {
  type RecognizedAccount,
  EngineNotReadyError,
  RecognitionUnsupportedError,
  recognizeAccountFromScreenshot,
} from "@/features/recognition/screenshot-recognition";
import { COLORS } from "@/theme/colors";
import { MIN_INTERACTIVE_SIZE } from "@/theme/layout";
import { cardSurface, screenStyles } from "@/theme/screen-styles";
import { ELEVATED_SHADOW } from "@/theme/shadow";
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
  // Fired with every account the recognizer returned — a single-account
  // screenshot yields a one-element list, an institution-overview screenshot yields
  // several. The parent decides how to apply them (the add screen routes ≥2
  // accounts to the multi-account wizard and otherwise fills the single-
  // account form; the edit screen applies the entry matching its account) and
  // reports whether anything was applied, so the badge only reads "Recognized"
  // when the result actually landed on the form. May answer asynchronously:
  // the add screen confirms before a re-upload replaces drafts the user has
  // edited, and the badge waits on that answer rather than guessing it.
  // `true` when the parent applied the result, `false` when it could not (no
  // matching account, nothing fillable), and `"declined"` when the USER turned
  // it down — a confirmation they cancelled. The third case is not a failure of
  // the screenshot, so it must not render the "none of these matched" hint that
  // invites re-uploading the same image.
  onRecognized: (
    accounts: RecognizedAccount[],
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
};

// One height for both states of the screenshot slot (empty upload card and
// selected preview card) so choosing a screenshot doesn't shift the layout.
const SCREENSHOT_CARD_HEIGHT = 220;

// Which failure to surface under the card. Rendered as an inline error hint
// rather than Alert.alert, so the reason stays anchored to the screenshot slot
// that failed instead of vanishing on dismiss.
// `RecognitionIssue` covers every way the recognition pipeline can decline —
// each with its own next step for the user, which why they are not one
// state. The three added here are this component's own: the picker failing,
// hardware that cannot run OCR at all, and the chosen engine not being set up
// (no model downloaded, no service configured) — the last one carries a way
// OUT, not just a reason.
type UploadIssue =
  | RecognitionIssue
  | "noMatchingAccount"
  | "pickerFailed"
  | "ocrUnsupported"
  | "engineNotReady";

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

// Screenshot picker + on-device OCR recognition + preview card, shared by the
// add-account and edit-account screens. Owns the recognizing/recognized UI
// state and the recognition error hints (recognition / picker failures →
// inline error text) so both screens stay in lockstep. The parent owns the
// selected image (so it can decide whether to run the post-save cleanup
// flow) and applies recognized accounts to its own form.
export function AccountScreenshotUploader({
  sourceImage,
  onSourceImageChange,
  onRecognized,
  onRecognizingChange,
  compact = false,
}: AccountScreenshotUploaderProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const [isRecognizing, setIsRecognizing] = useState(false);
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

  // Recognition resolves 1-3s after `pickImage` captured this render's
  // `onRecognized`, by which time the parent may have re-rendered — the user
  // can keep typing into the form while recognition runs. Calling the captured
  // callback would read stale state: the add screen's "replace edited drafts?"
  // guard would see the pre-typing blank draft and silently overwrite the
  // typed input. Reading through the ref always invokes the parent's current
  // handler instead. Synced in an effect (not during render) so the ref stays
  // current without violating the render-time ref-write rule.
  const onRecognizedRef = useRef(onRecognized);
  useEffect(() => {
    onRecognizedRef.current = onRecognized;
  }, [onRecognized]);
  // Drops the recognition side effects if the uploader unmounts before the
  // OCR pass resolves. Without it, navigating away mid-recognition still fires
  // `onRecognized` (and the add screen's replace-drafts alert) on whatever
  // screen came next, and calls setState on a gone component.
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Returns "declined" when the parent turned the result down, so `pickImage`
  // can put back the screenshot and the badge the user chose to keep.
  const recognizeScreenshot = async (
    uri: string,
    width?: number,
    height?: number,
  ): Promise<"declined" | undefined> => {
    setIsRecognizing(true);
    setIssue(null);
    // The outcome leaves the try as a plain variable rather than a `finally`
    // clause, and the failure kind is picked with if/else rather than a
    // ternary: React Compiler bails out of an entire component containing
    // either a finalizer or a conditional expression inside a try/catch, which
    // would leave this component with no memoization at all. Same reason
    // `pickImage` below resolves its `?? null` after the try.
    let failure: UploadIssue | null = null;
    let applied = false;
    let declined = false;
    try {
      const result = await recognizeAccountFromScreenshot(uri, width, height);
      if (!isMountedRef.current) {
        return;
      }
      // Everything the pipeline can decline for arrives here as its own issue,
      // mapped by `issueForRecognition`.
      failure = issueForRecognition(result);
      // A failed recognition still carries the engine's read (see
      // `ModelRecognitionResult`): the user gets the names, balances and last
      // fours pre-filled AND the message saying the model could not finish, so
      // they correct a form rather than typing one.
      const accounts =
        result.status === "recognized"
          ? result.recognition.accounts
          : result.accounts;
      // The parent reports whether it applied anything — an unparseable/empty
      // response or an ignored result (e.g. no matching account on the edit
      // screen) must not flip the badge to "Recognized" over an unchanged
      // form.
      const outcome = await onRecognizedRef.current(accounts);
      declined = outcome === "declined";
      applied = outcome === true;
    } catch (error) {
      // The recognizer gates unsupported hardware itself and throws a typed
      // error so we can tell "this device can't do OCR" (and, for the engine
      // not being set up, offer the way to Settings) from "OCR ran but
      // failed", instead of collapsing all of them into `recognitionFailed`.
      if (error instanceof EngineNotReadyError) {
        failure = "engineNotReady";
      } else if (error instanceof RecognitionUnsupportedError) {
        failure = "ocrUnsupported";
      } else {
        failure = "recognitionFailed";
      }
    }
    if (!isMountedRef.current) {
      return;
    }
    setIsRecognizing(false);
    // Declining leaves the badge as it was: the user turned down a REPLACEMENT,
    // so whatever the previous screenshot filled in is still on the form and
    // still recognized. Clearing it said "nothing was recognized" over fields
    // that plainly were.
    if (!declined) {
      setHasRecognized(applied);
    }

    // Two outcomes, and `failure` decides between them.
    //
    // `issueForRecognition` returns null only for a recognition that produced
    // accounts, so `failure === null` with nothing applied means the parent was
    // offered some and took none: the screenshot is of a different account.
    // That is a message this screen can only give when nothing else went wrong
    // — `failure` otherwise names something the user can act on (the model
    // would not load, OCR is unsupported, the picker failed), and speaking over
    // one of those would send them to re-upload against a problem no upload
    // fixes.
    //
    // Everything else is `failure`, which is null when something DID land — and
    // setting null is what clears a stale issue off a successful pass.
    setIssue(
      failure === null && !applied && !declined ? "noMatchingAccount" : failure,
    );
    return declined ? "declined" : undefined;
  };

  const pickImage = async () => {
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
      setIssue("pickerFailed");
      return;
    }
    // `assets` is typed non-empty when not canceled, but the contract doesn't
    // guarantee it — guard against an empty array rather than crashing on
    // `picked.assetId` below.
    if (!picked) {
      setIssue("pickerFailed");
      return;
    }

    // The previous outcome is held until this pick produces its own. Clearing
    // it here meant a DECLINED replacement left the badge reading "screenshot
    // ready" over fields the earlier screenshot had filled in — and the card
    // showing the new image beside the old form data.
    const previous = sourceImage;
    const previouslyRecognized = hasRecognized;
    onSourceImageChange({ assetId: picked.assetId ?? null, uri: picked.uri });
    setHasRecognized(false);
    // On-device OCR may be unavailable on some hardware (e.g. very old devices
    // or certain Android builds). Fall back to manual entry: show the selected
    // screenshot so the user can reference it while filling the form, and
    // surface the reason instead of a confusing engine error — the recognizer
    // throws RecognitionUnsupportedError for exactly that case, and
    // `recognizeScreenshot` catches it into `ocrUnsupported`.
    // The picker already decoded the image, so hand its pixel dimensions to the
    // recognizer instead of the recognizer re-decoding just to read them.
    const outcome = await recognizeScreenshot(
      picked.uri,
      picked.width,
      picked.height,
    );
    if (outcome === "declined" && isMountedRef.current) {
      // Put back what the user chose to keep: the screenshot they had, and the
      // badge that describes the fields still on the form.
      onSourceImageChange(previous);
      setHasRecognized(previouslyRecognized);
    }
  };

  const badgeLabel = isRecognizing
    ? t("accountScreenshot.recognizing")
    : hasRecognized
      ? t("accountScreenshot.recognized")
      : t("accountScreenshot.screenshotReady");

  return (
    <>
      {sourceImage ? (
        // With a screenshot selected, the image renders through MediaViewer:
        // tapping the thumbnail opens a fullscreen pinch-to-zoom viewer so the
        // user can verify the auto-filled name/last-four/balance against the
        // screenshot — it does NOT re-open the picker. Replacing the screenshot
        // is a separate button on the overlay so inspect and replace don't
        // share one tap. The overlay is `box-none`, so taps pass through to the
        // thumbnail everywhere except on the replace button itself.
        <View style={styles.previewCard}>
          <ScreenshotMediaViewer uri={sourceImage.uri} />
          {/* No scrim over the image: the user is about to check the form
              against exactly this picture, and a dimmed screenshot is a
              harder one to read. The badge and the button carry their own
              opaque surfaces instead. */}
          <View style={styles.overlayLayer} pointerEvents="box-none">
            <View style={styles.readyBadge} pointerEvents="none">
              {isRecognizing ? (
                <ActivityIndicator color={COLORS.brand} size="small" />
              ) : (
                <Icon name="check" size={14} color={COLORS.brand} />
              )}
              <Text style={styles.readyBadgeText}>{badgeLabel}</Text>
            </View>
            <IconButton
              accessibilityHint={t("accountScreenshot.replaceScreenshotHint")}
              accessibilityLabel={t("accountScreenshot.replaceScreenshot")}
              disabled={isRecognizing}
              name="arrow-up"
              onPress={pickImage}
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
          onPress={pickImage}
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
          accessibilityLabel={t("accountScreenshot.uploadScreenshot")}
          accessibilityRole="button"
          disabled={isRecognizing}
          onPress={pickImage}
          style={({ pressed }) => [
            styles.uploadCard,
            pressed && screenStyles.pressed,
          ]}
        >
          <View style={styles.uploadContent}>
            <View style={styles.uploadIcon}>
              <Icon name="arrow-up" size="lg" color={COLORS.brand} />
            </View>
            <Text style={styles.uploadTitle}>
              {t("accountScreenshot.uploadScreenshot")}
            </Text>
            <Text style={styles.uploadDescription}>
              {t("accountScreenshot.screenshotGuidance")}
            </Text>
            <View style={styles.uploadAction}>
              <Text style={styles.uploadActionText}>
                {t("accountScreenshot.chooseScreenshot")}
              </Text>
            </View>
          </View>
        </Pressable>
      )}
      {issue ? (
        <View style={styles.errorRow}>
          <Text accessibilityLiveRegion="polite" style={screenStyles.errorHint}>
            {t(ISSUE_MESSAGE_KEY[issue])}
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
      <PrivacyNote message={t("accountScreenshot.screenshotPrivacy")} />
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
