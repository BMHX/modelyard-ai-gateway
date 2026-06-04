"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";

import { translateInlineText } from "../lib/i18n";
import { useLocalePreference } from "../lib/i18n-client";

type ExportJobsAutoRefreshProps = {
  pendingCount: number;
  runningCount: number;
  intervalMs?: number;
};

export function ExportJobsAutoRefresh({
  pendingCount,
  runningCount,
  intervalMs = 5_000,
}: ExportJobsAutoRefreshProps) {
  const router = useRouter();
  const { locale } = useLocalePreference();
  const [isRefreshing, startRefreshTransition] = useTransition();
  const processingCount = pendingCount + runningCount;

  useEffect(() => {
    if (!processingCount) {
      return;
    }

    const refresh = () => {
      if (document.visibilityState !== "visible") {
        return;
      }

      startRefreshTransition(() => {
        router.refresh();
      });
    };

    const intervalId = window.setInterval(refresh, intervalMs);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refresh();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [intervalMs, processingCount, router, startRefreshTransition]);

  const handleRefresh = () => {
    startRefreshTransition(() => {
      router.refresh();
    });
  };

  return (
    <div className="button-row">
      <span className={`tag${processingCount ? " tag--warning" : ""}`}>
        {processingCount
          ? `${processingCount} ${locale === "zh" ? "处理中" : "processing"}`
          : translateInlineText(locale, "Idle")}
      </span>
      <button
        className={`button button--ghost button--micro${isRefreshing ? " button--disabled" : ""}`}
        onClick={handleRefresh}
        type="button"
      >
        {isRefreshing
          ? locale === "zh" ? "刷新中..." : "Refreshing..."
          : translateInlineText(locale, "Refresh")}
      </button>
    </div>
  );
}
