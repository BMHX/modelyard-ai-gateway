"use client";

import { RefreshCw, Search, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type {
  ProviderConnectionModelCatalog,
  ProviderModelConfig,
  ProviderModelConfigItem,
} from "@teamops/contracts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useT } from "@/app/lib/i18n-client";
import { cn } from "@/lib/utils";

import {
  addProviderCustomModelItem,
  buildProviderModelConfigJson,
  removeProviderModelItem,
  upsertProviderModelItem,
} from "../provider-model-config";
import type { ProviderPresetModel } from "../provider-model-registry";

type ProviderModelManagerProps = {
  value: ProviderModelConfig;
  onChange: (value: ProviderModelConfig) => void;
  presetModels: ProviderPresetModel[];
  catalog: ProviderConnectionModelCatalog | null;
  isCatalogLoading?: boolean;
  onLoadCatalog?: (() => void) | null;
  canLoadCatalog?: boolean;
  catalogDisabledReason?: string | null;
  hiddenInputName?: string;
  legacyModelIds?: Set<string>;
  disabled?: boolean;
};

function ModelRow({
  checked,
  disabled,
  title,
  subtitle,
  badge,
  trailing,
  onCheckedChange,
}: {
  checked?: boolean;
  disabled?: boolean;
  title: string;
  subtitle?: string | null;
  badge?: ReactNode;
  trailing?: ReactNode;
  onCheckedChange?: (checked: boolean) => void;
}) {
  const content = (
    <>
      <div className="flex min-w-0 items-center gap-3">
        {onCheckedChange ? (
          <input
            checked={checked}
            className="h-4 w-4 rounded border-border"
            disabled={disabled}
            onChange={(event) => onCheckedChange(event.currentTarget.checked)}
            type="checkbox"
          />
        ) : (
          <span className="flex size-4 items-center justify-center rounded-full bg-[color:color-mix(in_srgb,var(--surface-2)_70%,white_30%)]">
            <span className="size-1.5 rounded-full bg-muted-foreground/70" />
          </span>
        )}
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[color:color-mix(in_srgb,var(--surface-2)_68%,white_32%)] text-muted-foreground">
          <Sparkles className="size-3.5" />
        </span>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate text-[15px] font-medium tracking-tight text-foreground">
              {title}
            </p>
            {badge}
          </div>
          {subtitle ? (
            <p className="truncate text-[12px] text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
      </div>
      {trailing ? <div className="shrink-0">{trailing}</div> : null}
    </>
  );

  if (onCheckedChange) {
    return (
      <label className="flex min-h-12 items-center justify-between gap-3 px-4 py-2 transition-colors hover:bg-muted/[0.18]">
        {content}
      </label>
    );
  }

  return (
    <div className="flex min-h-12 items-center justify-between gap-3 px-4 py-2">
      {content}
    </div>
  );
}

export function ProviderModelManager({
  value,
  onChange,
  presetModels,
  catalog,
  isCatalogLoading = false,
  onLoadCatalog,
  canLoadCatalog = false,
  catalogDisabledReason,
  hiddenInputName,
  legacyModelIds,
  disabled = false,
}: ProviderModelManagerProps) {
  const tr = useT("providers");
  const [searchQuery, setSearchQuery] = useState("");
  const [newCustomModelLabel, setNewCustomModelLabel] = useState("");
  const [newCustomModelId, setNewCustomModelId] = useState("");
  const [activeTab, setActiveTab] = useState("preset");
  const lastReadyCatalogSignatureRef = useRef<string | null>(null);
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();

  const selectedIds = useMemo(
    () => new Set(value.items.map((item) => item.id)),
    [value.items],
  );
  const presetIdSet = useMemo(
    () => new Set(presetModels.map((item) => item.id)),
    [presetModels],
  );
  const catalogIdSet = useMemo(
    () => new Set((catalog?.items ?? []).map((item) => item.id.trim().toLowerCase())),
    [catalog?.items],
  );
  const visiblePresetModels = useMemo(
    () =>
      presetModels.filter((item) => {
        if (!normalizedSearchQuery) {
          return true;
        }

        return item.id.includes(normalizedSearchQuery) || item.label.toLowerCase().includes(normalizedSearchQuery);
      }),
    [normalizedSearchQuery, presetModels],
  );
  const visibleCatalogModels = useMemo(
    () =>
      (catalog?.items ?? []).filter((item) => {
        if (!normalizedSearchQuery) {
          return true;
        }

        return (
          item.id.toLowerCase().includes(normalizedSearchQuery) ||
          item.label.toLowerCase().includes(normalizedSearchQuery) ||
          item.ownedBy?.toLowerCase().includes(normalizedSearchQuery)
        );
      }),
    [catalog?.items, normalizedSearchQuery],
  );
  const selectedCustomItems = useMemo(
    () =>
      value.items.filter((item) => {
        if (item.source !== "custom") {
          return false;
        }
        if (!normalizedSearchQuery) {
          return true;
        }
        return (
          item.id.toLowerCase().includes(normalizedSearchQuery) ||
          item.label?.toLowerCase().includes(normalizedSearchQuery)
        );
      }),
    [value.items, normalizedSearchQuery],
  );

  function handleToggleModel(model: ProviderModelConfigItem, checked: boolean) {
    if (checked) {
      onChange(upsertProviderModelItem(value, model));
      return;
    }

    onChange(removeProviderModelItem(value, model.id));
  }

  function handleAddCustomModel() {
    const nextId = newCustomModelId.trim();
    const nextLabel = newCustomModelLabel.trim();
    if (!nextId || !nextLabel) {
      return;
    }

    onChange(
      addProviderCustomModelItem(value, {
        id: nextId,
        label: nextLabel,
      }),
    );
    setNewCustomModelLabel("");
    setNewCustomModelId("");
  }

  const selectedModelSummary = value.items.slice().sort((left, right) => left.id.localeCompare(right.id));

  useEffect(() => {
    const nextReadyCatalogSignature =
      catalog?.status === "ready" && catalog.items.length > 0
        ? `${catalog.fetchedAt}:${catalog.items.length}`
        : null;

    if (!nextReadyCatalogSignature) {
      lastReadyCatalogSignatureRef.current = null;
      return;
    }

    if (lastReadyCatalogSignatureRef.current === nextReadyCatalogSignature) {
      return;
    }

    lastReadyCatalogSignatureRef.current = nextReadyCatalogSignature;
    setActiveTab((currentTab) => (currentTab === "preset" ? "catalog" : currentTab));
  }, [catalog?.fetchedAt, catalog?.items.length, catalog?.status]);

  return (
    <div className="space-y-4">
      {hiddenInputName ? (
        <input
          name={hiddenInputName}
          type="hidden"
          value={buildProviderModelConfigJson(value)}
        />
      ) : null}

      <div className="min-w-0 rounded-[24px] border border-border/60 bg-background">
        <div className="flex flex-col gap-3 border-b border-border/60 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <p className="text-[17px] font-semibold tracking-tight text-foreground">
              {tr("modelManager.sectionTitle")}
            </p>
            <span className="rounded-full bg-[color:color-mix(in_srgb,var(--surface-2)_78%,white_22%)] px-2.5 py-0.5 text-[12px] text-muted-foreground">
              {selectedModelSummary.length}
            </span>
          </div>

          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="rounded-full border-border/60 pl-8"
              onChange={(event) => setSearchQuery(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                }
              }}
              placeholder={tr("modelManager.searchPlaceholder")}
              value={searchQuery}
            />
          </div>
        </div>

        <Tabs className="w-full" onValueChange={setActiveTab} value={activeTab}>
          <div className="px-5 pt-4">
            <TabsList className="w-full sm:w-auto h-9">
              <TabsTrigger value="preset" className="text-[13px] gap-2">
                {tr("modelManager.recommendedSection")}
                <span className="rounded-full bg-muted-foreground/15 px-1.5 py-0.5 text-[10px] leading-none">
                  {presetModels.length}
                </span>
              </TabsTrigger>
              <TabsTrigger value="catalog" className="text-[13px] gap-2">
                {tr("modelManager.catalogSection")}
                <span className="rounded-full bg-muted-foreground/15 px-1.5 py-0.5 text-[10px] leading-none">
                  {catalog?.status === "ready" ? catalog.items.length : 0}
                </span>
              </TabsTrigger>
              <TabsTrigger value="custom" className="text-[13px] gap-2">
                {tr("modelManager.customSource")}
                <span className="rounded-full bg-muted-foreground/15 px-1.5 py-0.5 text-[10px] leading-none">
                  {selectedCustomItems.length}
                </span>
              </TabsTrigger>
            </TabsList>
          </div>

          <div className="px-5 pb-5 pt-3">
            <TabsContent value="preset" className="mt-0 outline-none">
              <div className="rounded-[16px] border border-border/60 bg-[color:color-mix(in_srgb,var(--surface-1)_60%,white_40%)]">
                <div className="divide-y divide-border/40 max-h-[35vh] overflow-y-auto overscroll-contain rounded-[16px]">
                  {visiblePresetModels.map((model) => {
                    const checked = selectedIds.has(model.id);
                    return (
                      <ModelRow
                        badge={<Badge variant="outline">{tr("modelManager.presetBadge")}</Badge>}
                        key={model.id}
                        checked={checked}
                        disabled={disabled}
                        onCheckedChange={(nextChecked) =>
                          handleToggleModel(
                            {
                              id: model.id,
                              label: model.label,
                              source: "preset",
                            },
                            nextChecked,
                          )
                        }
                        subtitle={model.id}
                        title={model.label}
                      />
                    );
                  })}
                  {visiblePresetModels.length === 0 ? (
                    <p className="px-5 py-8 text-center text-sm text-muted-foreground">
                      {tr("modelManager.noPresetResults")}
                    </p>
                  ) : null}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="catalog" className="mt-0 outline-none flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Button
                  disabled={disabled || !onLoadCatalog || !canLoadCatalog || isCatalogLoading}
                  onClick={() => onLoadCatalog?.()}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <RefreshCw className={cn("mr-1.5 size-3.5", isCatalogLoading ? "animate-spin" : "")} />
                  {tr("modelManager.loadCatalog")}
                </Button>
                <p className="text-xs text-muted-foreground">
                  {catalog?.status === "ready"
                    ? tr("modelManager.catalogReady")
                    : catalog?.status === "empty"
                      ? tr("modelManager.catalogEmpty")
                      : catalog?.status === "error"
                        ? catalog.message ?? tr("modelManager.catalogError")
                        : !canLoadCatalog && catalogDisabledReason
                          ? catalogDisabledReason
                          : tr("modelManager.catalogIdle")}
                </p>
              </div>

              <div className="rounded-[16px] border border-border/60 bg-[color:color-mix(in_srgb,var(--surface-1)_60%,white_40%)]">
                <div className="divide-y divide-border/40 max-h-[35vh] overflow-y-auto overscroll-contain rounded-[16px]">
                  {visibleCatalogModels.map((model) => {
                    const normalizedId = model.id.trim().toLowerCase();
                    const checked = selectedIds.has(normalizedId);
                    return (
                      <ModelRow
                        badge={<Badge variant="outline">{tr("modelManager.catalogBadge")}</Badge>}
                        key={model.id}
                        checked={checked}
                        disabled={disabled}
                        onCheckedChange={(nextChecked) =>
                          handleToggleModel(
                            {
                              id: model.id,
                              label: model.label,
                              source: "catalog",
                            },
                            nextChecked,
                          )
                        }
                        subtitle={model.id}
                        title={model.label}
                        trailing={
                          model.ownedBy ? (
                            <Badge variant="secondary" className="hidden sm:inline-flex">
                              {model.ownedBy}
                            </Badge>
                          ) : null
                        }
                      />
                    );
                  })}
                  {catalog?.status === "ready" && visibleCatalogModels.length === 0 ? (
                    <p className="px-5 py-8 text-center text-sm text-muted-foreground">
                      {tr("modelManager.noCatalogResults")}
                    </p>
                  ) : null}
                  {catalog?.status !== "ready" ? (
                    <p className="px-5 py-8 text-center text-sm text-muted-foreground">
                      {tr("modelManager.catalogIdle")}
                    </p>
                  ) : null}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="custom" className="mt-0 outline-none flex flex-col gap-3">
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
                <div className="space-y-1.5">
                  <label className="text-[12px] font-medium text-muted-foreground">
                    {tr("modelManager.customLabelInputLabel")}
                  </label>
                  <Input
                    className="rounded-2xl border-border/60"
                    onChange={(event) => setNewCustomModelLabel(event.currentTarget.value)}
                    placeholder={tr("modelManager.customLabelInputPlaceholder")}
                    value={newCustomModelLabel}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[12px] font-medium text-muted-foreground">
                    {tr("modelManager.customIdInputLabel")}
                  </label>
                  <Input
                    className="rounded-2xl border-border/60"
                    onChange={(event) => setNewCustomModelId(event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.nativeEvent.isComposing) {
                        return;
                      }
                      if (event.key === "Enter") {
                        event.preventDefault();
                        handleAddCustomModel();
                      }
                    }}
                    placeholder={tr("modelManager.customIdInputPlaceholder")}
                    value={newCustomModelId}
                  />
                </div>

                <Button
                  className="rounded-full px-5"
                  disabled={disabled || !newCustomModelLabel.trim() || !newCustomModelId.trim()}
                  onClick={handleAddCustomModel}
                  type="button"
                >
                  {tr("modelManager.addCustom")}
                </Button>
              </div>

              <p className="text-[12px] leading-5 text-muted-foreground">
                {tr("modelManager.customIdHint")}
              </p>

              <div className="rounded-[16px] border border-border/60 bg-[color:color-mix(in_srgb,var(--surface-1)_60%,white_40%)]">
                <div className="divide-y divide-border/40 max-h-[35vh] overflow-y-auto overscroll-contain rounded-[16px]">
                  {selectedCustomItems.map((item) => (
                    <ModelRow
                      badge={<Badge variant="outline">{tr("modelManager.customBadge")}</Badge>}
                      key={item.id}
                      subtitle={item.id}
                      title={item.label ?? item.id}
                      trailing={
                        <Button
                          className="rounded-full"
                          disabled={disabled}
                          onClick={() => onChange(removeProviderModelItem(value, item.id))}
                          size="icon"
                          type="button"
                          variant="ghost"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      }
                    />
                  ))}
                  {selectedCustomItems.length === 0 ? (
                    <p className="px-5 py-8 text-center text-sm text-muted-foreground">
                      {tr("modelManager.noCustomModels")}
                    </p>
                  ) : null}
                </div>
              </div>
            </TabsContent>
          </div>
        </Tabs>
      </div>

      {selectedModelSummary.length > 0 ? (
        <div className="rounded-[20px] border border-border/60 bg-[color:color-mix(in_srgb,var(--surface-1)_85%,white_15%)] px-4 py-3.5">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-sm font-medium tracking-tight text-foreground">
              {tr("modelManager.selectionTitle")}
            </p>
            <span className="rounded-full bg-background/90 px-2.5 py-0.5 text-[11px] text-muted-foreground">
              {selectedModelSummary.length}
            </span>
          </div>

          <div className="flex flex-wrap gap-2">
            {selectedModelSummary.map((item) => {
              const isLegacy =
                legacyModelIds?.has(item.id) ||
                (item.source !== "custom" && !presetIdSet.has(item.id) && !catalogIdSet.has(item.id));

              return (
                <div
                  key={item.id}
                  className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background px-3 py-1.5 text-xs text-foreground"
                >
                  <Sparkles className="size-3 text-muted-foreground" />
                  <span>{item.label ?? item.id}</span>
                  <Badge variant="outline" className="h-5">
                    {item.source === "preset"
                      ? tr("modelManager.presetBadge")
                      : item.source === "catalog"
                        ? tr("modelManager.catalogBadge")
                        : tr("modelManager.customBadge")}
                  </Badge>
                  {isLegacy ? (
                    <Badge variant="warning" className="h-5">
                      {tr("modelManager.legacyBadge")}
                    </Badge>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
