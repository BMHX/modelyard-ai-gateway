"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartContainer } from "./chart-container";

type TrendData = {
  date: string;
  value: number;
};

type TrendLineChartProps = {
  data: TrendData[];
  title?: string;
  description?: string;
  color?: string;
  height?: number | string;
  variant?: "area" | "bars" | "line";
};

export function TrendLineChart({
  data,
  title,
  description,
  color = "var(--foreground)",
  height = 140,
  variant = "area",
}: TrendLineChartProps) {
  if (variant === "line") {
    return (
      <ChartContainer height={height} title={title} description={description}>
        <LineChart
          data={data}
          margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            vertical={false}
            stroke="var(--border-subtle)"
            opacity={0.5}
          />
          <XAxis
            dataKey="date"
            hide
            axisLine={false}
            tickLine={false}
          />
          <YAxis hide axisLine={false} tickLine={false} />
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
            labelStyle={{ display: "none" }}
            cursor={{ stroke: "var(--border-strong)", strokeWidth: 1, strokeDasharray: "3 3" }}
          />
          <Line
            type="linear"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            dot={{ r: 2.5, strokeWidth: 1.5, fill: "var(--surface-canvas)" }}
            activeDot={{ r: 4, strokeWidth: 2, fill: "var(--surface-canvas)" }}
            animationDuration={900}
          />
        </LineChart>
      </ChartContainer>
    );
  }

  if (variant === "bars") {
    return (
      <ChartContainer height={height} title={title} description={description}>
        <BarChart
          data={data}
          margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            vertical={false}
            stroke="var(--border-subtle)"
            opacity={0.45}
          />
          <XAxis
            dataKey="date"
            hide
            axisLine={false}
            tickLine={false}
          />
          <YAxis hide axisLine={false} tickLine={false} />
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
            labelStyle={{ display: "none" }}
            cursor={{ fill: "var(--muted)", opacity: 0.28 }}
          />
          <Bar
            dataKey="value"
            fill={color}
            maxBarSize={22}
            radius={[6, 6, 2, 2]}
            animationDuration={1000}
          >
            {data.map((entry, index) => (
              <Cell
                key={`bar-${entry.date}`}
                fill={index === data.length - 1 ? color : "var(--border-strong)"}
                opacity={index === data.length - 1 ? 0.95 : 0.45}
              />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>
    );
  }

  return (
    <ChartContainer height={height} title={title} description={description}>
      <AreaChart
        data={data}
        margin={{ top: 5, right: 10, left: 0, bottom: 0 }}
      >
        <defs>
          <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={color} stopOpacity={0.05} />
            <stop offset="95%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid
          strokeDasharray="3 3"
          vertical={false}
          stroke="var(--border-subtle)"
          opacity={0.6}
        />
        <XAxis
          dataKey="date"
          hide
          axisLine={false}
          tickLine={false}
        />
        <YAxis hide axisLine={false} tickLine={false} />
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
          labelStyle={{ display: "none" }}
          cursor={{ stroke: "var(--border-strong)", strokeWidth: 1, strokeDasharray: "3 3" }}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={1.5}
          fillOpacity={1}
          fill="url(#colorValue)"
          animationDuration={1000}
        />
      </AreaChart>
    </ChartContainer>
  );
}
