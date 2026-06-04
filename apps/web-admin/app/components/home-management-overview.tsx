"use client";

import { Link } from "@/i18n/navigation";
import { ArrowRight } from "lucide-react";
import { motion } from "framer-motion";

export type Tone = "critical" | "warning" | "neutral";

export type ManagementKpiCard = {
  key: string;
  label: string;
  value: string;
  hint: string;
  tone?: Tone;
};

export type ManagementSummaryStatus = {
  key: string;
  label: string;
  count: number;
  total: number;
  tone: Tone;
};

export type ManagementSummaryProvider = {
  key: string;
  label: string;
  costUsd: number;
  totalCostUsd: number;
  valueLabel: string;
  tone: Tone;
};

export type ManagementTrendPoint = {
  bucketDate: string;
  label: string;
  requestCount: number;
  totalCostUsd: number;
  blockedCount: number;
  errorCount: number;
};

export type HomeRiskCard = {
  key: string;
  label: string;
  value: string;
  hint: string;
  ctaLabel: string;
  href: string;
  tone?: Tone;
};

function getToneColor(tone: Tone) {
  if (tone === "critical") {
    return "var(--destructive-strong)";
  }

  if (tone === "warning") {
    return "var(--warning)";
  }

  return "var(--foreground)";
}

function ProgressBar({
  percent,
  tone,
}: {
  percent: number;
  tone: Tone;
}) {
  return (
    <div className="relative h-1 w-full overflow-hidden rounded-full bg-foreground/10">
      <motion.div
        className="h-full rounded-full"
        style={{
          background: getToneColor(tone),
        }}
        initial={{ width: 0 }}
        whileInView={{ width: `${Math.min(Math.max(percent, 0), 100)}%` }}
        viewport={{ once: true, margin: "-40px" }}
        transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
      />
    </div>
  );
}

function SummaryPill({ label }: { label: string }) {
  return (
    <span className="rounded-full border border-border/60 px-3 py-1 text-foreground">
      {label}
    </span>
  );
}

function buildLinePath({
  points,
  width,
  height,
  left,
  top,
}: {
  points: { x: number; y: number }[];
  width: number;
  height: number;
  left: number;
  top: number;
}) {
  if (!points.length) {
    return "";
  }

  if (points.length === 1) {
    const point = points[0];
    return `M ${point.x} ${top + height / 2} L ${point.x + width} ${top + height / 2}`;
  }

  return points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");
}

export function ManagementKpiRow({ items }: { items: ManagementKpiCard[] }) {
  return (
    <section aria-label="management overview" className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
      {items.map((item, index) => (
        <div
          key={item.key}
          className={`motion-enter motion-enter-fast rounded-2xl border border-border/60 bg-[color:color-mix(in_srgb,var(--surface-2)_85%,var(--surface-1)_15%)] p-4 ${index === 0 ? "motion-delay-1" : index < 3 ? "motion-delay-2" : "motion-delay-3"}`}
        >
          <p className="text-[12px] font-medium uppercase tracking-[0.15em] text-muted-foreground">
            {item.label}
          </p>
          <div className="mt-3 space-y-1">
            <p
              className={`text-[24px] font-semibold tracking-tight ${
                item.tone === "critical"
                  ? "text-[var(--destructive-strong)]"
                  : item.tone === "warning"
                    ? "text-warning"
                    : "text-foreground"
              }`}
            >
              {item.value}
            </p>
            <p className="text-[13px] text-muted-foreground">{item.hint}</p>
          </div>
        </div>
      ))}
    </section>
  );
}

