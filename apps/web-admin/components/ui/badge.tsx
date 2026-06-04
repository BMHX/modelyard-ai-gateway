import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex min-h-5 items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-medium leading-4 whitespace-nowrap tracking-[0.01em] transition-[border-color,background-color,color]",
  {
    variants: {
      variant: {
        default: "border-border/55 bg-[color:color-mix(in_srgb,var(--surface-1)_92%,var(--surface-2)_8%)] text-foreground/78",
        secondary: "border-border/45 bg-transparent text-foreground/62",
        outline: "border-border/60 bg-transparent text-foreground/70",
        success: "border-success/22 bg-success/[0.08] text-[color:var(--success-strong)]",
        warning: "border-warning/18 bg-warning/[0.08] text-[color:var(--warning-strong)]",
        destructive: "border-destructive/24 bg-destructive/[0.1] text-[var(--destructive-strong)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
