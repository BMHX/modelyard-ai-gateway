"use client";

import { Link } from "@/i18n/navigation";
import { ArrowRight } from "lucide-react";

import { StatusBadge } from "@/components/shared/status-badge";
import { useT } from "@/app/lib/i18n-client";
import { cn } from "@/lib/utils";

export type ActionCenterStat = {
  label: string;
  value: string;
  hint: string;
  tone?: "critical" | "warning" | "neutral";
};

export type ActionCenterItem = {
  title: string;
  description: string;
  href: string;
  ctaLabel: string;
  tone: "critical" | "warning" | "neutral";
  badgeLabel?: string;
};

function getToneStatus(tone: ActionCenterItem["tone"]) {
  if (tone === "critical") {
    return "critical" as const;
  }

  if (tone === "warning") {
    return "warning" as const;
  }

  return "default" as const;
}

function getStatToneClassName(tone: ActionCenterStat["tone"] = "neutral") {
  if (tone === "critical") {
    return "text-[var(--destructive-strong)]";
  }

  if (tone === "warning") {
    return "text-warning";
  }

  return "text-foreground";
}

function getLeadRowClassName(tone: ActionCenterItem["tone"]) {
  if (tone === "critical") {
    return "border-l border-l-destructive/45 bg-[color:color-mix(in_srgb,var(--destructive-soft)_20%,var(--surface-1)_80%)]";
  }

  if (tone === "warning") {
    return "border-l border-l-warning/45 bg-[color:color-mix(in_srgb,var(--warning-soft)_20%,var(--surface-1)_80%)]";
  }

  return "border-l border-l-border/55";
}

function getToneDotClassName(tone: ActionCenterItem["tone"]) {
  if (tone === "critical") {
    return "bg-destructive";
  }

  if (tone === "warning") {
    return "bg-warning";
  }

  return "bg-foreground/28";
}

