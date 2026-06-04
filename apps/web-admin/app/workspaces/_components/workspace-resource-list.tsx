"use client";
import {
  Fragment,
  memo,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ComponentProps,
  type ReactNode,
} from "react";
import { MoreHorizontal, SlidersHorizontal } from "lucide-react";
import { Link, useRouter } from "@/i18n/navigation";

import { useT } from "@/app/lib/i18n-client";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { ResourceInlineNotice } from "../../components/resource-inline-notice";
import { ResourceTableSection } from "../../components/resource-table-section";
import { bulkDeleteWorkspacesAction } from "../actions";

export type WorkspaceResourceLink = {
  label: string;
  href: string;
};

export type WorkspaceResourceRow = {
  id: string;
  displayName: string;
  name: string;
  slug: string;
  lifecycle: {
    label: string;
    status: "warning" | "scoped" | "healthy";
    meta: string;
  };
  review: {
    tone: "fresh" | "active" | "dormant";
    label: string;
    status: "warning" | "scoped" | "healthy";
    meta: string;
  };
  setup: {
    label: string;
    status: "warning" | "scoped" | "healthy" | "setup";
    meta: string;
  };
  createdAtLabel: string;
  updatedAtLabel: string;
  openLink: WorkspaceResourceLink;
  surfaceLinks: WorkspaceResourceLink[];
  secondaryLinks: WorkspaceResourceLink[];
  organizationId: string;
  redirectPath: string;
};

type WorkspaceDensity = "comfortable" | "compact";
type WorkspaceColumnSet = "standard" | "audit" | "minimal";

type WorkspaceResourceListProps = {
  organizationId: string;
  redirectPath: string;
  density: WorkspaceDensity;
  columnSet: WorkspaceColumnSet;
  onColumnSetChange: (value: WorkspaceColumnSet) => void;
  onDensityChange: (value: WorkspaceDensity) => void;
  rows: WorkspaceResourceRow[];
  emptyState: ReactNode;
  focusedWorkspaceId?: string | null;
  noticeState?: { label: string; status: "healthy" | "warning" | "error" } | null;
  noticeMessage?: string | null;
};

type SelectionCheckboxProps = {
  checked: boolean;
  indeterminate?: boolean;
  label: string;
  onCheckedChange: (checked: boolean) => void;
};

type WorkspaceInlineNotice = {
  label: string;
  tone: "success" | "warning" | "error";
  message: string;
} | null;

const reviewStatusByTone: Record<
  WorkspaceResourceRow["review"]["tone"],
  ComponentProps<typeof StatusBadge>["status"]
> = {
  fresh: "healthy",
  active: "scoped",
  dormant: "warning",
};

const selectionCheckboxClassName =
  "size-4 rounded border border-input bg-background text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring/35";
const summaryActionButtonBaseClassName =
  "h-8 rounded-md px-3 text-[12px] font-medium leading-none whitespace-nowrap shadow-none";
const summaryPrimaryActionButtonClassName =
  "border-[color:var(--primary-border)] bg-[color:color-mix(in_srgb,var(--surface-selected)_72%,var(--surface-1)_28%)] text-foreground hover:border-[color:var(--primary-border-strong)] hover:bg-[color:color-mix(in_srgb,var(--surface-selected)_82%,var(--surface-1)_18%)]";
const summaryEmphasisActionButtonClassName =
  "border-[color:var(--primary-border-strong)] bg-[color:color-mix(in_srgb,var(--surface-selected)_84%,var(--surface-1)_16%)] text-foreground hover:border-[color:var(--primary-border-strong)] hover:bg-[color:color-mix(in_srgb,var(--surface-selected)_92%,var(--surface-1)_8%)]";
const summarySecondaryActionButtonClassName =
  "border-[color:color-mix(in_srgb,var(--border-default)_76%,transparent)] bg-[color:color-mix(in_srgb,var(--surface-1)_97%,var(--surface-canvas)_3%)] text-[color:var(--text-2)] hover:border-[color:var(--border-strong)] hover:bg-[color:color-mix(in_srgb,var(--surface-2)_72%,var(--surface-1)_28%)] hover:text-foreground";

