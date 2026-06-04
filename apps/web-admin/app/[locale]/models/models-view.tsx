"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SelfServeVirtualKeyBootstrap } from "@teamops/contracts";
import {
  Copy,
  RefreshCw,
  Search,
  Link as LinkIcon,
  Blocks,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link } from "@/i18n/navigation";
import {
  ConsoleAuthRedirectError,
  ConsoleHttpError,
  fetchSelfServeVirtualKeyBootstrap,
} from "@/app/lib/console-api-client";
import { useShellSession } from "@/app/components/capability-provider";
import { getUserErrorMessage } from "@/app/lib/user-facing-error";
import { getAccessBootstrapGate } from "../access/access-bootstrap-gate";

export function ModelsView({
  locale,
  workspaceId,
}: {
  locale: string;
  workspaceId: string | null;
}) {
  const isZh = locale.startsWith("zh");
  const shellSession = useShellSession();

  const [loading, setLoading] = useState(true);
  const [bootstrap, setBootstrap] =
    useState<SelfServeVirtualKeyBootstrap | null>(null);
  const [loadError, setLoadError] = useState<ConsoleHttpError | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const t = useCallback((zh: string, en: string) => (isZh ? zh : en), [isZh]);

  const loadBootstrap = useCallback(async () => {
    if (!workspaceId) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setLoadError(null);
      const data = await fetchSelfServeVirtualKeyBootstrap(workspaceId);
      setBootstrap(data);
    } catch (error) {
      if (error instanceof ConsoleAuthRedirectError) return;
      setBootstrap(null);
      if (error instanceof ConsoleHttpError) {
        setLoadError(error);
      } else {
        setLoadError(
          new ConsoleHttpError(
            t("无法加载模型列表", "Failed to load models"),
            500,
            null,
          ),
        );
      }
    } finally {
      setLoading(false);
    }
  }, [workspaceId, t]);

  const accessBootstrapGate = getAccessBootstrapGate({
    workspaceId,
    shellSessionStatus: shellSession.isLoading
      ? "loading"
      : (shellSession.session?.auth.status ?? "unauthenticated"),
    identityResolution:
      shellSession.session?.workspace.identityResolution ?? null,
    workspaceIdentityState: {
      status: shellSession.workspaceIdentityState.status,
      workspaceId: shellSession.workspaceIdentityState.workspaceId,
    },
  });

  useEffect(() => {
    if (accessBootstrapGate !== "ready") {
      setBootstrap(null);
      setLoadError(null);
      setLoading(accessBootstrapGate === "loading_session");
      return;
    }
    void loadBootstrap();
  }, [accessBootstrapGate, loadBootstrap]);

  const availableSources = bootstrap?.availableSources ?? [];
  const availableModels = bootstrap?.availableModels ?? [];
  const query = searchQuery.trim().toLowerCase();

  const modelRows = useMemo(() => {
    const rows = new Map<
      string,
      {
        id: string;
        label: string;
        sources: Array<{
          providerConnectionId: string;
          label: string;
          provider: string;
        }>;
      }
    >();

    for (const source of availableSources) {
      const sourceModelIds = new Set<string>();
      for (const model of source.models) {
        const normalizedModelId = model.id.trim().toLowerCase();
        if (!normalizedModelId || sourceModelIds.has(normalizedModelId)) {
          continue;
        }
        sourceModelIds.add(normalizedModelId);

        const nextSource = {
          providerConnectionId: source.providerConnectionId,
          label: source.label,
          provider: source.provider,
        };
        const existing = rows.get(normalizedModelId);

        if (!existing) {
          rows.set(normalizedModelId, {
            id: model.id,
            label: model.label ?? model.id,
            sources: [nextSource],
          });
          continue;
        }

        if (
          existing.label === existing.id &&
          model.label &&
          model.label !== model.id
        ) {
          existing.label = model.label;
        }

        if (
          !existing.sources.some(
            (candidate) =>
              candidate.providerConnectionId === source.providerConnectionId,
          )
        ) {
          existing.sources.push(nextSource);
        }
      }
    }

    for (const model of availableModels) {
      const normalizedModelId = model.id.trim().toLowerCase();
      if (!normalizedModelId) {
        continue;
      }

      const existing = rows.get(normalizedModelId);
      if (!existing) {
        rows.set(normalizedModelId, {
          id: model.id,
          label: model.label ?? model.id,
          sources: [],
        });
        continue;
      }

      if (
        existing.label === existing.id &&
        model.label &&
        model.label !== model.id
      ) {
        existing.label = model.label;
      }
    }

    return [...rows.values()].sort((left, right) =>
      left.id.localeCompare(right.id),
    );
  }, [availableModels, availableSources]);

  const filteredModels = useMemo(() => {
    if (!query) {
      return modelRows;
    }

    return modelRows.filter((model) => {
      const sourceText = model.sources
        .flatMap((source) => [source.label, source.provider])
        .join(" ")
        .toLowerCase();

      return (
        model.id.toLowerCase().includes(query) ||
        model.label.toLowerCase().includes(query) ||
        sourceText.includes(query)
      );
    });
  }, [modelRows, query]);

  const multiChannelModelCount = modelRows.filter(
    (model) => model.sources.length > 1,
  ).length;
  const totalModels = modelRows.length;
  const totalChannels = availableSources.length;

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (
    accessBootstrapGate !== "ready" &&
    accessBootstrapGate !== "switching_identity"
  ) {
    // Show errors or workspace missing state similarly to AccessView
    return (
      <div className="flex h-64 flex-col items-center justify-center space-y-4 rounded-xl border border-border/60 bg-background p-6">
        <p className="text-sm font-medium text-muted-foreground">
          {t(
            "身份同步失败或未选择工作区。",
            "Identity sync failed or no workspace selected.",
          )}
        </p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-xl border border-border/60 bg-background p-6">
        <p className="text-sm font-semibold text-red-500">
          {getUserErrorMessage(loadError, "Error loading models")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1">
          <h1 className="text-3xl font-black tracking-tight text-foreground">
            {t("可用模型大厅", "Model Catalog")}
          </h1>
          <p className="text-base text-muted-foreground">
            {t(
              `当前工作区提供 ${totalModels} 个可调用模型，已按模型名称整理，可直接复制接入。`,
              `This workspace exposes ${totalModels} callable models, organized by model name for direct copy and use.`,
            )}
          </p>
        </div>
        <div className="flex shrink-0 gap-3">
          <Button
            asChild
            variant="outline"
            className="border-border/60 bg-background/80 text-foreground hover:bg-muted/60 hover:text-foreground"
          >
            <Link
              href={`/access${workspaceId ? `?workspaceId=${workspaceId}` : ""}`}
            >
              <LinkIcon className="mr-2 size-4" />
              {t("获取接入代码", "Get access code")}
            </Link>
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-border/60 bg-[color:color-mix(in_srgb,var(--surface-1)_96%,var(--surface-canvas)_4%)]">
        <div className="flex flex-col gap-4 border-b border-border/60 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="secondary"
              className="bg-background/80 font-mono text-[10px]"
            >
              {totalModels} {t("个模型", "models")}
            </Badge>
            <Badge
              variant="outline"
              className="border-border/60 bg-background/80 text-[10px]"
            >
              {totalChannels} {t("个渠道", "channels")}
            </Badge>
            <Badge
              variant="outline"
              className="border-border/60 bg-background/80 text-[10px]"
            >
              {multiChannelModelCount}{" "}
              {t("个多渠道模型", "multi-route models")}
            </Badge>
          </div>
          <div className="relative w-full max-w-md">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={t(
                "按模型名、渠道名或协议搜索...",
                "Search by model, channel, or protocol...",
              )}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-10 border-border/60 bg-background pl-9"
            />
          </div>
        </div>
        <div className="px-5 py-3 text-sm text-muted-foreground">
          {t(
            "按模型去重展示；同名模型会合并渠道。",
            "Deduplicated by model; shared models merge channels.",
          )}
        </div>
      </div>

      {availableSources.length === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center space-y-4 rounded-xl border border-border/60 border-dashed bg-muted/10 p-6 text-center">
          <Blocks className="size-8 text-muted-foreground/50" />
          <p className="text-sm font-medium text-muted-foreground">
            {t(
              "当前工作区暂未分配任何可用渠道或模型。",
              "No channels or models are assigned to this workspace yet.",
            )}
          </p>
        </div>
      ) : filteredModels.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-sm text-muted-foreground">
            {t("未找到匹配的模型", "No matching models found")}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border/60 bg-background">
          <div className="hidden grid-cols-[minmax(0,1.6fr)_120px_minmax(0,2.4fr)] border-b border-border/60 bg-muted/20 px-5 py-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground md:grid">
            <span>{t("模型", "Model")}</span>
            <span>{t("渠道数", "Channels")}</span>
            <span>{t("可用渠道", "Available channels")}</span>
          </div>
          <div className="divide-y divide-border/60">
            {filteredModels.map((model) => (
              <div
                key={model.id}
                className="flex flex-col gap-4 px-5 py-4 transition-colors hover:bg-muted/10 md:grid md:grid-cols-[minmax(0,1.6fr)_120px_minmax(0,2.4fr)] md:items-start"
              >
                <div className="min-w-0 space-y-2">
                  <button
                    type="button"
                    title={t("点击复制模型名称", "Click to copy model name")}
                    onClick={() => {
                      navigator.clipboard.writeText(model.id);
                      toast.success(t("模型名称已复制", "Model name copied"));
                    }}
                    className="group inline-flex max-w-full items-center gap-2 rounded-md text-left text-foreground transition-colors hover:text-primary"
                  >
                    <code className="truncate font-mono text-sm font-semibold">
                      {model.id}
                    </code>
                    <Copy className="size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
                  </button>
                  {model.label !== model.id ? (
                    <p className="text-sm text-muted-foreground">
                      {model.label}
                    </p>
                  ) : null}
                </div>

                <div className="flex items-center gap-2">
                  <Badge
                    variant="secondary"
                    className="bg-background/80 font-mono text-[10px]"
                  >
                    {model.sources.length}{" "}
                    {t(
                      "个渠道",
                      model.sources.length === 1 ? "channel" : "channels",
                    )}
                  </Badge>
                  {model.sources.length > 1 ? (
                    <span className="text-xs text-muted-foreground">
                      {t("多路由", "Multi-route")}
                    </span>
                  ) : null}
                </div>

                <div className="flex flex-wrap gap-2">
                  {model.sources.length > 0 ? (
                    model.sources.map((source) => (
                      <div
                        key={`${model.id}-${source.providerConnectionId}`}
                        className="inline-flex items-center gap-2 rounded-md border border-border/60 bg-[color:color-mix(in_srgb,var(--surface-1)_92%,white_8%)] px-2.5 py-1.5 text-xs text-foreground"
                      >
                        <span className="font-medium">{source.label}</span>
                        <span className="text-muted-foreground">
                          {source.provider}
                        </span>
                      </div>
                    ))
                  ) : (
                    <span className="text-sm text-muted-foreground">
                      {t(
                        "目录已同步，暂无渠道详情。",
                        "Catalog synced, channel details unavailable.",
                      )}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
