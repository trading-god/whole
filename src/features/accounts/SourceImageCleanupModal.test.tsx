import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, screen } from "@testing-library/react-native";

import { SourceImageCleanupModal } from "@/features/accounts/SourceImageCleanupModal";
import { deferred } from "@/test-support/deferred";
import { renderWithProviders } from "@/test-support/render";

const mockDeleteSourceImages = jest.fn<
  (assetIds: readonly string[]) => Promise<{
    ok: boolean;
    reason?: "permission";
  }>
>();

jest.mock("@/features/assets/source-image-cleanup", () => ({
  sourceImageDeletionIsSupported: true,
  deleteSourceImages: (assetIds: readonly string[]) =>
    mockDeleteSourceImages(assetIds),
}));

const ONE_IMAGE = [{ assetId: "photo-1", uri: "file:///photo.png" }];

beforeEach(() => {
  jest.clearAllMocks();
});

describe("SourceImageCleanupModal", () => {
  it("keeps the secondary action and marks deletion as destructive", async () => {
    const { toJSON } = await renderWithProviders(
      <SourceImageCleanupModal
        visible
        sourceImages={ONE_IMAGE}
        savedCount={1}
        onFinished={jest.fn()}
      />,
    );

    expect(screen.getByText("Keep screenshot")).toBeOnTheScreen();
    expect(screen.getByText("Delete screenshot")).toBeOnTheScreen();
    expect(JSON.stringify(toJSON())).toContain('"backgroundColor":"#C7443E"');
  });

  it("shows guarded loading while deleting the system photo", async () => {
    const pending = deferred<{ ok: boolean }>();
    mockDeleteSourceImages.mockReturnValue(pending.promise);
    const onFinished = jest.fn();
    await renderWithProviders(
      <SourceImageCleanupModal
        visible
        sourceImages={ONE_IMAGE}
        savedCount={1}
        onFinished={onFinished}
      />,
    );

    const deleteLabel = screen.getByText("Delete screenshot");
    await fireEvent.press(deleteLabel);

    expect(mockDeleteSourceImages).toHaveBeenCalledWith(["photo-1"]);
    expect(screen.getByTestId("button-spinner")).toBeOnTheScreen();
    expect(deleteLabel.parent?.props.accessibilityState).toEqual({
      busy: true,
      disabled: true,
    });
    expect(
      screen.getByText("Keep screenshot").parent?.props.accessibilityState,
    ).toEqual({ disabled: true });
    await fireEvent.press(deleteLabel.parent!);
    expect(mockDeleteSourceImages).toHaveBeenCalledTimes(1);

    await act(() => {
      pending.resolve({ ok: true });
    });

    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  // The batch case: one prompt, one delete, one system confirmation. Asking per
  // screenshot would put the user through five dialogs for a five-screenshot
  // sitting and leave a cancel partway through impossible to reason about.
  it("deletes a whole batch in one call", async () => {
    mockDeleteSourceImages.mockResolvedValue({ ok: true });
    const onFinished = jest.fn();
    await renderWithProviders(
      <SourceImageCleanupModal
        visible
        sourceImages={[
          { assetId: "photo-1", uri: "file:///a.png" },
          // No assetId: the Android PhotoPicker returns none, and this app
          // cannot delete what it cannot address. It must not be counted in
          // what the dialog offers to delete.
          { assetId: null, uri: "file:///b.png" },
          { assetId: "photo-3", uri: "file:///c.png" },
        ]}
        savedCount={4}
        onFinished={onFinished}
      />,
    );

    expect(screen.getByText("4 accounts saved")).toBeOnTheScreen();
    await fireEvent.press(screen.getByText("Delete all 2"));

    expect(mockDeleteSourceImages).toHaveBeenCalledWith(["photo-1", "photo-3"]);
    expect(onFinished).toHaveBeenCalledTimes(1);
  });
});
