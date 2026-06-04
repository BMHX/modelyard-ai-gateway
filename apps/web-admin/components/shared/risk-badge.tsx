import type * as React from "react";
import { AlertTriangle, ShieldCheck } from "lucide-react";

import { StatusBadge } from "@/components/shared/status-badge";

type RiskLevel = "low" | "medium" | "high" | "critical";

const riskCopy: Record<
  RiskLevel,
  {
    label: string;
    status: React.ComponentProps<typeof StatusBadge>["status"];
  }
> = {
  low: {
    label: "Stable",
    status: "healthy",
  },
  medium: {
    label: "Watch",
    status: "warning",
  },
  high: {
    label: "Watch",
    status: "error",
  },
  critical: {
    label: "Blocked",
    status: "critical",
  },
};

export function RiskBadge({
  level,
  children,
}: {
  level: RiskLevel;
  children?: React.ReactNode;
}) {
  const copy = riskCopy[level];
  const Icon = level === "low" ? ShieldCheck : AlertTriangle;

  return (
    <StatusBadge indicator status={copy.status}>
      <Icon className="size-3" />
      {children ?? copy.label}
    </StatusBadge>
  );
}
