import { Redirect } from "expo-router";
import { useTranslation } from "react-i18next";
import { SafeAreaView } from "react-native-safe-area-context";

import { AccountScreenshotCapture } from "@/components/AccountScreenshotCapture";
import { ScreenHeader } from "@/components/ScreenHeader";
import { screenStyles } from "@/theme/screen-styles";

// Dev-only OCR regression-fixture capture screen. Expo Router auto-discovers
// `app/dev/` files, so the route exists in production bundles — the `__DEV__`
// guard below bounces any deep-linked production visit. The embedded
// `AccountScreenshotCapture` handles the real on-device pipeline and copying
// the two fixture files.
export default function OcrCaptureScreen() {
  const { t } = useTranslation();

  if (!__DEV__) {
    return <Redirect href="/" />;
  }
  return (
    <SafeAreaView style={screenStyles.safeArea}>
      <ScreenHeader title={t("devOcr.screenTitle")} />
      <AccountScreenshotCapture />
    </SafeAreaView>
  );
}
