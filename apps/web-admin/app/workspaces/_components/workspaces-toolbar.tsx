"use client";

import { useEffect, useRef, useState } from "react";

import { useT } from "@/app/lib/i18n-client";
import { ResourcePageFiltersCard } from "@/app/components/resource-page-filters-card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { createWorkspaceAction } from "../actions";

type ToolbarOrganization = {
  id: string;
  name: string;
  slug: string;
};

type WorkspacesToolbarProps = {
  organizations: ToolbarOrganization[];
  selectedOrganizationId: string | null;
  createMode?: "inline" | "collapsed";
  query: string;
  viewFilter: "all" | "recent" | "established";
  sortOrder:
    | "updated-desc"
    | "updated-asc"
    | "name-asc"
    | "name-desc"
    | "review-priority";
  density: "comfortable" | "compact";
  columns: "standard" | "audit" | "minimal";
  reviewFilter: "all" | "fresh" | "active" | "dormant";
  queueBucket?: "all" | "over7d" | "over30d" | "over90d";
  currentPageHref: string;
  isBusy?: boolean;
  isCreateOpen?: boolean;
  className?: string;
  onColumnsChange: (value: "standard" | "audit" | "minimal") => void;
  onCreateOpenChange: (open: boolean) => void;
  onDensityChange: (value: "comfortable" | "compact") => void;
  onOrganizationChange: (organizationId: string) => void;
  onQueryChange: (value: string) => void;
  onQueueBucketChange: (value: "all" | "over7d" | "over30d" | "over90d") => void;
  onResetFilters: () => void;
  onReviewFilterChange: (value: "all" | "fresh" | "active" | "dormant") => void;
  onSortOrderChange: (
    value: "updated-desc" | "updated-asc" | "name-asc" | "name-desc" | "review-priority",
  ) => void;
  onViewFilterChange: (value: "all" | "recent" | "established") => void;
};

type SelectFieldOption = {
  label: string;
  value: string;
};

