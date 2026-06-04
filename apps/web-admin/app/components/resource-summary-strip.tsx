"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type ResourceSummaryStripItem = {
  id?: string;
  label: string;
  value: string | ReactNode;
  meta?: string;
  href?: string;
  onClick?: () => void;
  active?: boolean;
  tone?: "default" | "warning";
  ariaLabel?: string;
  title?: string;
  featured?: boolean;
};

type ResourceSummaryStripProps = {
  items: ResourceSummaryStripItem[];
  className?: string;
  columnsClassName?: string;
};

export function ResourceSummaryStrip({
  items,
  className,
  columnsClassName,
}: ResourceSummaryStripProps) {
  if (!items.length) {
    return null;
  }

  return (
    <section className={cn("text-xs text-muted-foreground", className)}>
      <div
        className={cn(
          "grid gap-2 sm:grid-cols-2 xl:grid-cols-4",
          columnsClassName,
        )}
      >
        {items.map((item, index) => {
          const key =
            item.id ??
            [item.label, item.href, item.meta, item.ariaLabel, index]
              .filter((value) => value !== undefined && value !== null && value !== "")
              .join("::");
          const title = item.title ?? [item.label, item.meta].filter(Boolean).join(" · ");
          const classes = cn(
            "motion-surface motion-enter motion-enter-fast flex min-w-0 flex-col gap-1 rounded-lg border px-3 py-2.5 transition-[border-color,background-color,color,box-shadow]",
            index === 1 && "motion-delay-1",
            index >= 2 && "motion-delay-2",
            item.href
              ? "border-border/50 bg-[color:color-mix(in_srgb,var(--surface-1)_95%,var(--surface-canvas)_5%)] hover:border-border/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              : "border-border/40 bg-[color:color-mix(in_srgb,var(--surface-1)_93%,var(--surface-canvas)_7%)] text-foreground",
            item.active &&
              "border-border/70 bg-[color:color-mix(in_srgb,var(--surface-selected)_10%,var(--surface-1)_90%)] -translate-y-px",
            item.featured && !item.href &&
              "border-border/70 bg-[color:color-mix(in_srgb,var(--surface-1)_91%,var(--surface-2)_9%)]",
          );

          const content = (
            <>
              <span className="flex items-baseline justify-between gap-3">
                <span
                  className="truncate text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/86"
                  title={item.label}
                >
                  {item.label}
                </span>
                <span
                  className={cn(
                    "font-semibold tracking-[-0.02em] text-foreground",
                    item.featured ? "text-[18px]" : "text-[15px]",
                    item.tone === "warning" && "text-[color:var(--warning-strong)]",
                  )}
                >
                  {item.value}
                </span>
              </span>
              {item.meta ? (
                <span className="truncate text-[11.5px] text-muted-foreground" title={item.meta}>
                  {item.meta}
                </span>
              ) : null}
            </>
          );

          if (!item.href) {
            if (item.onClick) {
              return (
                <button
                  aria-label={item.ariaLabel}
                  className={classes}
                  key={key}
                  onClick={item.onClick}
                  title={title || undefined}
                  type="button"
                >
                  {content}
                </button>
              );
            }

            return (
              <div aria-label={item.ariaLabel} className={classes} key={key} title={title || undefined}>
                {content}
              </div>
            );
          }

          return (
            <Link
              aria-current={item.active ? "page" : undefined}
              aria-label={item.ariaLabel}
              className={classes}
              href={item.href}
              key={key}
              title={title || undefined}
            >
              {content}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