function summarizeResources(links: WorkspaceResourceLink[]) {
  if (!links.length) {
    return null;
  }

  const preview = links
    .slice(0, 2)
    .map((link) => link.label)
    .join(" · ");

  if (links.length <= 2) {
    return preview;
  }

  return `${preview} +${links.length - 2}`;
}

function getDetailsToggleVariant(isExpanded: boolean): ComponentProps<typeof Button>["variant"] {
  return isExpanded ? "secondary" : "outline";
}

function WorkspaceActionLinkButton({
  link,
  tone,
  isEmphasis = false,
}: {
  link: WorkspaceResourceLink;
  tone: "primary" | "secondary";
  isEmphasis?: boolean;
}) {
  const actionClassName = isEmphasis
    ? summaryEmphasisActionButtonClassName
    : tone === "primary"
      ? summaryPrimaryActionButtonClassName
      : summarySecondaryActionButtonClassName;

  return (
    <Button asChild className={cn(summaryActionButtonBaseClassName, actionClassName)} size="sm" variant="outline">
      <Link href={link.href}>{link.label}</Link>
    </Button>
  );
}

function WorkspaceSummaryActionGroup({
  openLink,
  secondaryLinks,
  surfaceLinks,
  isSetupIncomplete = false,
}: {
  openLink: WorkspaceResourceLink;
  secondaryLinks: WorkspaceResourceLink[];
  surfaceLinks: WorkspaceResourceLink[];
  isSetupIncomplete?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <WorkspaceActionLinkButton link={openLink} tone="primary" isEmphasis={isSetupIncomplete} />
      {surfaceLinks.map((link) => (
        <WorkspaceActionLinkButton key={link.label} link={link} tone="secondary" />
      ))}
      {secondaryLinks.map((link) => (
        <WorkspaceActionLinkButton key={link.label} link={link} tone="secondary" />
      ))}
    </div>
  );
}

function WorkspaceDetailsToggleButton({
  isExpanded,
  onClick,
}: {
  isExpanded: boolean;
  onClick: () => void;
}) {
  const t = useT("workspaces");

  return (
    <Button onClick={onClick} size="sm" type="button" variant={getDetailsToggleVariant(isExpanded)}>
      {isExpanded ? t("table.actions.hide") : t("table.actions.inspect")}
    </Button>
  );
}

function SelectionCheckbox({ checked, indeterminate = false, label, onCheckedChange }: SelectionCheckboxProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!inputRef.current) {
      return;
    }

    inputRef.current.indeterminate = indeterminate && !checked;
  }, [checked, indeterminate]);

  return (
    <input
      aria-label={label}
      checked={checked}
      className={selectionCheckboxClassName}
      onChange={(event: ChangeEvent<HTMLInputElement>) => onCheckedChange(event.currentTarget.checked)}
      ref={inputRef}
      type="checkbox"
    />
  );
}

