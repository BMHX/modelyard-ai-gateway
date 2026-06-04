"use client";

import { type GlobalHomeDashboardData } from "../lib/control-api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link } from "@/i18n/navigation";
import { KeyRound, ArrowRight, Zap, Box, Activity, ShieldCheck, LayoutGrid, BarChart3 } from "lucide-react";
import { ResourceSummaryStrip, type ResourceSummaryStripItem } from "./resource-summary-strip";
import { ManagementTrendPanel, type ManagementTrendPoint } from "./home-management-overview";
import {getIntlDateTimeLocale} from "../lib/i18n-format";
import { useT } from "../lib/i18n-client";

type HomeMemberOverviewProps = {
  data: GlobalHomeDashboardData;
  locale: string;
};

function formatTrendLabel(value: string, locale: string) {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return new Intl.DateTimeFormat(getIntlDateTimeLocale(locale), {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

export function HomeMemberOverview({ data, locale }: HomeMemberOverviewProps) {
  const homeT = useT("home");
  const shellT = useT("shell");
  const activeKeysCount = data.keySummary.active;
  const projectsCount = data.resourceSummary.projects;

  const dailyTrendPoints: ManagementTrendPoint[] = data.dailyUsage.items.map((item) => ({
    bucketDate: item.bucketDate,
    label: formatTrendLabel(item.bucketDate, locale),
    requestCount: item.requestCount,
    totalCostUsd: item.totalCostUsd,
    blockedCount: item.blockedCount,
    errorCount: item.errorCount,
  }));
  
  const usageSummaryItems: ResourceSummaryStripItem[] = [
    {
      id: "requests",
      label: homeT("dashboard.totalRequests"),
      value: new Intl.NumberFormat(locale).format(data.usageSummary.totalEvents),
      meta: homeT("dashboard.mtd"),
    },
    {
      id: "spend",
      label: homeT("dashboard.totalSpend"),
      value: new Intl.NumberFormat(locale, {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(data.usageSummary.totalCostUsd),
      meta: homeT("dashboard.accrued"),
    },
  ];

  const successRate = data.usageSummary.successRate == null
    ? "—"
    : `${Math.round(data.usageSummary.successRate * 100)}%`;

  return (
    <div className="max-w-7xl mx-auto space-y-6 px-4">
      {/* Main Content: Full Width */}
      <div className="space-y-6">
        {/* Trend Section */}
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <BarChart3 className="size-4 text-muted-foreground" />
            <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-widest">{homeT("dashboard.trendTitle")}</h2>
          </div>
          <div className="rounded-2xl border border-border/60 bg-card/40 p-2 shadow-none">
            <ManagementTrendPanel
              chips={[]}
              blockedLegend={homeT("dashboard.blocked")}
              description=""
              emptyLabel={homeT("dashboard.noTrendData")}
              errorLegend={homeT("dashboard.error")}
              items={dailyTrendPoints}
              requestLegend={homeT("dashboard.totalRequests")}
              spendLegend={homeT("dashboard.totalSpend")}
              title=""
            />
          </div>
        </section>

        <div className="grid gap-4 sm:grid-cols-3">
          {/* Requests Card */}
          <Card className="border-border/60 bg-card rounded-2xl overflow-hidden px-6 py-4 shadow-none flex flex-col justify-center">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.2em] mb-1">{homeT("dashboard.totalRequests")}</p>
            <div className="flex items-end justify-between">
              <p className="text-3xl font-black text-foreground tabular-nums leading-none">
                {new Intl.NumberFormat(locale).format(data.usageSummary.totalEvents)}
              </p>
              <span className="text-[10px] text-muted-foreground font-medium mb-0.5">{homeT("dashboard.mtd")}</span>
            </div>
          </Card>

          {/* Spend Card */}
          <Card className="border-border/60 bg-card rounded-2xl overflow-hidden px-6 py-4 shadow-none flex flex-col justify-center">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.2em] mb-1">{homeT("dashboard.totalSpend")}</p>
            <div className="flex items-end justify-between">
              <p className="text-2xl font-black text-foreground tabular-nums leading-none">
                {new Intl.NumberFormat(locale, {
                  style: "currency",
                  currency: "USD",
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                }).format(data.usageSummary.totalCostUsd)}
              </p>
              <span className="text-[10px] text-muted-foreground font-medium mb-0.5">{homeT("dashboard.accrued")}</span>
            </div>
          </Card>
          
          {/* Prominent Success/Status Card */}
          <Card className="border-border/60 bg-card rounded-2xl overflow-hidden px-6 py-4 shadow-none flex flex-col justify-center">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.2em] mb-1">{homeT("dashboard.platformStatus")}</p>
            <div className="flex items-end justify-between">
              <p className="text-3xl font-black text-foreground tabular-nums leading-none">{successRate}</p>
              <div className="flex flex-col items-end">
                <Badge variant="outline" className="bg-emerald-500/5 text-emerald-600 border-emerald-500/20 text-[9px] px-1.5 py-0 font-bold uppercase tracking-tighter">
                  {homeT("dashboard.healthy")}
                </Badge>
                <span className="text-[10px] text-muted-foreground mt-1 font-medium">{homeT("dashboard.successRate")}</span>
              </div>
            </div>
          </Card>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Link href="/virtual-keys" className="group">
            <Card className="border-border/60 bg-card hover:border-primary/40 transition-all rounded-2xl overflow-hidden">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">{homeT("dashboard.activeKeys")}</p>
                    <p className="text-3xl font-black text-foreground tabular-nums">{activeKeysCount}</p>
                  </div>
                  <div className="size-12 rounded-xl bg-muted group-hover:bg-primary/10 group-hover:text-primary transition-colors flex items-center justify-center">
                    <KeyRound className="size-6" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>

          <Link href="/projects" className="group">
            <Card className="border-border/60 bg-card hover:border-primary/40 transition-all rounded-2xl overflow-hidden">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">{shellT("navigation.items.projects.label")}</p>
                    <p className="text-3xl font-black text-foreground tabular-nums">{projectsCount}</p>
                  </div>
                  <div className="size-12 rounded-xl bg-muted group-hover:bg-primary/10 group-hover:text-primary transition-colors flex items-center justify-center">
                    <LayoutGrid className="size-6" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>
        </div>
      </div>

      {/* Bottom Horizontal Security Banner - Highly Compact & Flat */}
      <div className="pt-6 mt-10 border-t border-border/40 flex flex-wrap items-center justify-between gap-6">
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-2 shrink-0">
            <ShieldCheck className="size-4 text-emerald-600" />
            <span className="text-xs font-bold text-foreground uppercase tracking-[0.15em]">{homeT("dashboard.security")}</span>
          </div>
          <div className="h-4 w-px bg-border/60 hidden lg:block" />
          <div className="flex flex-wrap items-center gap-x-10 gap-y-2">
            {[
              { label: homeT("dashboard.encryption"), value: "TLS 1.3" },
              { label: homeT("dashboard.auditPipeline"), value: homeT("dashboard.realTime") },
              { label: homeT("dashboard.sso"), value: "Verified" }
            ].map((item, i) => (
              <div key={i} className="flex items-baseline gap-2">
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-tight">{item.label}:</span>
                <span className="text-xs font-bold text-foreground font-mono">{item.value}</span>
              </div>
            ))}
          </div>
        </div>
        
        <Button variant="outline" size="sm" className="h-8 rounded-lg border-border/60 px-4 text-xs font-bold transition-all shadow-none hover:bg-muted" asChild>
          <Link href="/audit-logs">{homeT("dashboard.viewRecent")}</Link>
        </Button>
      </div>
    </div>
  );
}