export function ActionCenter({
  title,
  description,
  stats,
  statsLayout = "grid",
  items,
  primaryItemsTitle,
  secondaryItems,
  secondaryItemsTitle,
  mobileMaxItems,
  badgeLabel,
  footerAction,
}: {
  title: string;
  description?: string;
  stats?: ActionCenterStat[];
  statsLayout?: "grid" | "inline";
  items: ActionCenterItem[];
  primaryItemsTitle?: string;
  secondaryItems?: ActionCenterItem[];
  secondaryItemsTitle?: string;
  mobileMaxItems?: number;
  badgeLabel?: string | null;
  footerAction?: {
    label: string;
    href: string;
  } | null;
}) {
  const t = useT("home");

  return (
    <section className="motion-enter motion-enter-fast space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-foreground">
            {title}
          </h2>
          {description ? (
            <p className="max-w-[60ch] text-[13px] leading-5 text-muted-foreground sm:text-sm sm:leading-6">
              {description}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {badgeLabel ? (
            <StatusBadge className="min-h-5 px-2 py-0 text-[11px]" status="default">
              {badgeLabel}
            </StatusBadge>
          ) : null}

          {footerAction ? (
            <Link
              className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground sm:text-sm"
              href={footerAction.href}
            >
              {footerAction.label}
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          ) : null}
        </div>
      </div>

      {stats?.length ? (
        <div
          className={cn(
            "flex flex-wrap gap-3",
            statsLayout === "inline" ? "pb-1" : "pb-0",
          )}
        >
          {stats.map((stat, index) => (
            <div className={cn("motion-enter motion-enter-fast min-w-[10rem] flex-1 basis-[10rem]", index === 0 ? "motion-delay-1" : "motion-delay-2")} key={stat.label}>
              <div className="flex items-baseline gap-2">
                <p className="text-[11px] font-medium text-muted-foreground">
                  {stat.label}
                </p>
                <p
                  className={cn(
                    "text-[14px] font-semibold tracking-[-0.02em]",
                    getStatToneClassName(stat.tone),
                  )}
                >
                  {stat.value}
                </p>
              </div>
              <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
                {stat.hint}
              </p>
            </div>
          ))}
        </div>
      ) : null}

      <div className="space-y-0.5 border-t border-border/30 pt-3 text-sm">
        <p className="text-[11px] font-medium text-muted-foreground">
          {primaryItemsTitle ?? t("inbox.primaryItemsTitle")}
        </p>
        <div className="space-y-2">
          {items.map((item, index) => (
            <Link
              className={cn(
                "motion-enter motion-enter-fast group flex flex-col gap-2 border-b border-border/30 px-3 py-3 transition-colors last:border-b-0 sm:flex-row sm:items-center sm:justify-between",
                index === 0 ? "motion-delay-1" : "motion-delay-2",
                index === 0 && getLeadRowClassName(item.tone),
                mobileMaxItems && index >= mobileMaxItems && "hidden sm:flex",
              )}
              href={item.href}
              key={`${item.title}-${item.href}`}
            >
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      getToneDotClassName(item.tone),
                    )}
                  />
                  <strong className="text-[14px] font-semibold tracking-tight text-foreground sm:text-[15px]">
                    {item.title}
                  </strong>
                  <span className="text-[11px] font-medium text-muted-foreground">
                    {item.badgeLabel ??
                      (index === 0
                        ? item.tone === "critical"
                          ? t("inbox.badge.critical")
                          : t("inbox.open")
                        : item.tone === "warning"
                          ? t("inbox.badge.warning")
                          : t("inbox.badge.neutral"))}
                  </span>
                </div>
                <p className="max-w-[58ch] text-[13px] leading-5 text-muted-foreground sm:text-sm sm:leading-6">
                  {item.description}
                </p>
              </div>

              <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground transition-colors group-hover:text-foreground sm:text-right sm:text-sm">
                {item.ctaLabel}
                <ArrowRight aria-hidden="true" className="size-4" />
              </span>
            </Link>
          ))}
        </div>
      </div>

      {secondaryItems?.length ? (
        <div className="space-y-2.5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] font-medium text-muted-foreground">
              {secondaryItemsTitle ?? t("inbox.secondaryItemsTitle")}
            </p>
          </div>

          <div className="overflow-hidden rounded-lg border border-border/40 bg-[color:color-mix(in_srgb,var(--surface-1)_95%,var(--surface-canvas)_5%)]">
            {secondaryItems.map((item, index) => (
              <Link
                className={cn(
                  "motion-enter motion-enter-fast group grid gap-2.5 p-3 transition-colors sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center",
                  index === 0 ? "motion-delay-1" : "motion-delay-2",
                  index > 0 &&
                    "border-t border-border/50 hover:bg-[color:color-mix(in_srgb,var(--surface-2)_82%,var(--surface-1)_18%)]",
                )}
                href={item.href}
                key={`${item.title}-${item.href}`}
              >
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        "size-1.5 rounded-full",
                        getToneDotClassName(item.tone),
                      )}
                    />
                    <strong className="text-[13px] font-medium tracking-tight text-foreground sm:text-sm">
                      {item.title}
                    </strong>
                    <StatusBadge
                      className="min-h-5 px-2 py-0 text-[10px]"
                      status={getToneStatus(item.tone)}
                    >
                      {item.badgeLabel ??
                        (item.tone === "warning"
                          ? t("inbox.badge.warning")
                          : item.tone === "critical"
                            ? t("inbox.badge.critical")
                            : t("inbox.badge.neutral"))}
                    </StatusBadge>
                  </div>
                  <p className="max-w-[60ch] text-[12px] leading-5 text-muted-foreground sm:text-[13px]">
                    {item.description}
                  </p>
                </div>

                <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground transition-colors group-hover:text-foreground sm:text-[13px]">
                  {item.ctaLabel}
                  <ArrowRight aria-hidden="true" className="size-4" />
                </span>
              </Link>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