function WorkspaceSummaryPanel({
  row,
  notice,
}: {
  row: WorkspaceResourceRow;
  notice?: WorkspaceInlineNotice;
}) {
  const t = useT("workspaces");

  return (
    <div className="grid gap-4 border-t border-border/60 px-4 py-4">
      {notice ? (
        <div>
          <ResourceInlineNotice
            label={notice.label}
            message={notice.message}
            tone={notice.tone}
          />
        </div>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div className="grid gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            {t("table.summary.snapshot")}
          </p>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <StatusBadge indicator status={row.lifecycle.status}>
              {row.lifecycle.label}
            </StatusBadge>
            <StatusBadge status={reviewStatusByTone[row.review.tone]}>{row.review.label}</StatusBadge>
            <StatusBadge status={row.setup.status}>{row.setup.label}</StatusBadge>
            <span className="text-muted-foreground">{row.createdAtLabel}</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">{row.updatedAtLabel}</span>
          </div>
          <div className="grid gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              {t("table.summary.slug")}
            </span>
            <p className="text-sm text-foreground">{row.slug}</p>
          </div>
        </div>

        <div className="grid gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            {t("table.summary.jump")}
          </p>
          <WorkspaceSummaryActionGroup
            openLink={row.openLink}
            secondaryLinks={row.secondaryLinks}
            surfaceLinks={row.surfaceLinks}
            isSetupIncomplete={row.setup.status === "warning"}
          />
        </div>
      </div>
    </div>
  );
}

function WorkspaceTableViewMenu({
  columnSet,
  density,
  onColumnSetChange,
  onDensityChange,
}: {
  columnSet: WorkspaceColumnSet;
  density: WorkspaceDensity;
  onColumnSetChange: (value: WorkspaceColumnSet) => void;
  onDensityChange: (value: WorkspaceDensity) => void;
}) {
  const t = useT("workspaces");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" type="button" variant="outline">
          <SlidersHorizontal className="size-4" />
          {t("table.view.title")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>{t("table.view.density")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          onValueChange={(value) => {
            startTransition(() => {
              onDensityChange(value as WorkspaceDensity);
            });
          }}
          value={density}
        >
          <DropdownMenuRadioItem value="comfortable">
            {t("toolbar.densityOptions.comfortable")}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="compact">
            {t("toolbar.densityOptions.compact")}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{t("table.view.columns")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          onValueChange={(value) => {
            startTransition(() => {
              onColumnSetChange(value as WorkspaceColumnSet);
            });
          }}
          value={columnSet}
        >
          <DropdownMenuRadioItem value="standard">
            {t("toolbar.columnsOptions.standard")}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="audit">
            {t("toolbar.columnsOptions.audit")}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="minimal">
            {t("toolbar.columnsOptions.minimal")}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const WorkspaceSelectionBar = memo(function WorkspaceSelectionBar({
  allSelected,
  firstSelectedHref,
  onCheckedChange,
  onClearSelection,
  onInspectSelection,
  onToggleComparePanel,
  organizationId,
  partiallySelected,
  redirectPath,
  selectedCount,
  selectedIds,
  showComparePanel,
}: {
  allSelected: boolean;
  firstSelectedHref?: string | null;
  onCheckedChange: (checked: boolean) => void;
  onClearSelection: () => void;
  onInspectSelection: () => void;
  onToggleComparePanel: () => void;
  organizationId: string;
  partiallySelected: boolean;
  redirectPath: string;
  selectedCount: number;
  selectedIds: string[];
  showComparePanel: boolean;
}) {
  const t = useT("workspaces");

  return (
    <div className="resource-table-selection-bar resource-table-selection-bar--active motion-enter motion-enter-fast sticky top-4 z-20 flex flex-wrap items-center justify-between gap-2 px-3 py-2 backdrop-blur">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          {t("table.selection.label")}
        </span>
        <SelectionCheckbox
          checked={allSelected}
          indeterminate={partiallySelected}
          label={t("table.selection.selectAllVisible")}
          onCheckedChange={onCheckedChange}
        />
        <span className="text-[12.5px] font-medium text-foreground">
          {t("table.selection.selectedCount", { count: selectedCount })}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={onInspectSelection} size="sm" type="button" variant="outline">
          {t("table.actions.inspect")}
        </Button>
        {firstSelectedHref ? (
          <Button asChild size="sm" variant="outline">
            <Link href={firstSelectedHref}>{t("table.actions.openSelected")}</Link>
          </Button>
        ) : null}
        <Button
          aria-pressed={showComparePanel}
          disabled={selectedCount < 2}
          onClick={onToggleComparePanel}
          size="sm"
          type="button"
          variant={showComparePanel ? "secondary" : "outline"}
        >
          {t("table.actions.compare")}
        </Button>
        <Button onClick={onClearSelection} size="sm" type="button" variant="ghost">
          {t("table.actions.clear")}
        </Button>
        <form action={bulkDeleteWorkspacesAction}>
          <input name="organizationId" type="hidden" value={organizationId} />
          <input name="redirectPath" type="hidden" value={redirectPath} />
          {selectedIds.map((workspaceId) => (
            <input key={workspaceId} name="workspaceIds" type="hidden" value={workspaceId} />
          ))}
          <Button size="sm" type="submit" variant="destructive">
            {t("table.actions.deleteSelected")}
          </Button>
        </form>
      </div>
    </div>
  );
});

const WorkspaceComparePanel = memo(function WorkspaceComparePanel({
  rows,
  onHide,
}: {
  rows: WorkspaceResourceRow[];
  onHide: () => void;
}) {
  const t = useT("workspaces");

  return (
    <div className="motion-enter motion-enter-fast grid gap-3 border-b border-border/60 px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="grid gap-0.5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            {t("table.compare.title")}
          </p>
          <p className="text-sm text-muted-foreground">
            {t("table.compare.description", { count: Math.min(rows.length, 3) })}
          </p>
        </div>
        <Button onClick={onHide} size="sm" type="button" variant="ghost">
          {t("table.compare.hide")}
        </Button>
      </div>

      <div className="grid gap-3 xl:grid-cols-3">
        {rows.slice(0, 3).map((row) => (
          <div
            className="grid gap-3 rounded-lg border border-border/55 bg-[color:color-mix(in_srgb,var(--surface-1)_90%,var(--surface-canvas)_10%)] p-3"
            key={row.id}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="grid gap-1">
                <Link className="text-sm font-semibold text-foreground transition-colors hover:text-primary" href={row.openLink.href}>
                  {row.displayName}
                </Link>
                <span className="text-xs text-muted-foreground">{row.slug}</span>
              </div>
              <Button asChild size="sm" variant="ghost">
                <Link href={row.openLink.href}>{t("table.actions.open")}</Link>
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <StatusBadge indicator status={row.lifecycle.status}>
                {row.lifecycle.label}
              </StatusBadge>
              <StatusBadge status={reviewStatusByTone[row.review.tone]}>{row.review.label}</StatusBadge>
            </div>

            <dl className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
              <div className="grid gap-0.5">
                <dt className="font-medium uppercase tracking-[0.08em]">{t("table.columns.updated")}</dt>
                <dd className="text-foreground">{row.updatedAtLabel}</dd>
              </div>
              <div className="grid gap-0.5">
                <dt className="font-medium uppercase tracking-[0.08em]">{t("table.columns.created")}</dt>
                <dd className="text-foreground">{row.createdAtLabel}</dd>
              </div>
              <div className="grid gap-0.5 sm:col-span-2">
                <dt className="font-medium uppercase tracking-[0.08em]">{t("table.columns.resources")}</dt>
                <dd className="text-foreground">{summarizeResources(row.surfaceLinks) ?? "—"}</dd>
              </div>
            </dl>
          </div>
        ))}
      </div>
    </div>
  );
});

const WorkspaceMobileRow = memo(function WorkspaceMobileRow({
  isExpanded,
  isSelected,
  mobileRowGapClassName,
  mobileRowPaddingClassName,
  notice,
  onToggleExpanded,
  onToggleSelection,
  row,
  showSurfacesColumn,
}: {
  isExpanded: boolean;
  isSelected: boolean;
  mobileRowGapClassName: string;
  mobileRowPaddingClassName: string;
  notice: WorkspaceInlineNotice;
  onToggleExpanded: (rowId: string) => void;
  onToggleSelection: (rowId: string, checked: boolean) => void;
  row: WorkspaceResourceRow;
  showSurfacesColumn: boolean;
}) {
  const t = useT("workspaces");
  const router = useRouter();
  const resourceSummary = summarizeResources(row.surfaceLinks);

  const handleRowClick = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "BUTTON" ||
        target.closest("button") ||
        target.tagName === "A" ||
        target.closest("a") ||
        target.tagName === "INPUT" ||
        target.closest("input") ||
        target.closest(".resource-expando")
      ) {
        return;
      }
      router.push(row.openLink.href);
    },
    [router, row.openLink.href],
  );

  return (
    <article
      className={cn(
        "motion-surface border-t border-border/60 first:border-t-0 cursor-pointer transition-colors hover:bg-accent/8",
        isSelected ? "bg-accent/16 hover:bg-accent/16" : "bg-transparent",
      )}
      id={`workspace-${row.id}`}
      onClick={handleRowClick}
    >
      <div className={cn("grid", mobileRowGapClassName, mobileRowPaddingClassName)}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <SelectionCheckbox
              checked={isSelected}
              label={t("table.selection.selectWorkspace", { name: row.name })}
              onCheckedChange={(checked) => onToggleSelection(row.id, checked)}
            />
            <div className="grid gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <Link className="text-sm font-semibold text-foreground transition-colors hover:text-primary" href={row.openLink.href}>
                  {row.displayName}
                </Link>
                <StatusBadge indicator status={row.lifecycle.status}>
                  {row.lifecycle.label}
                </StatusBadge>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{row.slug}</span>
                <span aria-hidden="true">·</span>
                <span>{row.updatedAtLabel}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <StatusBadge status={row.setup.status}>{row.setup.label}</StatusBadge>
              </div>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <WorkspaceDetailsToggleButton
              isExpanded={isExpanded}
              onClick={() => onToggleExpanded(row.id)}
            />
          </div>
        </div>

        {showSurfacesColumn && resourceSummary ? (
          <p className="text-xs text-muted-foreground">{resourceSummary}</p>
        ) : null}
      </div>
      <div className="resource-expando" data-state={isExpanded ? "open" : "closed"}>
        <div className="resource-expando__inner">
          <WorkspaceSummaryPanel
            notice={notice}
            row={row}
          />
        </div>
      </div>
    </article>
  );
});

const WorkspaceDesktopRow = memo(function WorkspaceDesktopRow({
  desktopDetailsColSpan,
  isExpanded,
  isSelected,
  notice,
  onToggleExpanded,
  onToggleSelection,
  row,
  showCreatedColumn,
  showSurfacesColumn,
  stickyTableHeadClassName: _stickyTableHeadClassName,
  tableCellClassName,
}: {
  desktopDetailsColSpan: number;
  isExpanded: boolean;
  isSelected: boolean;
  notice: WorkspaceInlineNotice;
  onToggleExpanded: (rowId: string) => void;
  onToggleSelection: (rowId: string, checked: boolean) => void;
  row: WorkspaceResourceRow;
  showCreatedColumn: boolean;
  showSurfacesColumn: boolean;
  stickyTableHeadClassName?: string;
  tableCellClassName: string;
}) {
  const t = useT("workspaces");
  const router = useRouter();
  const reviewBadgeStatus = reviewStatusByTone[row.review.tone];
  const resourceSummary = summarizeResources(row.surfaceLinks);

  const handleRowClick = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "BUTTON" ||
        target.closest("button") ||
        target.tagName === "A" ||
        target.closest("a") ||
        target.tagName === "INPUT" ||
        target.closest("input") ||
        target.closest(".resource-expando")
      ) {
        return;
      }
      router.push(row.openLink.href);
    },
    [router, row.openLink.href],
  );

  return (
    <Fragment>
      <TableRow
        className="align-top cursor-pointer transition-colors hover:bg-accent/8"
        data-state={isSelected ? "selected" : undefined}
        id={`workspace-${row.id}`}
        onClick={handleRowClick}
      >
        <TableCell className={tableCellClassName}>
          <SelectionCheckbox
            checked={isSelected}
            label={t("table.selection.selectWorkspace", { name: row.name })}
            onCheckedChange={(checked) => onToggleSelection(row.id, checked)}
          />
        </TableCell>
        <TableCell className={tableCellClassName}>
          <div className="grid gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <Link className="font-semibold text-foreground transition-colors hover:text-primary" href={row.openLink.href}>
                {row.displayName}
              </Link>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{row.slug}</span>
            </div>
          </div>
        </TableCell>

        <TableCell className={tableCellClassName}>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge indicator status={row.lifecycle.status}>
              {row.lifecycle.label}
            </StatusBadge>
            <StatusBadge status={reviewBadgeStatus}>{row.review.label}</StatusBadge>
            <StatusBadge status={row.setup.status}>{row.setup.label}</StatusBadge>
          </div>
        </TableCell>

        {showCreatedColumn ? (
          <TableCell className={cn(tableCellClassName, "text-sm text-foreground")}>{row.createdAtLabel}</TableCell>
        ) : null}
        <TableCell className={cn(tableCellClassName, "text-sm text-foreground")}>{row.updatedAtLabel}</TableCell>

        {showSurfacesColumn ? (
          <TableCell className={tableCellClassName}>
            <span className="text-xs text-muted-foreground">
              {resourceSummary ?? "—"}
            </span>
          </TableCell>
        ) : null}

        <TableCell className={tableCellClassName}>
          <div className="flex justify-end gap-2">
            <WorkspaceDetailsToggleButton
              isExpanded={isExpanded}
              onClick={() => onToggleExpanded(row.id)}
            />
          </div>
        </TableCell>
      </TableRow>

      <TableRow
        aria-hidden={!isExpanded}
        className={cn(
          "resource-detail-panel hover:bg-transparent",
          isExpanded
            ? "bg-[color:color-mix(in_srgb,var(--surface-1)_82%,var(--surface-canvas)_18%)]"
            : "border-b-0 bg-transparent",
        )}
        data-state={isExpanded ? "open" : "closed"}
      >
        <TableCell className="py-0" colSpan={desktopDetailsColSpan}>
          <div className="resource-expando" data-state={isExpanded ? "open" : "closed"}>
            <div className="resource-expando__inner">
              <WorkspaceSummaryPanel notice={notice} row={row} />
            </div>
          </div>
        </TableCell>
      </TableRow>
    </Fragment>
  );
});

