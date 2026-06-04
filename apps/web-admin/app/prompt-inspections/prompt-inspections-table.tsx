"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/shared/status-badge";
import { cn } from "@/lib/utils";
import { batchReviewPromptInspectionsAction } from "./actions";
export type PromptInspectionTableRow = {
  id: string;
  href: string;
  verdict: "allow_with_record" | "allow_clean" | "review" | "block";
  reviewStatus:
    | "pending"
    | "confirmed_violation"
    | "confirmed_benign"
    | "needs_followup";
  createdAtLabel: string;
  verdictLabel: string;
  reviewStatusLabel: string;
  riskLabel: string;
  activityLabel: string;
  providerLabel: string;
  modelLabel: string;
  scoreLabel: string;
  requestIdLabel: string;
};
export type PromptInspectionTableSortState = {
  time: { href: string; indicator: string | null };
  score: { href: string; indicator: string | null };
  verdict: { href: string; indicator: string | null };
  review: { href: string; indicator: string | null };
  provider: { href: string; indicator: string | null };
  model: { href: string; indicator: string | null };
};
function formatSortIndicator(appLocale: "zh" | "en", indicator: string | null) {
  if (indicator === "asc") return "↑";
  if (indicator === "desc") return "↓";
  if (indicator === "priority") return appLocale === "zh" ? "优先" : "Pri";
  return null;
}
function VerdictBadge({ verdict, label }: { verdict: string; label: string }) {
  const status =
    verdict === "block"
      ? "critical"
      : verdict === "review"
        ? "warning"
        : ("active" as const);
  return <StatusBadge status={status}>{label}</StatusBadge>;
}
function ReviewStatusBadge({
  reviewStatus,
  label,
}: {
  reviewStatus: string;
  label: string;
}) {
  const status =
    reviewStatus === "confirmed_violation"
      ? "critical"
      : reviewStatus === "confirmed_benign"
        ? "active"
        : reviewStatus === "needs_followup"
          ? "scoped"
          : ("warning" as const);
  return <StatusBadge status={status}>{label}</StatusBadge>;
}
function ScoreChip({ score }: { score: string }) {
  const num = parseInt(score, 10);
  if (isNaN(num))
    return <span className="tabular-nums text-muted-foreground">{score}</span>;
  return (
    <span
      className={cn(
        "tabular-nums font-semibold",
        num >= 70
          ? "text-[color:var(--destructive-strong)]"
          : num >= 40
            ? "text-[color:var(--warning-strong)]"
            : "text-muted-foreground",
      )}
    >
      {" "}
      {score}{" "}
    </span>
  );
}
export function PromptInspectionsTable({
  activeInspectionId,
  appLocale,
  rows,
  redirectPath,
  sortState,
  workspaceId,
}: {
  activeInspectionId?: string | null;
  appLocale: "zh" | "en";
  rows: PromptInspectionTableRow[];
  redirectPath: string;
  sortState: PromptInspectionTableSortState;
  workspaceId: string;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const masterCheckboxRef = useRef<HTMLInputElement | null>(null);
  const rowIdSet = useMemo(() => new Set(rows.map((row) => row.id)), [rows]);
  const pendingRowIds = useMemo(
    () =>
      rows.filter((row) => row.reviewStatus === "pending").map((row) => row.id),
    [rows],
  );
  const allSelected = rows.length > 0 && selectedIds.length === rows.length;
  const partiallySelected =
    selectedIds.length > 0 && selectedIds.length < rows.length;
  const selectedCountLabel = useMemo(
    () => `${selectedIds.length} ${appLocale === "zh" ? "已选" : "selected"}`,
    [appLocale, selectedIds.length],
  );
  const selectionFeedback = useMemo(() => {
    if (!rows.length) {
      return appLocale === "zh"
        ? "当前页没有可批量处置的记录。"
        : "No records are available for batch disposition on this page.";
    }
    if (!selectedIds.length) {
      return appLocale === "zh"
        ? "当前未选择记录。批量处置只作用于当前页选中项。"
        : "No rows selected. Batch disposition only applies to the selected rows on this page.";
    }
    if (allSelected) {
      return appLocale === "zh"
        ? `当前页 ${rows.length} 条记录已全选。`
        : `All ${rows.length} rows on this page are selected.`;
    }
    return appLocale === "zh"
      ? `已选择当前页 ${selectedIds.length} / ${rows.length} 条记录。`
      : `${selectedIds.length} of ${rows.length} rows selected.`;
  }, [allSelected, appLocale, rows.length, selectedIds.length]);
  useEffect(() => {
    if (!masterCheckboxRef.current) return;
    masterCheckboxRef.current.indeterminate = partiallySelected;
  }, [partiallySelected]);
  useEffect(() => {
    setSelectedIds((current) => current.filter((id) => rowIdSet.has(id)));
  }, [rowIdSet]);
  const renderSortableHeader = (
    label: string,
    sort: { href: string; indicator: string | null },
  ) => (
    <Link
      className="inline-flex items-center gap-1 text-[color:var(--text-2)] transition-colors hover:text-foreground"
      href={sort.href}
    >
      {" "}
      <span>{label}</span>{" "}
      {formatSortIndicator(appLocale, sort.indicator) ? (
        <span className="text-[11px] font-semibold text-[color:var(--primary)]">
          {" "}
          {formatSortIndicator(appLocale, sort.indicator)}{" "}
        </span>
      ) : null}{" "}
    </Link>
  );
  return (
    <form action={batchReviewPromptInspectionsAction} className="space-y-0">
      {" "}
      <input name="workspaceId" type="hidden" value={workspaceId} />{" "}
      <input name="redirectTo" type="hidden" value={redirectPath} />{" "}
      <Table>
        {" "}
        <TableHeader>
          {" "}
          <TableRow>
            {" "}
            <TableHead className="w-10">
              {" "}
              <input
                aria-label={
                  appLocale === "zh"
                    ? "选择当前页全部检查记录"
                    : "Select all inspections on this page"
                }
                ref={masterCheckboxRef}
                checked={allSelected}
                className="accent-[color:var(--primary)] size-[14px] cursor-pointer rounded"
                disabled={!rows.length}
                onChange={(event) => {
                  setSelectedIds(
                    event.target.checked ? rows.map((row) => row.id) : [],
                  );
                }}
                type="checkbox"
              />{" "}
            </TableHead>{" "}
            <TableHead>
              {renderSortableHeader(
                appLocale === "zh" ? "时间" : "Time",
                sortState.time,
              )}
            </TableHead>{" "}
            <TableHead>
              {renderSortableHeader(
                appLocale === "zh" ? "结论" : "Verdict",
                sortState.verdict,
              )}
            </TableHead>{" "}
            <TableHead>{appLocale === "zh" ? "风险" : "Risk"}</TableHead>{" "}
            <TableHead>{appLocale === "zh" ? "活动" : "Activity"}</TableHead>{" "}
            <TableHead>
              {renderSortableHeader(
                appLocale === "zh" ? "供应商" : "Provider",
                sortState.provider,
              )}
            </TableHead>{" "}
            <TableHead>
              {renderSortableHeader(
                appLocale === "zh" ? "模型" : "Model",
                sortState.model,
              )}
            </TableHead>{" "}
            <TableHead>
              {renderSortableHeader(
                appLocale === "zh" ? "分数" : "Score",
                sortState.score,
              )}
            </TableHead>{" "}
            <TableHead>
              {renderSortableHeader(
                appLocale === "zh" ? "复核" : "Review",
                sortState.review,
              )}
            </TableHead>{" "}
            <TableHead>
              {appLocale === "zh" ? "请求" : "Request"}
            </TableHead>{" "}
          </TableRow>{" "}
        </TableHeader>{" "}
        <TableBody>
          {" "}
          {rows.map((row) => {
            const selected = selectedIds.includes(row.id);
            const isActive = activeInspectionId === row.id;
            return (
              <TableRow
                className={cn(
                  isActive &&
                    "bg-[color:color-mix(in_srgb,var(--surface-selected)_18%,var(--surface-1)_82%)]",
                )}
                key={row.id}
                data-state={selected ? "selected" : undefined}
              >
                {" "}
                <TableCell className="py-2.5">
                  {" "}
                  <input
                    aria-label={
                      appLocale === "zh"
                        ? `选择请求 ${row.requestIdLabel}`
                        : `Select request ${row.requestIdLabel}`
                    }
                    checked={selected}
                    className="accent-[color:var(--primary)] size-[14px] cursor-pointer rounded"
                    name="promptInspectionIds"
                    onChange={(event) => {
                      setSelectedIds((current) =>
                        event.target.checked
                          ? [...current, row.id]
                          : current.filter((value) => value !== row.id),
                      );
                    }}
                    type="checkbox"
                    value={row.id}
                  />{" "}
                </TableCell>{" "}
                <TableCell className="py-2.5 text-muted-foreground whitespace-nowrap">
                  {" "}
                  <Link
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "transition-colors hover:text-foreground",
                      isActive && "font-medium text-foreground",
                    )}
                    href={row.href}
                  >
                    {" "}
                    {row.createdAtLabel}{" "}
                  </Link>{" "}
                </TableCell>{" "}
                <TableCell className="py-2.5">
                  {" "}
                  <Link href={row.href}>
                    {" "}
                    <VerdictBadge
                      verdict={row.verdict}
                      label={row.verdictLabel}
                    />{" "}
                  </Link>{" "}
                </TableCell>{" "}
                <TableCell className="py-2.5 max-w-[140px]">
                  {" "}
                  <span className="truncate block text-[12px] text-muted-foreground">
                    {row.riskLabel}
                  </span>{" "}
                </TableCell>{" "}
                <TableCell className="py-2.5 text-[12px] text-muted-foreground whitespace-nowrap">
                  {" "}
                  {row.activityLabel}{" "}
                </TableCell>{" "}
                <TableCell className="py-2.5 text-[12px] text-muted-foreground whitespace-nowrap">
                  {" "}
                  {row.providerLabel}{" "}
                </TableCell>{" "}
                <TableCell className="py-2.5 text-[12px] text-muted-foreground max-w-[160px]">
                  {" "}
                  <span className="truncate block">{row.modelLabel}</span>{" "}
                </TableCell>{" "}
                <TableCell className="py-2.5 text-center">
                  {" "}
                  <ScoreChip score={row.scoreLabel} />{" "}
                </TableCell>{" "}
                <TableCell className="py-2.5">
                  {" "}
                  <ReviewStatusBadge
                    reviewStatus={row.reviewStatus}
                    label={row.reviewStatusLabel}
                  />{" "}
                </TableCell>{" "}
                <TableCell className="py-2.5 max-w-[120px]">
                  {" "}
                  <span className="truncate block font-mono text-[11px] text-muted-foreground">
                    {" "}
                    {row.requestIdLabel}{" "}
                  </span>{" "}
                </TableCell>{" "}
              </TableRow>
            );
          })}{" "}
        </TableBody>{" "}
      </Table>{" "}
      <div className="space-y-3 rounded-b-lg border-t border-border/60 bg-[color:color-mix(in_srgb,var(--surface-2)_52%,var(--surface-1)_48%)] px-4 py-3">
        {" "}
        <div className="flex flex-wrap items-center gap-2">
          {" "}
          <Button
            disabled={!rows.length || allSelected}
            onClick={() => setSelectedIds(rows.map((row) => row.id))}
            size="sm"
            type="button"
            variant="outline"
          >
            {" "}
            {appLocale === "zh" ? "全选当前页" : "Select all"}{" "}
          </Button>{" "}
          <Button
            disabled={!pendingRowIds.length}
            onClick={() => setSelectedIds(pendingRowIds)}
            size="sm"
            type="button"
            variant="outline"
          >
            {" "}
            {appLocale === "zh" ? "只选待处理" : "Pending only"}{" "}
          </Button>{" "}
          <Button
            disabled={!selectedIds.length}
            onClick={() => setSelectedIds([])}
            size="sm"
            type="button"
            variant="ghost"
          >
            {" "}
            {appLocale === "zh" ? "清空" : "Clear"}{" "}
          </Button>{" "}
          <span className="inline-flex h-[30px] items-center rounded-[10px] border border-[color:color-mix(in_srgb,var(--border-default)_72%,transparent)] bg-[color:color-mix(in_srgb,var(--surface-2)_56%,var(--surface-1)_44%)] px-2.5 text-[12px] font-medium text-foreground">
            {" "}
            {selectedCountLabel}{" "}
          </span>{" "}
          <p className="flex-1 text-[12px] text-muted-foreground">
            {selectionFeedback}
          </p>{" "}
        </div>{" "}
        <div className="flex flex-wrap items-start gap-3">
          {" "}
          <div className="min-w-[180px] space-y-0.5">
            {" "}
            <p className="text-sm font-medium text-foreground">
              {" "}
              {appLocale === "zh"
                ? "批量处置当前页选中项"
                : "Batch disposition for selected rows"}{" "}
            </p>{" "}
            <p className="text-[12px] text-muted-foreground">
              {" "}
              {appLocale === "zh"
                ? "不会影响当前页之外的检查记录。"
                : "Only the selected rows on this page will be updated."}{" "}
            </p>{" "}
          </div>{" "}
          <textarea
            className="min-h-[72px] flex-1 min-w-[200px] rounded-[10px] border border-[color:color-mix(in_srgb,var(--border-default)_82%,transparent)] bg-background px-3 py-2 text-[13px] text-foreground outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground/68 hover:border-[color:var(--border-strong)] focus-visible:border-[color:var(--primary-border-strong)] resize-none"
            name="reviewNote"
            placeholder={
              appLocale === "zh"
                ? "批量处置备注（可选）"
                : "Batch disposition note (optional)"
            }
          />{" "}
          <div className="flex flex-wrap gap-2 pt-0.5">
            {" "}
            <Button
              aria-label={
                appLocale === "zh" ? "批量确认违规" : "Batch confirm violation"
              }
              disabled={!selectedIds.length}
              name="reviewStatus"
              size="sm"
              type="submit"
              value="confirmed_violation"
            >
              {" "}
              {appLocale === "zh" ? "确认违规" : "Confirm violation"}{" "}
            </Button>{" "}
            <Button
              aria-label={
                appLocale === "zh" ? "批量确认正常" : "Batch confirm benign"
              }
              disabled={!selectedIds.length}
              name="reviewStatus"
              size="sm"
              type="submit"
              value="confirmed_benign"
              variant="outline"
            >
              {" "}
              {appLocale === "zh" ? "确认正常" : "Confirm benign"}{" "}
            </Button>{" "}
            <Button
              aria-label={
                appLocale === "zh" ? "批量继续跟进" : "Batch needs follow-up"
              }
              disabled={!selectedIds.length}
              name="reviewStatus"
              size="sm"
              type="submit"
              value="needs_followup"
              variant="outline"
            >
              {" "}
              {appLocale === "zh" ? "继续跟进" : "Needs follow-up"}{" "}
            </Button>{" "}
          </div>{" "}
        </div>{" "}
      </div>{" "}
    </form>
  );
}
