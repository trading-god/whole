import { Asset, requestPermissionsAsync } from "expo-media-library";
import { Platform } from "react-native";

// expo-image-picker and expo-media-library disagree on what an asset id is on
// Android: the picker returns a numeric media-store id (or `null` on the
// Android 13+ PhotoPicker), but `new Asset(id)` requires a `content://` URI.
// Passing the picker's id therefore never deletes the screenshot, so we only
// claim support on iOS, where the picker returns a `PHAsset` localIdentifier
// that the `Asset` constructor accepts. The web build is overridden by
// `source-image-cleanup.web.ts`.
export const sourceImageDeletionIsSupported = Platform.OS === "ios";

export type DeleteSourceImageResult = {
  ok: boolean;
  // "permission" means iOS photo access is limited (or absent). Deleting a
  // PHAsset requires full access — PHPhotoLibrary rejects delete changes under
  // limited access — so the caller can guide the user to grant full access
  // instead of showing a generic failure.
  reason?: "permission";
};

export async function deleteSourceImage(
  assetId: string,
): Promise<DeleteSourceImageResult> {
  if (Platform.OS !== "ios") {
    return { ok: false };
  }

  const permission = await requestPermissionsAsync();

  // `granted` is true under both full and limited access, but deleting a
  // PHAsset requires full access — `performChanges{deleteAssets}` throws under
  // limited access. `accessPrivileges` is undefined on older iOS/Android (no
  // limited mode there), where `granted` already implies full access.
  const privileges = permission.accessPrivileges;
  const hasFullAccess =
    privileges === undefined ? permission.granted : privileges === "all";

  if (!hasFullAccess) {
    return { ok: false, reason: "permission" };
  }

  try {
    await new Asset(assetId).delete();
    return { ok: true };
  } catch {
    // A thrown delete covers the remaining failure modes: the picker's asset id
    // didn't resolve to a PHAsset, or the user cancelled the system "Delete
    // Photo" confirmation. Surface as a generic failure.
    return { ok: false };
  }
}
