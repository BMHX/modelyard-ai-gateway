import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type ResourceTableSectionProps = {
  title?: string;
  meta?: ReactNode;
  actions?: ReactNode;
  bulkBar?: ReactNode;
  children?: ReactNode;
  emptyState?: ReactNode;
  className?: string;
  contentClassName?: string;
  busy?: boolean;
};

export function ResourceTableSection({
  title,
  meta,
  actions,
  bulkBar,
  children,
  emptyState,
  className,
  contentClassName,
  busy = false,
}: ResourceTableSectionProps) {
  const hasHeader = Boolean(title || meta || actions);
  const hasContent = children ?? emptyState;

  return (
    <section
      aria-label={title}
      aria-busy={busy || undefined}
      className={cn(
        "motion-surface motion-enter overflow-hidden rounded-xl border border-border/60 bg-[color:color-mix(in_srgb,var(--surface-1)_96%,var(--surface-canvas)_4%)]",
        className,
      )}
      data-busy={busy ? "true" : "false"}
      role="region"
    >
      {hasHeader ? (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0 space-y-0.5">
            {title ? (
              <p className="text-[13px] font-semibold tracking-[-0.015em] text-foreground">
                {title}
              </p>
            ) : null}
            {meta ? <div className="text-[12px] text-muted-foreground">{meta}</div> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}

      {bulkBar ? (
        <div className={cn("border-t border-border/60 px-4 py-3", !hasHeader && "border-t-0")}>
          {bulkBar}
        </div>
      ) : null}

      {hasContent ? (
        <div
          className={cn(
            "border-t border-border/60",
            !hasHeader && !bulkBar && "border-t-0",
            contentClassName,
          )}
        >
          {children ?? (
            <div aria-live="polite" className="min-h-[8rem]" role="status">
              {emptyState}
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
