import { Asset, requestPermissionsAsync } from "expo-media-library";
import { Platform } from "react-native";

// expo-image-picker and expo-media-library disagree on what an asset id is:
// on Android the picker returns a numeric media-store id (or `null` on the
// Android 13+ PhotoPicker) while `new Asset(id)` requires a `content://` URI,
// so deletion isn't supported there. On iOS the picker returns the bare
// `PHAsset` localIdentifier, but `new Asset(id)` expects the `ph://<id>` form
// (it strips the scheme to recover the localIdentifier) — passing the bare id
// truncates it and the asset can't be resolved. We re-attach the scheme before
// deleting.
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
    // `Asset(id)` expects `ph://<localIdentifier>`; expo-image-picker returns
    // the bare localIdentifier. Re-attach the scheme or the id is truncated
    // and the PHAsset can't be resolved for deletion.
    const assetRef = assetId.startsWith("ph://") ? assetId : `ph://${assetId}`;
    await new Asset(assetRef).delete();
    return { ok: true };
  } catch {
    // A thrown delete covers the remaining failure modes: the asset id didn't
    // resolve to a PHAsset (e.g. the user revoked access), or the user
    // cancelled the system "Delete Photo" confirmation. Surface as a generic
    // failure.
    return { ok: false };
  }
}
