import type * as React from "react";
import { Inbox } from "lucide-react";

import { cn } from "@/lib/utils";

type EmptyStateProps = {
  title: string;
  description: string;
  action?: React.ReactNode;
  className?: string;
  compact?: boolean;
};

export function EmptyState({ title, description, action, className, compact = false }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "grid gap-3 rounded-xl border border-[color:var(--border-default)] bg-[color:color-mix(in_srgb,var(--surface-1)_96%,var(--surface-canvas)_4%)] text-left",
        compact ? "p-4" : "p-5",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <span className="inline-flex size-8 items-center justify-center rounded-lg border border-[color:var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--surface-2)_70%,var(--surface-1)_30%)] text-muted-foreground">
          <Inbox className="size-4" />
        </span>
        <div className="grid gap-1">
          <strong className="text-[14px] font-semibold tracking-[-0.015em] text-foreground">{title}</strong>
          <p className="text-[13px] leading-5 text-muted-foreground">{description}</p>
        </div>
      </div>
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}
