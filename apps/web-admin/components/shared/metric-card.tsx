import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type MetricCardProps = {
  label: string;
  value: string;
  hint?: string;
  trend?: {
    value: string;
    direction: "up" | "down" | "flat";
  };
  className?: string;
};

export function MetricCard({ label, value, hint, trend, className }: MetricCardProps) {
  const TrendIcon = trend?.direction === "up" ? ArrowUpRight : trend?.direction === "down" ? ArrowDownRight : Minus;
  const trendToneClassName =
    trend?.direction === "up"
      ? "text-[var(--success-strong)]"
      : trend?.direction === "down"
        ? "text-[var(--destructive-strong)]"
        : "text-muted-foreground";

  return (
    <Card className={cn("bg-[color:color-mix(in_srgb,var(--surface-1)_96%,var(--surface-2)_4%)] shadow-none", className)}>
      <CardHeader className="gap-1 pb-1.5">
        <CardTitle className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-1.5">
        <strong className="text-[1.35rem] font-semibold leading-none tracking-[-0.025em] text-foreground">{value}</strong>
        {trend || hint ? (
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12.5px]">
            {trend ? (
              <span className={cn("inline-flex items-center gap-1 font-medium", trendToneClassName)}>
                <TrendIcon className="size-3.5" />
                {trend.value}
              </span>
            ) : null}
            {hint ? <p className="text-[12.5px] leading-5 text-muted-foreground">{hint}</p> : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
