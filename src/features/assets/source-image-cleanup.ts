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

export async function deleteSourceImage(assetId: string) {
  if (Platform.OS !== "ios") {
    return false;
  }

  const permission = await requestPermissionsAsync();

  if (!permission.granted) {
    return false;
  }

  await new Asset(assetId).delete();
  return true;
}
