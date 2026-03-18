import { Text, View } from "react-native";
import {
    getFleetStatusLabel,
    getStatusVariant,
    getTrackingStatusLabel,
    getTripStatusLabel,
    type StatusType,
} from "../store/busStatus";

type StatusBadgeSize = "sm" | "md";

type StatusBadgeProps = {
  statusType: StatusType;
  statusCode: unknown;
  size?: StatusBadgeSize;
  showDot?: boolean;
};

const containerByVariant: Record<string, string> = {
  success: "border-emerald-200 bg-emerald-50",
  warning: "border-amber-200 bg-amber-50",
  danger: "border-red-200 bg-red-50",
  neutral: "border-slate-200 bg-slate-100",
  muted: "border-slate-200 bg-slate-100",
};

const textByVariant: Record<string, string> = {
  success: "text-emerald-700",
  warning: "text-amber-700",
  danger: "text-red-700",
  neutral: "text-slate-700",
  muted: "text-slate-600",
};

const dotByVariant: Record<string, string> = {
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-red-500",
  neutral: "bg-slate-500",
  muted: "bg-slate-400",
};

const sizeClasses: Record<StatusBadgeSize, { container: string; text: string; dot: string }> = {
  sm: {
    container: "px-2.5 py-1",
    text: "text-[11px]",
    dot: "h-1.5 w-1.5",
  },
  md: {
    container: "px-3 py-1.5",
    text: "text-xs",
    dot: "h-2 w-2",
  },
};

const getStatusLabel = (statusType: StatusType, statusCode: unknown): string => {
  if (statusType === "fleetStatus") {
    return getFleetStatusLabel(statusCode);
  }

  if (statusType === "tripStatus") {
    return getTripStatusLabel(statusCode);
  }

  return getTrackingStatusLabel(statusCode);
};

export default function StatusBadge({
  statusType,
  statusCode,
  size = "sm",
  showDot = true,
}: StatusBadgeProps) {
  const variant = getStatusVariant(statusType, statusCode);
  const text = getStatusLabel(statusType, statusCode);
  const classes = sizeClasses[size];

  return (
    <View
      className={`flex-row items-center rounded-full border ${containerByVariant[variant]} ${classes.container}`}
    >
      {showDot ? <View className={`mr-1.5 rounded-full ${dotByVariant[variant]} ${classes.dot}`} /> : null}
      <Text className={`font-semibold ${textByVariant[variant]} ${classes.text}`}>{text}</Text>
    </View>
  );
}
