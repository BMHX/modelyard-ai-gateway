"use client";

import { Link } from "@/i18n/navigation";

import { type ProviderConnection } from "@teamops/contracts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/status-badge";
import { ResourceInlineNotice } from "../../components/resource-inline-notice";
import { useT } from "@/app/lib/i18n-client";
import type { AppLocale } from "@/app/lib/i18n";
import { cn } from "@/lib/utils";

import { ProviderAvatar } from "../provider-visuals";

type ProviderDetailPanelProps = {
  connection: ProviderConnection;
  visualMeta: any;
  routeSummary: { label: string; detail: string };
  healthState: { status: any; label: string; detail: string };
  ambiguousConflictCount: number;
  locale: AppLocale;
  endpoint: string;
  connectionUsageHref: string;
  connectionAuditHref: string;
  keysHref: string;
  supportsManagedAdmin: boolean;
  onEdit: () => void;
  isTestPending: boolean;
  onRetest: (id: string) => void;
  isRevokePending: boolean;
  onRevoke: (id: string) => void;
  inlineMessage: {
    label: string;
    message: string;
    status: "success" | "error";
    detail?: string | null;
  } | null;
  formatLocalizedDateTime: (value: string | null, locale: AppLocale) => string | null;
};

function DetailField({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border/50 bg-[color:color-mix(in_srgb,var(--surface-1)_92%,var(--surface-canvas)_8%)] px-3 py-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "mt-1 text-[13px] font-medium text-foreground",
          mono && "font-mono text-[12px] leading-5 break-all",
        )}
      >
        {value}
      </div>
    </div>
  );
}

export function ProviderDetailPanel({
  connection,
  visualMeta,
  routeSummary,
  healthState,
  ambiguousConflictCount,
  locale,
  endpoint,
  connectionUsageHref,
  connectionAuditHref,
  keysHref,
  supportsManagedAdmin,
  onEdit,
  isTestPending,
  onRetest,
  isRevokePending,
  onRevoke,
  inlineMessage,
  formatLocalizedDateTime,
}: ProviderDetailPanelProps) {
  const tr = useT("providers");

  const supplementalDetailFields: Array<{
    label: string;
    value: string;
    mono: boolean;
  }> = [];

  if (connection.provider === "anthropic" && connection.anthropicVersion) {
    supplementalDetailFields.push({
      label: tr("details.anthropicVersion"),
      value: connection.anthropicVersion,
      mono: true,
    });
  }

  return (
    <div className="grid gap-4 px-4 py-4">
      <div className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <ProviderAvatar meta={visualMeta} size="sm" />
          <Badge variant="outline">{routeSummary.label}</Badge>
          <StatusBadge status={healthState.status}>{healthState.label}</StatusBadge>
          {ambiguousConflictCount > 0 ? (
            <Badge variant="destructive">
              {tr("details.overlaps", {
                count: ambiguousConflictCount,
              })}
            </Badge>
          ) : null}
          {connection.lastTestStatusCode !== null ? (
            <Badge variant="outline">HTTP {connection.lastTestStatusCode}</Badge>
          ) : null}
          <span className="text-xs text-muted-foreground">
            {tr("table.createdLabel")}{" "}
            {formatLocalizedDateTime(connection.createdAt, locale) ?? tr("date.notYet")}
          </span>
        </div>

        {inlineMessage ? (
          <ResourceInlineNotice
            detail={inlineMessage.detail}
            label={inlineMessage.label}
            message={tr(inlineMessage.message)}
            tone={inlineMessage.status === "error" ? "error" : "success"}
          />
        ) : null}

        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          <div className="rounded-lg border border-border/50 bg-[color:color-mix(in_srgb,var(--surface-1)_92%,var(--surface-canvas)_8%)] px-3 py-2.5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  {tr("details.endpoint")}
                </div>
                <div className="mt-1 break-all font-mono text-[12px] leading-5 text-foreground">{endpoint}</div>
              </div>
            </div>
          </div>
          <DetailField
            label={tr("details.lastTested")}
            value={formatLocalizedDateTime(connection.lastTestedAt, locale) ?? tr("date.notYet")}
          />
          <DetailField
            label={tr("details.latency")}
            value={
              connection.lastTestLatencyMs !== null
                ? `${connection.lastTestLatencyMs} ms`
                : tr("common.na")
            }
          />
        </div>

        {supplementalDetailFields.length ? (
          <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
            {supplementalDetailFields.map((field) => (
              <DetailField key={field.label} label={field.label} mono={field.mono} value={field.value} />
            ))}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm" variant="ghost">
            <Link href={connectionUsageHref}>{tr("details.usage")}</Link>
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link href={connectionAuditHref}>{tr("details.audit")}</Link>
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link href={keysHref}>{tr("details.keys")}</Link>
          </Button>
          {supportsManagedAdmin ? (
            <Button onClick={onEdit} size="sm" type="button" variant="ghost">
              {tr("details.editSettings")}
            </Button>
          ) : null}
          {connection.status === "active" && supportsManagedAdmin ? (
            <Button
              aria-busy={isTestPending || undefined}
              disabled={isTestPending}
              onClick={() => onRetest(connection.id)}
              size="sm"
              type="button"
              variant="outline"
            >
              {tr(isTestPending ? "table.actions.testing" : "table.actions.retest")}
            </Button>
          ) : null}
          {connection.status === "active" ? (
            <Button
              aria-busy={isRevokePending || undefined}
              disabled={isRevokePending}
              onClick={() => onRevoke(connection.id)}
              size="sm"
              type="button"
              variant="outline"
            >
              {tr(isRevokePending ? "table.actions.revoking" : "table.actions.revoke")}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
