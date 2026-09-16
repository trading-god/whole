import { useCallback, useState } from "react";

import { type SelectedSourceImage } from "@/features/accounts/AccountScreenshotUploader";

// Post-save routing for a form that may have been filled from screenshots:
// offer to clean them up when any were used, otherwise head straight back to
// the overview — and in either case leave for the overview once the cleanup
// dialog is done. The add- and edit-account screens run exactly this sequence,
// so it lives here with the modal it drives instead of being restated per
// screen, where the two copies could answer "what happens after a save that
// used a screenshot" differently.
//
// `sourceImages` is a LIST because the add screen recognizes a batch; the edit
// screen's single screenshot is the one-element case, so both screens share one
// rule rather than one of them growing a second.
//
// Call `finishSave(savedCount)` on the save success path and spread
// `cleanupProps` onto `<SourceImageCleanupModal>`; the modal stays mounted and
// only toggles. `savedCount` is the number of accounts written, which is what
// the dialog announces — it is passed at finish time rather than held here
// because only the save knows it.
export function useSourceImageCleanup(
  sourceImages: readonly SelectedSourceImage[],
  returnToOverview: () => void,
) {
  const [savedCount, setSavedCount] = useState(0);

  const finishSave = useCallback(
    (count: number) => {
      if (sourceImages.length > 0) {
        setSavedCount(count);
        return;
      }
      returnToOverview();
    },
    [sourceImages, returnToOverview],
  );

  const onFinished = useCallback(() => {
    setSavedCount(0);
    returnToOverview();
  }, [returnToOverview]);

  // Visibility is derived from `savedCount` rather than tracked beside it: a
  // save always writes at least one account, so "a save has finished" and "the
  // dialog is up" are the same fact, and holding them as two booleans is how
  // they come to disagree.
  return {
    finishSave,
    cleanupProps: {
      visible: savedCount > 0,
      sourceImages,
      savedCount,
      onFinished,
    },
  };
}
