import type * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const statusVariants = cva("", {
  variants: {
    status: {
      default: "border-border/55 bg-[color:color-mix(in_srgb,var(--surface-1)_92%,var(--surface-2)_8%)] text-foreground/74",
      active: "border-success/18 bg-success/[0.07] text-[color:var(--success-strong)]",
      healthy: "border-success/18 bg-success/[0.07] text-[color:var(--success-strong)]",
      scoped: "border-info/18 bg-info/[0.08] text-[color:var(--info-strong)]",
      setup: "border-border/50 bg-transparent text-foreground/68",
      warning: "border-warning/18 bg-warning/[0.08] text-[color:var(--warning-strong)]",
      paused: "border-border/45 bg-transparent text-foreground/60",
      draft: "border-border/45 bg-transparent text-foreground/58",
      error: "border-destructive/22 bg-destructive/[0.09] text-[var(--destructive-strong)]",
      critical: "border-destructive/28 bg-destructive/[0.12] text-[var(--destructive-strong)]",
    },
  },
  defaultVariants: {
    status: "default",
  },
});

const indicatorVariants = cva("shrink-0 rounded-full", {
  variants: {
    status: {
      default: "size-[4px] bg-foreground/28",
      active: "size-[5px] bg-success/82",
      healthy: "size-[5px] bg-success/82",
      scoped: "size-[5px] bg-info/82",
      setup: "size-[4px] bg-foreground/30",
      warning: "size-[5px] bg-warning/82",
      paused: "size-[4px] bg-foreground/24",
      draft: "size-[4px] bg-foreground/22",
      error: "size-[5px] bg-destructive/82",
      critical: "size-[6px] bg-destructive",
    },
  },
  defaultVariants: {
    status: "default",
  },
});

type StatusBadgeProps = React.ComponentProps<typeof Badge> &
  VariantProps<typeof statusVariants> & {
    indicator?: boolean;
  };

export function StatusBadge({ className, status, indicator = false, children, ...props }: StatusBadgeProps) {
  return (
    <Badge
      className={cn(
        "min-h-[20px] gap-1 whitespace-nowrap px-2 py-0.5 text-[10.5px] normal-case tracking-[0.01em] shadow-none",
        statusVariants({ status }),
        className,
      )}
      variant="outline"
      {...props}
    >
      {indicator ? <span aria-hidden="true" className={indicatorVariants({ status })} /> : null}
      {children}
    </Badge>
  );
}
