"use client";

import { Pie, PieChart, Cell, Tooltip } from "recharts";
import { ChartContainer } from "./chart-container";

type StatusRingData = {
  name: string;
  value: number;
  color?: string;
};

type StatusRingChartProps = {
  data: StatusRingData[];
  title?: string;
  description?: string;
  centerLabel?: string;
  centerValue?: string;
  variant?: "ring" | "gauge" | "stacked";
};

export function StatusRingChart({
  data,
  title,
  description,
  centerLabel,
  centerValue,
  variant = "ring",
}: StatusRingChartProps) {
  const monochromePalette = [
    "var(--foreground)",
    "var(--border-strong)",
    "var(--border-default)",
    "var(--surface-3)",
  ];
  const total = data.reduce((sum, item) => sum + item.value, 0);
  let gaugeOffset = 0;
  const gaugeSegments = data
    .filter((entry) => entry.value > 0)
    .map((entry, index) => {
      const percentage = total > 0 ? (entry.value / total) * 100 : 0;
      const segment = {
        color: entry.color ?? monochromePalette[index % monochromePalette.length],
        dash: `${percentage} ${100 - percentage}`,
        offset: -gaugeOffset,
      };

      gaugeOffset += percentage;
      return segment;
    });

  if (variant === "gauge") {
    return (
      <div className="flex h-[140px] flex-col gap-2">
        {(title || description) && (
          <div className="px-1">
            {title ? (
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/80">
                {title}
              </h3>
            ) : null}
            {description ? (
              <p className="text-[10px] text-muted-foreground/60">{description}</p>
            ) : null}
          </div>
        )}
        <div className="relative min-h-0 flex-1">
          <svg aria-hidden="true" className="absolute inset-0 size-full" viewBox="0 0 180 112">
            <path
              d="M 26 76 A 64 64 0 0 1 154 76"
              fill="none"
              pathLength={100}
              stroke="var(--muted)"
              strokeLinecap="round"
              strokeOpacity={0.45}
              strokeWidth={13}
            />
            {(gaugeSegments.length ? gaugeSegments : [{ color: "var(--border-strong)", dash: "100 0", offset: 0 }]).map((segment, index) => (
              <path
                d="M 26 76 A 64 64 0 0 1 154 76"
                fill="none"
                key={`gauge-${index}`}
                pathLength={100}
                stroke={segment.color}
                strokeDasharray={segment.dash}
                strokeDashoffset={segment.offset}
                strokeLinecap="round"
                strokeWidth={13}
              />
            ))}
          </svg>
          <div className="absolute inset-x-0 top-[30%] grid place-items-center text-center">
            {centerValue ? (
              <div className="text-[30px] font-semibold leading-none tracking-tight text-foreground">
                {centerValue}
              </div>
            ) : null}
            {centerLabel ? (
              <div className="mt-2 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                {centerLabel}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  if (variant === "stacked") {
    return (
      <div className="flex h-[140px] flex-col gap-2">
        {(title || description) && (
          <div className="px-1">
            {title ? (
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/80">
                {title}
              </h3>
            ) : null}
            {description ? (
              <p className="text-[10px] text-muted-foreground/60">{description}</p>
            ) : null}
          </div>
        )}
        <div className="flex min-h-0 flex-1 flex-col justify-center gap-4 px-1">
          <div className="flex h-1.5 overflow-hidden rounded-full bg-muted/50">
            {data.map((entry, index) => (
              <div
                aria-label={`${entry.name}: ${entry.value}`}
                className="min-w-1"
                key={`${entry.name}-${index}`}
                style={{
                  backgroundColor: entry.color ?? monochromePalette[index % monochromePalette.length],
                  flexGrow: total > 0 ? entry.value : 1,
                }}
              />
            ))}
          </div>
          <div className="grid gap-2.5">
            {data.map((entry, index) => {
              const percentage = total > 0 ? Math.round((entry.value / total) * 100) : 0;
              const color = entry.color ?? monochromePalette[index % monochromePalette.length];

              return (
                <div className="grid grid-cols-[minmax(0,88px)_minmax(0,1fr)_auto] items-center gap-3 text-[11px]" key={`${entry.name}-legend-${index}`}>
                  <span className="truncate text-muted-foreground">{entry.name}</span>
                  <span className="h-1.5 overflow-hidden rounded-full bg-muted/45">
                    <span
                      aria-hidden="true"
                      className="block h-full rounded-full transition-[width]"
                      style={{
                        backgroundColor: color,
                        width: `${percentage}%`,
                      }}
                    />
                  </span>
                  <span className="shrink-0 text-right font-semibold tabular-nums text-foreground">
                    {entry.value}
                    <span className="ml-1 text-muted-foreground">{percentage}%</span>
                  </span>
                </div>
              );
            })}
          </div>
          {centerValue || centerLabel ? (
            <div className="flex items-baseline justify-between border-t border-border/40 pt-2">
              {centerLabel ? (
                <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                  {centerLabel}
                </span>
              ) : null}
              {centerValue ? (
                <span className="text-sm font-semibold tabular-nums text-foreground">{centerValue}</span>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <ChartContainer height={140} title={title} description={description}>
      <PieChart>
        <Tooltip
          contentStyle={{
            backgroundColor: "var(--surface-canvas)",
            borderColor: "var(--border-subtle)",
            borderRadius: "var(--radius-sm)",
            fontSize: "11px",
            color: "var(--foreground)",
            boxShadow: "var(--shadow-sm)",
            padding: "8px 12px",
          }}
          itemStyle={{ padding: "0", color: "var(--foreground)", fontWeight: 500 }}
          cursor={false}
        />
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={52}
          outerRadius={56}
          paddingAngle={2}
          dataKey="value"
          stroke="none"
          cornerRadius={2}
        >
          {data.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={monochromePalette[index % monochromePalette.length]} />
          ))}
        </Pie>
        {centerValue && (
          <text
            x="50%"
            y="48%"
            textAnchor="middle"
            dominantBaseline="middle"
            className="fill-foreground font-semibold text-[24px] tracking-tight"
          >
            {centerValue}
          </text>
        )}
        {centerLabel && (
          <text
            x="50%"
            y="68%"
            textAnchor="middle"
            dominantBaseline="middle"
            className="fill-muted-foreground text-[9px] uppercase font-bold tracking-[0.1em]"
          >
            {centerLabel}
          </text>
        )}
      </PieChart>
    </ChartContainer>
  );
}
