import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, screen } from "@testing-library/react-native";

import { SourceImageCleanupModal } from "@/features/accounts/SourceImageCleanupModal";
import { deferred } from "@/test-support/deferred";
import { renderWithProviders } from "@/test-support/render";

const mockDeleteSourceImage =
  jest.fn<
    (assetId: string) => Promise<{ ok: boolean; reason?: "permission" }>
  >();

jest.mock("@/features/assets/source-image-cleanup", () => ({
  sourceImageDeletionIsSupported: true,
  deleteSourceImage: (assetId: string) => mockDeleteSourceImage(assetId),
}));

beforeEach(() => {
  jest.clearAllMocks();
});

describe("SourceImageCleanupModal", () => {
  it("keeps the secondary action and marks deletion as destructive", async () => {
    const { toJSON } = await renderWithProviders(
      <SourceImageCleanupModal
        visible
        sourceImage={{ assetId: "photo-1", uri: "file:///photo.png" }}
        onFinished={jest.fn()}
      />,
    );

    expect(screen.getByText("Keep screenshot")).toBeOnTheScreen();
    expect(screen.getByText("Delete screenshot")).toBeOnTheScreen();
    expect(JSON.stringify(toJSON())).toContain('"backgroundColor":"#C7443E"');
  });

  it("shows guarded loading while deleting the system photo", async () => {
    const pending = deferred<{ ok: boolean }>();
    mockDeleteSourceImage.mockReturnValue(pending.promise);
    const onFinished = jest.fn();
    await renderWithProviders(
      <SourceImageCleanupModal
        visible
        sourceImage={{ assetId: "photo-1", uri: "file:///photo.png" }}
        onFinished={onFinished}
      />,
    );

    const deleteLabel = screen.getByText("Delete screenshot");
    await fireEvent.press(deleteLabel);

    expect(mockDeleteSourceImage).toHaveBeenCalledWith("photo-1");
    expect(screen.getByTestId("button-spinner")).toBeOnTheScreen();
    expect(deleteLabel.parent?.props.accessibilityState).toEqual({
      busy: true,
      disabled: true,
    });
    expect(
      screen.getByText("Keep screenshot").parent?.props.accessibilityState,
    ).toEqual({ disabled: true });
    await fireEvent.press(deleteLabel.parent!);
    expect(mockDeleteSourceImage).toHaveBeenCalledTimes(1);

    await act(() => {
      pending.resolve({ ok: true });
    });

    expect(onFinished).toHaveBeenCalledTimes(1);
  });
});
