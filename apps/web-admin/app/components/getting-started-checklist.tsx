"use client";

import { Link } from "@/i18n/navigation";
import { ArrowRight } from "lucide-react";

import { StatusBadge } from "@/components/shared/status-badge";
import { useLocalePreference, useT } from "@/app/lib/i18n-client";
import { cn } from "@/lib/utils";

export type GettingStartedChecklistItem = {
  title: string;
  description: string;
  href: string;
  ctaLabel: string;
  status: "done" | "next" | "pending";
};

export type GettingStartedChecklistTranslations = {
  statusLabels?: Record<GettingStartedChecklistItem["status"], string>;
  previewRemaining?: (count: number) => string;
};

function getStatusCopy(
  status: GettingStartedChecklistItem["status"],
  labelOverrides: Record<GettingStartedChecklistItem["status"], string>,
) {
  if (status === "done") {
    return {
      label: labelOverrides.done,
      badgeStatus: "healthy" as const,
      rowClassName: "hover:bg-[color:color-mix(in_srgb,var(--surface-2)_86%,var(--surface-1)_14%)]",
    };
  }

  if (status === "next") {
    return {
      label: labelOverrides.next,
      badgeStatus: "warning" as const,
      rowClassName: "border-l-2 border-l-warning bg-[color:color-mix(in_srgb,var(--surface-2)_89%,var(--warning-soft)_11%)] hover:bg-[color:color-mix(in_srgb,var(--surface-2)_85%,var(--warning-soft)_15%)]",
    };
  }

  return {
    label: labelOverrides.pending,
    badgeStatus: "default" as const,
    rowClassName: "hover:bg-[color:color-mix(in_srgb,var(--surface-2)_86%,var(--surface-1)_14%)]",
  };
}

export function GettingStartedChecklist({
  id,
  title,
  maxItems,
  mobileMaxItems,
  mode = "default",
  items,
  footerAction,
  translations,
}: {
  id?: string;
  title: string;
  maxItems?: number;
  mobileMaxItems?: number;
  mode?: "default" | "preview";
  items: GettingStartedChecklistItem[];
  footerAction?: {
    label: string;
    href: string;
  } | null;
  translations?: GettingStartedChecklistTranslations;
}) {
  const t = useT("home");
  const { locale } = useLocalePreference();
  const isZh = locale === "zh";
  const visibleItems = maxItems ? items.slice(0, maxItems) : items;
  const rawStatusLabels = translations?.statusLabels ?? {
    done: t("checklist.status.done"),
    next: t("checklist.status.next"),
    pending: t("checklist.status.pending"),
  };
  const statusLabels = {
    done:
      rawStatusLabels.done === "checklist.status.done"
        ? isZh
          ? "已完成"
          : "Done"
        : rawStatusLabels.done,
    next:
      rawStatusLabels.next === "checklist.status.next"
        ? isZh
          ? "下一项"
          : "Next"
        : rawStatusLabels.next,
    pending:
      rawStatusLabels.pending === "checklist.status.pending"
        ? isZh
          ? "待处理"
          : "Pending"
        : rawStatusLabels.pending,
  };
  const previewRemainingCount = visibleItems.filter((item) => item.status !== "done").length;
  const rawPreviewRemainingLabel =
    translations?.previewRemaining?.(previewRemainingCount) ??
    t("checklist.previewRemaining", { count: previewRemainingCount });
  const previewRemainingLabel =
    rawPreviewRemainingLabel === "checklist.previewRemaining"
      ? isZh
        ? `此列表中还剩 ${previewRemainingCount} 个条目。`
        : `${previewRemainingCount} items remaining in this list.`
      : rawPreviewRemainingLabel;

  return (
    <section className="space-y-3" id={id}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-foreground">
          {title}
        </h2>
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

      {mode === "preview" ? (
        <p className="max-w-[60ch] text-[13px] leading-5 text-muted-foreground sm:text-sm sm:leading-6">
          {previewRemainingLabel}
        </p>
      ) : null}

      <div className="overflow-hidden rounded-lg border border-border/45 bg-[color:color-mix(in_srgb,var(--surface-1)_90%,var(--surface-canvas)_10%)]">
        {visibleItems.map((item, index) => {
          const status = getStatusCopy(item.status, statusLabels);

          return (
            <Link
              className={cn(
                "group grid gap-3 p-3 transition-colors sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start sm:p-4",
                index > 0 && "border-t border-border/50",
                mobileMaxItems && index >= mobileMaxItems && "hidden sm:grid",
                status.rowClassName,
              )}
              href={item.href}
              key={`${item.title}-${item.href}`}
            >
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="text-[14px] font-semibold tracking-tight text-foreground sm:text-[15px]">
                    {item.title}
                  </strong>
                  <StatusBadge
                    className="min-h-5 px-2 py-0 text-[11px]"
                    status={status.badgeStatus}
                  >
                    {status.label}
                  </StatusBadge>
                </div>
                <p className="max-w-[60ch] text-[13px] leading-5 text-muted-foreground sm:text-sm sm:leading-6">
                  {item.description}
                </p>
              </div>

              <span className="inline-flex items-center gap-1.5 pt-0.5 text-[13px] font-medium text-muted-foreground transition-colors group-hover:text-foreground sm:text-right sm:text-sm">
                {item.ctaLabel}
                <ArrowRight aria-hidden="true" className="size-4" />
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
