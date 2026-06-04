"use client";

import type { ReactNode } from "react";
import { ResponsiveContainer } from "recharts";
import { cn } from "@/lib/utils";

type ChartContainerProps = {
  children: ReactNode;
  height?: number | string;
  className?: string;
  title?: string;
  description?: string;
};

export function ChartContainer({
  children,
  height = 160,
  className,
  title,
  description,
}: ChartContainerProps) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {(title || description) && (
        <div className="px-1">
          {title && (
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/80">
              {title}
            </h3>
          )}
          {description && (
            <p className="text-[10px] text-muted-foreground/60">{description}</p>
          )}
        </div>
      )}
      <div style={{ width: "100%", height }}>
        <ResponsiveContainer width="100%" height="100%">
          {children as any}
        </ResponsiveContainer>
      </div>
    </div>
  );
}
