import { Platform, type ViewStyle } from "react-native";

import { COLORS } from "./colors";

// iOS renders `shadow*` props and has no `elevation`, so the `default` branch
// (shadow props) already covers it — no separate `ios` entry is needed.
export const ELEVATED_SHADOW = Platform.select({
  android: { elevation: 7 },
  default: {
    shadowColor: COLORS.brandShadow,
    shadowOffset: { width: 0, height: 7 },
    shadowOpacity: 0.17,
    shadowRadius: 12,
  },
}) as ViewStyle;