function SelectField({
  htmlFor,
  label,
  onValueChange,
  options,
  value,
}: {
  htmlFor: string;
  label: string;
  onValueChange: (value: string) => void;
  options: SelectFieldOption[];
  value: string;
}) {
  return (
    <div className="grid min-w-0 gap-2">
      <label className="text-[11px] font-medium text-foreground" htmlFor={htmlFor}>
        {label}
      </label>
      <Select onValueChange={onValueChange} value={value}>
        <SelectTrigger id={htmlFor}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function WorkspacesToolbar({
  organizations,
  selectedOrganizationId,
  createMode = "collapsed",
  query,
  viewFilter,
  sortOrder,
  density,
  columns,
  reviewFilter,
  queueBucket = "all",
  currentPageHref,
  isBusy = false,
  isCreateOpen = false,
  className,
  onCreateOpenChange,
  onOrganizationChange,
  onQueryChange,
  onResetFilters,
  onSortOrderChange,
  onViewFilterChange,
}: WorkspacesToolbarProps) {
  const t = useT("workspaces");
  const createNameInputRef = useRef<HTMLInputElement>(null);
  const [queryDraft, setQueryDraft] = useState(query);
  const showOrganizationFilter = organizations.length > 1;
  const showCreateInline = createMode === "inline";
  const showReset =
    Boolean(query) ||
    viewFilter !== "all" ||
    sortOrder !== "updated-desc" ||
    reviewFilter !== "all" ||
    queueBucket !== "all" ||
    density !== "comfortable" ||
    columns !== "standard";
  const selectedOrganizationValue = selectedOrganizationId ?? organizations[0]?.id ?? "";

  useEffect(() => {
    setQueryDraft(query);
  }, [query]);

  useEffect(() => {
    if (!isCreateOpen) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      createNameInputRef.current?.focus();
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [isCreateOpen]);

  useEffect(() => {
    const normalizedDraft = queryDraft.trim();
    const normalizedQuery = query.trim();

    if (normalizedDraft === normalizedQuery) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      onQueryChange(normalizedDraft);
    }, 300);

    return () => window.clearTimeout(timeoutId);
  }, [onQueryChange, query, queryDraft]);

  const organizationOptions = organizations.map((organization) => ({
    label: organization.name,
    value: organization.id,
  }));
  const browseOptions: SelectFieldOption[] = [
    { label: t("toolbar.browseOptions.all"), value: "all" },
    { label: t("toolbar.browseOptions.recent"), value: "recent" },
    { label: t("toolbar.browseOptions.established"), value: "established" },
  ];
  const sortOptions: SelectFieldOption[] = [
    { label: t("toolbar.sortOptions.updatedDesc"), value: "updated-desc" },
    { label: t("toolbar.sortOptions.updatedAsc"), value: "updated-asc" },
    { label: t("toolbar.sortOptions.nameAsc"), value: "name-asc" },
    { label: t("toolbar.sortOptions.nameDesc"), value: "name-desc" },
    { label: t("toolbar.sortOptions.reviewPriority"), value: "review-priority" },
  ];

  if (showCreateInline) {
    return (
      <section className="motion-surface motion-enter rounded-xl border border-border/55 bg-[color:color-mix(in_srgb,var(--surface-1)_94%,var(--surface-canvas)_6%)] p-3">
        <form action={createWorkspaceAction} className="grid gap-3" id="workspace-create">
          <input name="organizationId" type="hidden" value={selectedOrganizationId ?? ""} />
          <input name="redirectPath" type="hidden" value={`${currentPageHref}#workspace-create`} />

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid min-w-0 gap-2">
              <label className="text-[11px] font-medium text-foreground" htmlFor="create-workspace-name">
                {t("toolbar.name")}
              </label>
              <Input
                id="create-workspace-name"
                name="name"
                placeholder={t("toolbar.namePlaceholder")}
                ref={createNameInputRef}
                required
              />
            </div>

            <div className="grid min-w-0 gap-2">
              <label className="text-[11px] font-medium text-foreground" htmlFor="create-workspace-slug">
                {t("toolbar.slug")}
              </label>
              <Input id="create-workspace-slug" name="slug" placeholder={t("toolbar.slugPlaceholder")} />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button onClick={() => onCreateOpenChange(false)} type="button" variant="ghost">
              {t("toolbar.dialog.cancel")}
            </Button>
            <Button type="submit">{t("toolbar.dialog.create")}</Button>
          </div>
        </form>
      </section>
    );
  }

  return (
    <>
      <div className={className}>
        <ResourcePageFiltersCard busy={isBusy} variant="toolbar">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div className="grid flex-1 gap-3 md:grid-cols-2 xl:items-end 2xl:grid-cols-[220px_minmax(0,1fr)_180px_180px]">
            {showOrganizationFilter ? (
              <SelectField
                htmlFor="workspace-organization-filter"
                label={t("toolbar.organization")}
                onValueChange={onOrganizationChange}
                options={organizationOptions}
                value={selectedOrganizationValue}
              />
            ) : null}

            <div className="grid min-w-0 gap-2">
              <label className="text-[11px] font-medium text-foreground" htmlFor="workspace-query">
                {t("toolbar.search")}
              </label>
              <Input
                autoComplete="off"
                id="workspace-query"
                onChange={(event) => setQueryDraft(event.currentTarget.value)}
                placeholder={t("toolbar.searchPlaceholder")}
                type="search"
                value={queryDraft}
              />
            </div>

            <SelectField
              htmlFor="workspace-view"
              label={t("toolbar.browse")}
              onValueChange={(value) => onViewFilterChange(value as "all" | "recent" | "established")}
              options={browseOptions}
              value={viewFilter}
            />

            <SelectField
              htmlFor="workspace-sort"
              label={t("toolbar.sort")}
              onValueChange={(value) =>
                onSortOrderChange(
                  value as "updated-desc" | "updated-asc" | "name-asc" | "name-desc" | "review-priority",
                )
              }
              options={sortOptions}
              value={sortOrder}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 xl:justify-end">
            {showReset ? (
              <Button onClick={onResetFilters} size="sm" type="button" variant="ghost">
                {t("toolbar.reset")}
              </Button>
            ) : null}
            <Button onClick={() => onCreateOpenChange(true)} size="sm" type="button">
              {t("toolbar.newWorkspace")}
            </Button>
          </div>
        </div>
      </ResourcePageFiltersCard>
    </div>

    <Dialog onOpenChange={onCreateOpenChange} open={isCreateOpen}>
      <DialogContent className="w-[min(92vw,42rem)]">
          <DialogHeader>
            <DialogTitle>{t("toolbar.dialog.title")}</DialogTitle>
            <DialogDescription>{t("toolbar.dialog.description")}</DialogDescription>
          </DialogHeader>

          <form action={createWorkspaceAction} className="grid gap-4" id="workspace-create">
            <input name="organizationId" type="hidden" value={selectedOrganizationId ?? ""} />
            <input name="redirectPath" type="hidden" value={`${currentPageHref}#workspace-create`} />

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <label className="text-[11px] font-medium text-foreground" htmlFor="create-workspace-name">
                  {t("toolbar.name")}
                </label>
                <Input
                  id="create-workspace-name"
                  name="name"
                  placeholder={t("toolbar.namePlaceholder")}
                  ref={createNameInputRef}
                  required
                />
              </div>

              <div className="grid gap-2">
                <label className="text-[11px] font-medium text-foreground" htmlFor="create-workspace-slug">
                  {t("toolbar.slug")}
                </label>
                <Input
                  id="create-workspace-slug"
                  name="slug"
                  placeholder={t("toolbar.slugPlaceholder")}
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2">
              <Button onClick={() => onCreateOpenChange(false)} type="button" variant="ghost">
                {t("toolbar.dialog.cancel")}
              </Button>
              <Button type="submit">{t("toolbar.dialog.create")}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
