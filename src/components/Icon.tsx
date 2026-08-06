import {
  ArrowUp,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Minus,
  Plus,
  Settings,
  TrendingDown,
  TrendingUp,
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
  settings: Settings,
  minus: Minus,
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
};

export function Icon({ name, size = "md", color }: IconProps) {
  const Glyph = ICONS[name];
  const resolvedSize = typeof size === "number" ? size : SIZE[size];
  const resolvedColor = color ?? COLORS.ink;

  return <Glyph color={resolvedColor} size={resolvedSize} />;
}