export function WorkspaceResourceList({
  organizationId,
  redirectPath,
  density,
  columnSet,
  onColumnSetChange,
  onDensityChange,
  rows,
  emptyState,
  focusedWorkspaceId = null,
  noticeState = null,
  noticeMessage = null,
}: WorkspaceResourceListProps) {
  const t = useT("workspaces");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [showComparePanel, setShowComparePanel] = useState(false);
  const mobileRowGapClassName = density === "compact" ? "gap-2.5" : "gap-3";
  const mobileRowPaddingClassName = density === "compact" ? "px-4 py-3" : "px-4 py-4";
  const tableCellClassName = density === "compact" ? "py-2" : "py-3";
  const stickyTableHeadClassName = "sticky top-0 z-10 backdrop-blur";
  const showCreatedColumn = columnSet === "audit";
  const showSurfacesColumn = columnSet !== "minimal";
  const desktopDetailsColSpan = 5 + (showCreatedColumn ? 1 : 0) + (showSurfacesColumn ? 1 : 0);

  const visibleRowIds = useMemo(() => rows.map((row) => row.id), [rows]);
  const visibleRowIdSet = useMemo(() => new Set(visibleRowIds), [visibleRowIds]);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedRows = useMemo(() => rows.filter((row) => selectedIdSet.has(row.id)), [rows, selectedIdSet]);
  const selectedCount = selectedIds.length;
  const firstSelectedRow = selectedRows[0] ?? null;
  const hasSelection = selectedCount > 0;
  const allSelected = rows.length > 0 && rows.every((row) => selectedIdSet.has(row.id));
  const partiallySelected = selectedCount > 0 && !allSelected;

  useEffect(() => {
    setSelectedIds((current) => current.filter((id) => visibleRowIdSet.has(id)));
  }, [visibleRowIdSet]);

  useEffect(() => {
    if (expandedRowId && !visibleRowIdSet.has(expandedRowId)) {
      setExpandedRowId(null);
    }
  }, [expandedRowId, visibleRowIdSet]);

  useEffect(() => {
    if (focusedWorkspaceId && visibleRowIdSet.has(focusedWorkspaceId)) {
      setExpandedRowId(focusedWorkspaceId);
    }
  }, [focusedWorkspaceId, visibleRowIdSet]);

  useEffect(() => {
    if (selectedCount < 2 && showComparePanel) {
      setShowComparePanel(false);
    }
  }, [selectedCount, showComparePanel]);

  const handleSelectAll = useCallback((checked: boolean) => {
    setSelectedIds(checked ? visibleRowIds : []);
  }, [visibleRowIds]);

  const handleRowSelection = useCallback((workspaceId: string, checked: boolean) => {
    setSelectedIds((current) => {
      if (checked) {
        return current.includes(workspaceId) ? current : [...current, workspaceId];
      }

      return current.filter((id) => id !== workspaceId);
    });
  }, []);

  const handleToggleExpanded = useCallback((rowId: string) => {
    setExpandedRowId((current) => (current === rowId ? null : rowId));
  }, []);

  const handleClearSelection = useCallback(() => {
    setSelectedIds([]);
  }, []);

  const handleToggleComparePanel = useCallback(() => {
    setShowComparePanel((current) => !current);
  }, []);

  const handleHideComparePanel = useCallback(() => {
    setShowComparePanel(false);
  }, []);

  function handleInspectSelection() {
    if (!firstSelectedRow) {
      return;
    }

    setExpandedRowId(firstSelectedRow.id);

    window.requestAnimationFrame(() => {
      document.getElementById(`workspace-${firstSelectedRow.id}`)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }

  const getRowNotice = useCallback((rowId: string): WorkspaceInlineNotice => {
    if (!(focusedWorkspaceId === rowId && noticeState && noticeMessage)) {
      return null;
    }

    return {
      label: noticeState.label,
      message: noticeMessage,
      tone:
        noticeState.status === "error"
          ? "error"
          : noticeState.status === "warning"
            ? "warning"
            : "success",
    };
  }, [focusedWorkspaceId, noticeMessage, noticeState]);

  return (
    <ResourceTableSection
      actions={
        <WorkspaceTableViewMenu
          columnSet={columnSet}
          density={density}
          onColumnSetChange={onColumnSetChange}
          onDensityChange={onDensityChange}
        />
      }
      bulkBar={
        hasSelection ? (
          <WorkspaceSelectionBar
            allSelected={allSelected}
            firstSelectedHref={firstSelectedRow?.openLink.href ?? null}
            onCheckedChange={handleSelectAll}
            onClearSelection={handleClearSelection}
            onInspectSelection={handleInspectSelection}
            onToggleComparePanel={handleToggleComparePanel}
            organizationId={organizationId}
            partiallySelected={partiallySelected}
            redirectPath={redirectPath}
            selectedCount={selectedCount}
            selectedIds={selectedIds}
            showComparePanel={showComparePanel}
          />
        ) : null
      }
      emptyState={<div className="px-4 py-10">{emptyState}</div>}
      meta={t("table.meta", { count: rows.length })}
      title={t("title")}
    >
      {rows.length ? (
        <>
          {hasSelection && showComparePanel && selectedRows.length >= 2 ? (
            <WorkspaceComparePanel onHide={handleHideComparePanel} rows={selectedRows} />
          ) : null}

          <div className="xl:hidden">
            {rows.map((row) => {
              const isSelected = selectedIdSet.has(row.id);
              const isExpanded = expandedRowId === row.id;

              return (
                <WorkspaceMobileRow
                  isExpanded={isExpanded}
                  isSelected={isSelected}
                  key={row.id}
                  mobileRowGapClassName={mobileRowGapClassName}
                  mobileRowPaddingClassName={mobileRowPaddingClassName}
                  notice={getRowNotice(row.id)}
                  onToggleExpanded={handleToggleExpanded}
                  onToggleSelection={handleRowSelection}
                  row={row}
                  showSurfacesColumn={showSurfacesColumn}
                />
              );
            })}
          </div>

          <div className="hidden xl:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className={cn("w-12", stickyTableHeadClassName)}>
                    <SelectionCheckbox
                      checked={allSelected}
                      indeterminate={partiallySelected}
                      label={t("table.selection.selectAllVisible")}
                      onCheckedChange={handleSelectAll}
                    />
                  </TableHead>
                  <TableHead className={stickyTableHeadClassName}>{t("table.columns.workspace")}</TableHead>
                  <TableHead className={stickyTableHeadClassName}>{t("table.columns.state")}</TableHead>
                  {showCreatedColumn ? (
                    <TableHead className={stickyTableHeadClassName}>{t("table.columns.created")}</TableHead>
                  ) : null}
                  <TableHead className={stickyTableHeadClassName}>{t("table.columns.updated")}</TableHead>
                  {showSurfacesColumn ? (
                    <TableHead className={stickyTableHeadClassName}>{t("table.columns.resources")}</TableHead>
                  ) : null}
                  <TableHead className={cn("text-right", stickyTableHeadClassName)}>{t("table.columns.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const isSelected = selectedIdSet.has(row.id);
                  const isExpanded = expandedRowId === row.id;

                  return (
                    <WorkspaceDesktopRow
                      desktopDetailsColSpan={desktopDetailsColSpan}
                      isExpanded={isExpanded}
                      isSelected={isSelected}
                      key={row.id}
                      notice={getRowNotice(row.id)}
                      onToggleExpanded={handleToggleExpanded}
                      onToggleSelection={handleRowSelection}
                      row={row}
                      showCreatedColumn={showCreatedColumn}
                      showSurfacesColumn={showSurfacesColumn}
                      tableCellClassName={tableCellClassName}
                    />
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </>
      ) : null}
    </ResourceTableSection>
  );
}
