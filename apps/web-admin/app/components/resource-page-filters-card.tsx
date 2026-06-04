import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { NavigationContextNotice } from "./navigation-context-notice";

type ResourcePageFiltersCardProps = {
  eyebrow?: string;
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
  returnTo?: string | null;
  returnHeadingPrefix?: string;
  className?: string;
  contentClassName?: string;
  variant?: "card" | "toolbar";
  busy?: boolean;
};

export function ResourcePageFiltersCard({
  eyebrow,
  title,
  actions,
  children,
  returnTo,
  returnHeadingPrefix = "Opened from",
  className,
  contentClassName,
  variant = "card",
  busy = false,
}: ResourcePageFiltersCardProps) {
  const isToolbar = variant === "toolbar";

  return (
    <section
      aria-busy={busy || undefined}
      className={cn(
        "motion-surface motion-enter rounded-2xl border bg-card transition-all duration-300 shadow-none",
        isToolbar
          ? "border-border/60 bg-muted/20 px-4 py-3 shadow-none"
          : "border-border/55 bg-muted/10",
        className,
      )}
      data-busy={busy ? "true" : "false"}
    >
      {(eyebrow || title || actions || returnTo) && (
        <div
          className={cn(
            "flex flex-col gap-4 border-b border-border/40",
            isToolbar
              ? "px-1 pb-3 sm:flex-row sm:items-center sm:justify-between"
              : "px-5 py-4 sm:flex-row sm:items-start sm:justify-between",
          )}
        >
          <div className="min-w-0 flex-1 space-y-1.5">
            {returnTo && (
              <div className="mb-2">
                <NavigationContextNotice
                  headingPrefix={returnHeadingPrefix}
                  returnTo={returnTo}
                  className="rounded-lg border-none bg-muted/40 px-2 py-1 text-[11px]"
                />
              </div>
            )}
            {eyebrow && (
              <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground/90">
                {eyebrow}
              </p>
            )}
            {title && (
              <h2 className="text-lg font-bold tracking-tight text-foreground">
                {title}
              </h2>
            )}
          </div>
          {actions && (
            <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end self-end sm:self-auto pt-1 sm:pt-0">
              {actions}
            </div>
          )}
        </div>
      )}
      <div
        className={cn(
          "min-w-0",
          isToolbar ? "px-0 pt-4 pb-1" : "px-5 py-5",
          contentClassName,
        )}
      >
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {children}
        </div>
      </div>
    </section>
  );
}
