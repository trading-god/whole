import {
  ArrowUp,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  LoaderCircle,
  Lock,
  EyeOff,
  Minus,
  Plus,
  Settings,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
} from "lucide-react-native";

import { COLORS } from "@/theme/colors";

const ICONS = {
  plus: Plus,
  eye: Eye,
  "eye-off": EyeOff,
  "trending-up": TrendingUp,
  "trending-down": TrendingDown,
  "chevron-down": ChevronDown,
  "chevron-left": ChevronLeft,
  "chevron-right": ChevronRight,
  check: Check,
  "arrow-up": ArrowUp,
  minus: Minus,
  settings: Settings,
  "loader-circle": LoaderCircle,
  lock: Lock,
  // The one screenshot in a batch that could not be read, badged on its own
  // thumbnail. A warning rather than an error mark: the rest of the batch
  // landed, so this is one thing to finish by hand, not a failed upload.
  "triangle-alert": TriangleAlert,
} as const;

export type IconName = keyof typeof ICONS;
export type IconSize = "sm" | "md" | "lg";

const SIZE: Record<IconSize, number> = {
  sm: 16,
  md: 20,
  lg: 24,
};

type IconProps = {
  name: IconName;
  size?: IconSize | number;
  color?: string;
  testID?: string;
};

export function Icon({ name, size = "md", color, testID }: IconProps) {
  const Glyph = ICONS[name];
  const resolvedSize = typeof size === "number" ? size : SIZE[size];
  const resolvedColor = color ?? COLORS.ink;

  return <Glyph color={resolvedColor} size={resolvedSize} testID={testID} />;
}
