import { useCallback, useState } from "react";

import { type SelectedSourceImage } from "@/components/AccountScreenshotUploader";

// Post-save routing for a form that may have been filled from a screenshot:
// offer to clean the screenshot up when one was used, otherwise head straight
// back to the overview — and in either case leave for the overview once the
// cleanup dialog is done. The add- and edit-account screens run exactly this
// sequence, so it lives here with the modal it drives instead of being restated
// per screen, where the two copies could answer "what happens after a save that
// used a screenshot" differently.
//
// Call `finishSave()` on the save success path and spread `cleanupProps` onto
// `<SourceImageCleanupModal>`; the modal stays mounted and only toggles.
export function useSourceImageCleanup(
  sourceImage: SelectedSourceImage | null,
  returnToOverview: () => void,
) {
  const [visible, setVisible] = useState(false);

  const finishSave = useCallback(() => {
    if (sourceImage) {
      setVisible(true);
      return;
    }
    returnToOverview();
  }, [sourceImage, returnToOverview]);

  const onFinished = useCallback(() => {
    setVisible(false);
    returnToOverview();
  }, [returnToOverview]);

  return { finishSave, cleanupProps: { visible, sourceImage, onFinished } };
}