export function ManagementTrendPanel({
  title,
  description,
  chips,
  spendLegend,
  requestLegend,
  blockedLegend,
  errorLegend,
  emptyLabel,
  items,
}: {
  title: string;
  description: string;
  chips: string[];
  spendLegend: string;
  requestLegend: string;
  blockedLegend: string;
  errorLegend: string;
  emptyLabel: string;
  items: ManagementTrendPoint[];
}) {
  const width = 760;
  const height = 206;
  const chartLeft = 14;
  const chartRight = 14;
  const chartTop = 16;
  const chartBottom = 34;
  const plotWidth = width - chartLeft - chartRight;
  const plotHeight = height - chartTop - chartBottom;
  const requestAreaHeight = 60;
  const spendAreaHeight = plotHeight - requestAreaHeight - 10;
  const hasData = items.some(
    (item) =>
      item.requestCount > 0 ||
      item.totalCostUsd > 0 ||
      item.blockedCount > 0 ||
      item.errorCount > 0,
  );
  const maxRequests = Math.max(...items.map((item) => item.requestCount), 0);
  const maxSpend = Math.max(...items.map((item) => item.totalCostUsd), 0);
  const barSlotWidth = items.length > 0 ? plotWidth / items.length : plotWidth;
  const barWidth = Math.max(Math.min(barSlotWidth * 0.58, 18), 6);
  const chartPoints = items.map((item, index) => {
    const x = chartLeft + barSlotWidth * index + barSlotWidth / 2;
    const spendRatio = maxSpend > 0 ? item.totalCostUsd / maxSpend : 0;
    const requestRatio = maxRequests > 0 ? item.requestCount / maxRequests : 0;
    const lineY = chartTop + (spendAreaHeight - spendAreaHeight * spendRatio);
    const barHeight = requestAreaHeight * requestRatio;
    const barY = chartTop + spendAreaHeight + 10 + (requestAreaHeight - barHeight);

    return {
      ...item,
      x,
      lineY,
      barY,
      barHeight,
    };
  });
  const linePath = buildLinePath({
    points: chartPoints.map((point) => ({ x: point.x, y: point.lineY })),
    width: plotWidth,
    height: spendAreaHeight,
    left: chartLeft,
    top: chartTop,
  });

  return (
    <section className="motion-enter motion-enter-fast rounded-2xl border border-border/60 bg-[color:color-mix(in_srgb,var(--surface-2)_84%,var(--surface-1)_16%)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-foreground">
            {title}
          </h2>
          <p className="text-[13px] leading-5 text-muted-foreground">
            {description}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-[12px]">
          {chips.map((chip) => (
            <SummaryPill key={chip} label={chip} />
          ))}
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-border/45 bg-background/60 px-3 py-3">
        {hasData ? (
          <>
            <svg
              aria-hidden="true"
              className="h-[206px] w-full"
              preserveAspectRatio="none"
              viewBox={`0 0 ${width} ${height}`}
            >
              <line
                stroke="color-mix(in srgb, var(--border-default) 82%, transparent)"
                strokeWidth="1"
                x1={chartLeft}
                x2={width - chartRight}
                y1={chartTop + spendAreaHeight + 10}
                y2={chartTop + spendAreaHeight + 10}
              />
              {chartPoints.map((point, index) => (
                <g key={point.bucketDate}>
                  <motion.rect
                    fill="color-mix(in srgb, var(--foreground) 8%, transparent)"
                    rx="3"
                    width={barWidth}
                    x={point.x - barWidth / 2}
                    initial={{ height: 0, y: point.barY + Math.max(point.barHeight, point.requestCount > 0 ? 3 : 0) }}
                    whileInView={{ height: Math.max(point.barHeight, point.requestCount > 0 ? 3 : 0), y: point.barY }} viewport={{ once: true, margin: "-40px" }}
                    transition={{ duration: 1, ease: [0.16, 1, 0.3, 1], delay: index * 0.04 }}
                  />
                  {point.blockedCount > 0 ? (
                    <rect
                      fill="var(--destructive-strong)"
                      height="7"
                      rx="2"
                      width="4"
                      x={point.x - 6}
                      y={chartTop + spendAreaHeight - 4}
                    />
                  ) : null}
                  {point.errorCount > 0 ? (
                    <rect
                      fill="var(--warning)"
                      height="7"
                      rx="2"
                      width="4"
                      x={point.x + 2}
                      y={chartTop + spendAreaHeight - 4}
                    />
                  ) : null}
                </g>
              ))}
              {linePath ? (
                <motion.path
                  d={linePath}
                  fill="none"
                  stroke="var(--foreground)"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  initial={{ pathLength: 0, opacity: 0 }}
                  whileInView={{ pathLength: 1, opacity: 1 }} viewport={{ once: true, margin: "-40px" }}
                  transition={{ duration: 1.5, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
                />
              ) : null}
              {chartPoints.map((point, index) => (
                <motion.circle
                  key={`${point.bucketDate}-dot`}
                  cx={point.x}
                  cy={point.lineY}
                  fill="var(--surface-1)"
                  r="3"
                  stroke="var(--foreground)"
                  strokeWidth="1.5"
                  initial={{ scale: 0, opacity: 0 }}
                  whileInView={{ scale: 1, opacity: 1 }} viewport={{ once: true, margin: "-40px" }}
                  transition={{ duration: 0.5, ease: "backOut", delay: index * 0.04 + 0.5 }}
                />
              ))}
            </svg>
            <div className="mt-2 grid grid-cols-5 gap-2 text-[11px] text-muted-foreground sm:grid-cols-10">
              {chartPoints
                .filter((_, index) => index % Math.ceil(chartPoints.length / 5) === 0 || index === chartPoints.length - 1)
                .map((point) => (
                  <span key={`${point.bucketDate}-label`} className="truncate">
                    {point.label}
                  </span>
                ))}
            </div>
          </>
        ) : (
          <div className="flex h-[206px] items-center justify-center rounded-lg border border-dashed border-border/55 bg-background/35 text-sm text-muted-foreground">
            {emptyLabel}
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-[12px] text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-foreground" />
          {spendLegend}
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-foreground/35" />
          {requestLegend}
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-[var(--destructive-strong)]" />
          {blockedLegend}
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-warning" />
          {errorLegend}
        </span>
      </div>
    </section>
  );
}

export function ManagementSummaryBand({
  budgetLabel,
  budgetValue,
  budgetHint,
  budgetPills,
  statusItems,
  providerItems,
  requestLabel,
  requestMeta,
  providerLabel,
  providerMeta,
}: {
  budgetLabel: string;
  budgetValue: string;
  budgetHint: string;
  budgetPills: string[];
  statusItems: ManagementSummaryStatus[];
  providerItems: ManagementSummaryProvider[];
  requestLabel: string;
  requestMeta: string;
  providerLabel: string;
  providerMeta: string;
}) {
  return (
    <section className="motion-enter motion-enter-fast grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,0.9fr)]">
      <div className="rounded-2xl border border-border/60 bg-[color:color-mix(in_srgb,var(--surface-2)_85%,var(--surface-1)_15%)] p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          {budgetLabel}
        </p>
        <p className="mt-3 text-[24px] font-semibold text-foreground">{budgetValue}</p>
        <p className="mt-1 text-[13px] text-muted-foreground">{budgetHint}</p>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-[13px]">
          {budgetPills.map((pill) => (
            <SummaryPill key={pill} label={pill} />
          ))}
        </div>
      </div>

      <div className="space-y-3 rounded-2xl border border-border/60 bg-[color:color-mix(in_srgb,var(--surface-2)_82%,var(--surface-1)_18%)] p-4">
        <div className="flex items-center justify-between text-[14px] font-semibold text-foreground">
          <span>{requestLabel}</span>
          <span className="text-sm font-normal text-muted-foreground">{requestMeta}</span>
        </div>
        <div className="space-y-3">
          {statusItems.map((item) => (
            <div className="space-y-1" key={item.key}>
              <div className="flex items-center justify-between text-[12px] uppercase tracking-[0.3em] text-muted-foreground">
                <span>{item.label}</span>
                <span className="text-foreground">{item.count}</span>
              </div>
              <ProgressBar percent={(item.count / Math.max(item.total, 1)) * 100} tone={item.tone} />
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-3 rounded-2xl border border-border/60 bg-[color:color-mix(in_srgb,var(--surface-2)_82%,var(--surface-1)_18%)] p-4">
        <div className="flex items-center justify-between text-[14px] font-semibold text-foreground">
          <span>{providerLabel}</span>
          <span className="text-sm font-normal text-muted-foreground">{providerMeta}</span>
        </div>
        <div className="space-y-3">
          {providerItems.map((item) => (
            <div key={item.key}>
              <div className="flex items-center justify-between text-[12px] uppercase tracking-[0.3em] text-muted-foreground">
                <span>{item.label}</span>
                <span className="text-foreground">{item.valueLabel}</span>
              </div>
              <ProgressBar
                percent={(item.costUsd / Math.max(item.totalCostUsd, 1)) * 100}
                tone={item.tone}
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function HomeRiskBand({ cards }: { cards: HomeRiskCard[] }) {
  return (
    <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {cards.map((card, index) => (
        <Link
          key={card.key}
          href={card.href}
          className={`motion-enter motion-enter-fast group flex flex-col justify-between rounded-2xl border border-border/60 bg-[color:color-mix(in_srgb,var(--surface-2)_85%,var(--surface-1)_15%)] p-4 transition-colors hover:border-foreground/40 hover:bg-[color:color-mix(in_srgb,var(--surface-2)_90%,var(--surface-1)_10%)] ${index < 2 ? "motion-delay-1" : "motion-delay-2"}`}
        >
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              {card.label}
            </p>
            <p className="mt-3 text-[20px] font-semibold text-foreground">{card.value}</p>
            <p className="mt-1 text-sm text-muted-foreground">{card.hint}</p>
          </div>
          <div className="mt-4 flex items-center justify-between text-[13px] font-medium text-muted-foreground">
            <span>{card.ctaLabel}</span>
            <ArrowRight aria-hidden="true" className="size-4" />
          </div>
          {card.tone ? (
            <span
              className="mt-3 h-1 w-full rounded-full"
              style={{ background: getToneColor(card.tone) }}
            />
          ) : null}
        </Link>
      ))}
    </section>
  );
}
