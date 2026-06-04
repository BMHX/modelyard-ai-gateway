"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SelfServeVirtualKeyBootstrap } from "@teamops/contracts";
import {
  Check,
  ChevronRight,
  Code2,
  Command,
  Copy,
  FileCode2,
  Globe,
  KeyRound,
  Layers,
  RefreshCw,
  Settings2,
  Shield,
  Terminal,
  TriangleAlert,
  UserRound,
  Workflow,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { Link } from "@/i18n/navigation";
import { CopyButton } from "@/app/components/copy-button";
import {
  ConsoleAuthRedirectError,
  ConsoleHttpError,
  fetchSelfServeVirtualKeyBootstrap,
  issueSelfServeVirtualKeyMutation,
} from "@/app/lib/console-api-client";
import {
  useCapabilities,
  useShellSession,
} from "@/app/components/capability-provider";
import { getUserErrorMessage } from "@/app/lib/user-facing-error";
import { getAccessBootstrapGate } from "./access-bootstrap-gate";
import {
  getIssueKeyFeedback,
  idleIssueKeyActionState,
  resolveIssueKeyFailure,
  type IssueKeyActionState,
} from "./issue-key-state";

type AccessViewProps = {
  gatewayChatCompletionsUrl: string;
  gatewayEndpoint: string;
  locale: string;
  workspaceDefaults: {
    defaultProviderConnectionId: string | null;
    defaultModelCatalogSourceHint: string | null;
    defaultVirtualKeyTtlHours: number;
    defaultVirtualKeyScopesTemplate: string[];
    defaultProjectId: string | null;
  };
  workspaceId: string | null;
  workspaceLabel: string | null;
};

export function AccessView({
  gatewayChatCompletionsUrl,
  gatewayEndpoint,
  locale,
  workspaceDefaults,
  workspaceId,
  workspaceLabel,
}: AccessViewProps) {
  const isZh = locale.startsWith("zh");
  const capabilities = useCapabilities();
  const shellSession = useShellSession();
  const [loading, setLoading] = useState(true);
  const [bootstrap, setBootstrap] =
    useState<SelfServeVirtualKeyBootstrap | null>(null);
  const [projects, setProjects] = useState<
    Array<{ id: string; name: string; slug: string }>
  >([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null,
  );
  const [issuedKey, setIssuedKey] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("curl");
  const [copyingType, setCopyingType] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<ConsoleHttpError | null>(null);
  const [issuingKey, setIssuingKey] = useState(false);
  const [issueKeyState, setIssueKeyState] = useState<IssueKeyActionState>(
    idleIssueKeyActionState,
  );

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
      setProjects(data.allowedProjects);
      setSelectedProjectId((current) => {
        if (
          current &&
          data.allowedProjects.some((project) => project.id === current)
        ) {
          return current;
        }
        if (
          workspaceDefaults.defaultProjectId &&
          data.allowedProjects.some(
            (project) => project.id === workspaceDefaults.defaultProjectId,
          )
        ) {
          return workspaceDefaults.defaultProjectId;
        }
        return data.defaults.projectId ?? data.allowedProjects[0]?.id ?? null;
      });
    } catch (error) {
      if (error instanceof ConsoleAuthRedirectError) {
        return;
      }

      setBootstrap(null);
      setProjects([]);
      setSelectedProjectId(null);
      if (error instanceof ConsoleHttpError) {
        setLoadError(error);
      } else {
        setLoadError(
          new ConsoleHttpError(
            t("无法加载接入状态", "Failed to load access state"),
            500,
            null,
          ),
        );
      }
    } finally {
      setLoading(false);
    }
  }, [workspaceDefaults.defaultProjectId, workspaceId, t]);

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
      setProjects([]);
      setSelectedProjectId(null);
      setLoadError(null);
      setIssuedKey(null);
      setLoading(accessBootstrapGate === "loading_session");
      return;
    }

    void loadBootstrap();
  }, [accessBootstrapGate, loadBootstrap]);

  const currentProject =
    projects.find((project) => project.id === selectedProjectId) ?? null;
  const availableSources = bootstrap?.availableSources ?? [];
  const defaultTtlHours = workspaceDefaults.defaultVirtualKeyTtlHours;
  const workspaceQuery = workspaceId
    ? `?workspaceId=${encodeURIComponent(workspaceId)}`
    : "";
  const membersHref = `/members${workspaceQuery}`;
  const virtualKeysHref = `/virtual-keys${workspaceQuery}`;
  const providersHref = `/providers${workspaceQuery}`;

  const handleIssueKey = async () => {
    if (!workspaceId || !selectedProjectId) {
      const nextMessage = t("请先选择项目", "Select a project first");
      setIssueKeyState({
        status: "error",
        message: nextMessage,
      });
      toast.error(nextMessage);
      return;
    }

    try {
      setIssuingKey(true);
      setIssueKeyState({
        status: "pending",
        message: null,
      });
      const response = await issueSelfServeVirtualKeyMutation({
        workspaceId,
        projectId: selectedProjectId,
        protocol: "openai-compatible",
      });
      if (response && response.token) {
        setIssuedKey(response.token);
        setIssueKeyState({
          status: "success",
          message: null,
        });
        toast.success(t("API 密钥已就绪", "API key issued"));
      }
    } catch (error) {
      if (error instanceof ConsoleAuthRedirectError) {
        return;
      }

      const failure = resolveIssueKeyFailure(
        error,
        t("签发失败", "Failed to issue key"),
      );
      if (failure.kind === "redirect") {
        return;
      }

      setIssueKeyState({
        status: "error",
        message: failure.message,
      });
      toast.error(failure.message);

      if (failure.shouldRefreshBootstrap) {
        await loadBootstrap();
      }
    } finally {
      setIssuingKey(false);
    }
  };

  const copyToClipboard = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyingType(id);
      toast.success(t("已复制", "Copied"));
      window.setTimeout(() => setCopyingType(null), 2000);
    } catch {
      toast.error(
        t("复制失败，请手动复制", "Copy failed. Please copy it manually."),
      );
    }
  };

  const displayKey = issuedKey || "<paste_virtual_key_here>";
  const hasIssuedKey = Boolean(issuedKey);
  const issueButtonDisabled = !selectedProjectId || issuingKey;
  const issueButtonLabel = hasIssuedKey
    ? t("已签发", "Active")
    : t("申请个人开发密钥", "Issue personal key");

  const snippets = useMemo(() => {
    const modelPlaceholder = "<model_name>";

    return {
      curl: `curl ${gatewayChatCompletionsUrl} \\
  -H "Authorization: Bearer ${displayKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${modelPlaceholder}",
    "messages": [{"role": "user", "content": "Hello"}]
  }'`,
      python: `from openai import OpenAI

client = OpenAI(
    base_url="${gatewayEndpoint}",
    api_key="${displayKey}"
)

completion = client.chat.completions.create(
    model="${modelPlaceholder}",
    messages=[{"role": "user", "content": "Hello"}]
)`,
      nodejs: `import OpenAI from "openai";

const openai = new OpenAI({
  baseURL: "${gatewayEndpoint}",
  apiKey: "${displayKey}",
});

const completion = await openai.chat.completions.create({
  model: "${modelPlaceholder}",
  messages: [{ role: "user", content: "Hello" }],
});`,
      env: `MERIDIAN_GATEWAY_URL=${gatewayEndpoint}
MERIDIAN_API_KEY=${displayKey}
MERIDIAN_PROJECT_ID=${currentProject?.slug || "default"}
MERIDIAN_MODEL=${modelPlaceholder}`,
    };
  }, [currentProject, displayKey, gatewayChatCompletionsUrl, gatewayEndpoint]);

  const copyCodeDisabled = !hasIssuedKey;
  const issueKeyFeedback = getIssueKeyFeedback(locale, issueKeyState);

  if (loading) {
    return (
      <div className="flex h-[400px] items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-b-2 border-primary" />
      </div>
    );
  }

  if (!workspaceId) {
    return (
      <div className="rounded-xl border border-border/60 bg-background p-6">
        <div className="space-y-2">
          <p className="text-sm font-semibold text-foreground">
            {t("请选择工作区", "Select a workspace")}
          </p>
          <p className="text-sm text-muted-foreground">
            {t(
              "先选择一个工作区，再查看当前成员的接入范围与个人开发密钥。",
              "Choose a workspace before viewing the current member's access scope and personal key lane.",
            )}
          </p>
        </div>
      </div>
    );
  }

  if (accessBootstrapGate === "switching_identity") {
    return (
      <div className="rounded-xl border border-border/60 bg-background p-6">
        <div className="flex items-start gap-3">
          <RefreshCw className="mt-0.5 size-4 animate-spin text-muted-foreground" />
          <div className="space-y-2">
            <p className="text-sm font-semibold text-foreground">
              {t("正在同步当前工作区身份", "Syncing workspace identity")}
            </p>
            <p className="text-sm leading-6 text-muted-foreground">
              {t(
                "正在为当前工作区切换成员身份，完成后会自动继续读取开发者接入状态。",
                "Switching the active member identity for this workspace. Access state will load automatically once the switch completes.",
              )}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (accessBootstrapGate === "switch_failed") {
    return (
      <div className="rounded-xl border border-border/60 bg-background p-6">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-4">
            <Badge
              variant="outline"
              className="w-fit border-amber-500/20 bg-amber-500/5 text-amber-700"
            >
              <TriangleAlert className="mr-1.5 size-3.5" />
              {t("当前工作区身份未就绪", "Workspace identity not ready")}
            </Badge>
            <div className="space-y-2">
              <h2 className="text-xl font-semibold tracking-tight text-foreground">
                {t(
                  "暂时无法切换到当前工作区的成员身份",
                  "Couldn't switch to the current workspace identity",
                )}
              </h2>
              <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
                {t(
                  "开发者接入需要先把当前会话切换到目标工作区的成员身份。请重试，或先重新登录后再进入此页面。",
                  "Developer access requires the current session to switch into the target workspace identity first. Retry, or sign in again before reopening this page.",
                )}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={shellSession.retryWorkspaceIdentitySync}
            >
              {t("重试身份同步", "Retry identity sync")}
            </Button>
            <Button asChild variant="outline">
              <Link href={virtualKeysHref}>
                {t("查看治理密钥", "View governed keys")}
              </Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (loadError?.code === "SELF_SERVE_FORBIDDEN") {
    return (
      <div className="rounded-xl border border-border/60 bg-background p-6">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-4">
            <Badge
              variant="outline"
              className="w-fit border-border/60 bg-muted/30"
            >
              <Shield className="mr-1.5 size-3.5" />
              {t("开发者自助入口", "Developer self-serve lane")}
            </Badge>
            <div className="space-y-2">
              <h2 className="text-xl font-semibold tracking-tight text-foreground">
                {t(
                  "当前身份不能在这里自助申请个人密钥",
                  "This identity cannot self-serve a personal key here",
                )}
              </h2>
              <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
                {t(
                  "Access 页面只用于开发者为自己申请短期个人开发密钥。管理员应在 Members 管理角色与项目范围，在 Virtual Keys 治理服务或共享凭据。",
                  "The Access page is only for developers issuing a short-lived personal key for themselves. Admins should manage role and project scope in Members, and govern service or shared credentials in Virtual Keys.",
                )}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {capabilities.canManageMembers ? (
              <Button asChild variant="outline">
                <Link href={membersHref}>
                  {t("打开 Members", "Open Members")}
                </Link>
              </Button>
            ) : null}
            <Button asChild>
              <Link href={virtualKeysHref}>
                {t("打开 Virtual Keys", "Open Virtual Keys")}
              </Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (loadError) {
    const loadErrorMessage = getUserErrorMessage(
      loadError,
      t("暂时无法加载接入状态", "Can't load access state right now"),
    );
    return (
      <div className="rounded-xl border border-border/60 bg-background p-6">
        <div className="space-y-2">
          <p className="text-sm font-semibold text-foreground">
            {t("暂时无法加载接入状态", "Can't load access state right now")}
          </p>
          <p className="text-sm text-muted-foreground">{loadErrorMessage}</p>
        </div>
      </div>
    );
  }

  if (!projects.length) {
    return (
      <div className="rounded-xl border border-border/60 bg-background p-6">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-4">
            <Badge
              variant="outline"
              className="w-fit border-border/60 bg-muted/30"
            >
              <Workflow className="mr-1.5 size-3.5" />
              {t("等待项目范围", "Waiting on project scope")}
            </Badge>
            <div className="space-y-2">
              <h2 className="text-xl font-semibold tracking-tight text-foreground">
                {t(
                  "当前成员暂无可申请的项目",
                  "No eligible projects are available for this member",
                )}
              </h2>
              <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
                {t(
                  "请先在 Members 为该成员分配已启用的项目范围。分配完成后，可在这里申请个人开发密钥。",
                  "Assign an active project scope in Members first. Once assigned, this member can issue a personal key here.",
                )}
              </p>
            </div>
          </div>
          {capabilities.canManageMembers ? (
            <div className="flex flex-wrap gap-2">
              <Button asChild>
                <Link href={membersHref}>
                  {t("管理成员范围", "Manage member scope")}
                </Link>
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  if (!availableSources.length) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-border/60 bg-[color:color-mix(in_srgb,var(--surface-1)_96%,var(--surface-canvas)_4%)] px-5 py-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant="outline"
                className="border-emerald-500/20 bg-emerald-500/5 text-emerald-700"
              >
                <UserRound className="mr-1.5 size-3.5" />
                {t("个人开发凭据", "Personal developer credentials")}
              </Badge>
              <Badge
                variant="outline"
                className="border-border/60 bg-background/80"
              >
                {workspaceLabel ?? t("当前工作区", "Current workspace")}
              </Badge>
              <Badge
                variant="outline"
                className="border-border/60 bg-background/80"
              >
                {t("默认时效", "Default TTL")} · {defaultTtlHours}h
              </Badge>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border/60 bg-background p-6">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-4">
              <Badge
                variant="outline"
                className="w-fit border-amber-500/20 bg-amber-500/5 text-amber-700"
              >
                <TriangleAlert className="mr-1.5 size-3.5" />
                {t("缺少可用渠道", "No available channels")}
              </Badge>
              <div className="space-y-2">
                <h2 className="text-xl font-semibold tracking-tight text-foreground">
                  {t(
                    "当前工作区还没有可供开发者使用的渠道与模型",
                    "This workspace does not have any developer-ready channels and models yet",
                  )}
                </h2>
                <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
                  {t(
                    "请先在管理员后台按渠道整理并发布模型。当前组织下已发布且就绪的模型会自动对所有工作区开放给开发者使用。",
                    "Organize and publish models in admin settings first. Published models that are ready in this organization become available to developers across every workspace automatically.",
                  )}
                </p>
              </div>
            </div>
            {capabilities.canManageInfrastructure ? (
              <div className="flex flex-wrap gap-2">
                <Button asChild>
                  <Link href={providersHref}>
                    {t("去设置 Providers", "Open Providers")}
                  </Link>
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border/60 bg-[color:color-mix(in_srgb,var(--surface-1)_96%,var(--surface-canvas)_4%)] px-5 py-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className="border-emerald-500/20 bg-emerald-500/5 text-emerald-700"
            >
              <UserRound className="mr-1.5 size-3.5" />
              {t("个人开发凭据", "Personal developer credentials")}
            </Badge>
            <Badge
              variant="outline"
              className="border-border/60 bg-background/80"
            >
              {workspaceLabel ?? t("当前工作区", "Current workspace")}
            </Badge>
            <Badge
              variant="outline"
              className="border-border/60 bg-background/80"
            >
              {t("默认时效", "Default TTL")} · {defaultTtlHours}h
            </Badge>
          </div>
          {capabilities.canManageMembers ? (
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline">
                <Link href={membersHref}>{t("成员范围", "Member scope")}</Link>
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="mx-auto flex min-h-[650px] max-w-[1600px] overflow-hidden rounded-xl border border-border/60 bg-background shadow-none">
        <aside className="flex w-64 shrink-0 flex-col border-r border-border/60 bg-muted/10">
          <div className="flex items-center justify-between border-b border-border/60 bg-muted/20 p-4">
            <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
              {t("已分配项目", "Assigned projects")}
            </span>
            <Badge variant="secondary" className="h-4 px-1 text-[10px]">
              {projects.length}
            </Badge>
          </div>
          <div className="flex-1 overflow-y-auto py-2">
            {projects.map((project) => (
              <button
                key={project.id}
                onClick={() => {
                  setSelectedProjectId(project.id);
                  setIssuedKey(null);
                  setIssueKeyState(idleIssueKeyActionState);
                }}
                className={cn(
                  "flex w-full items-center gap-3 border-l-2 px-4 py-3 text-left transition-all",
                  selectedProjectId === project.id
                    ? "border-primary bg-primary/5"
                    : "border-transparent hover:bg-muted/50",
                )}
              >
                <div
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-lg",
                    selectedProjectId === project.id
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  <Layers className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "truncate text-xs font-bold",
                      selectedProjectId === project.id
                        ? "text-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    {project.name}
                  </p>
                  <p className="truncate text-[10px] uppercase opacity-60">
                    {project.slug}
                  </p>
                </div>
                {selectedProjectId === project.id ? (
                  <ChevronRight className="size-3 text-primary" />
                ) : null}
              </button>
            ))}
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col bg-card">
          <header className="flex flex-wrap items-center gap-6 border-b border-border/60 bg-muted/5 p-4">
            <div className="flex flex-wrap items-center gap-6">
              <div className="flex items-center gap-2">
                <Globe className="size-3.5 text-muted-foreground" />
                <span className="text-[10px] font-bold uppercase tracking-tight text-muted-foreground">
                  {t("网关端点", "Endpoint")}
                </span>
                <code className="select-all rounded border border-border/40 bg-muted px-2 py-0.5 font-mono text-xs font-bold">
                  {gatewayEndpoint}
                </code>
                <button
                  type="button"
                  onClick={() => void copyToClipboard(gatewayEndpoint, "url")}
                  className="text-muted-foreground transition-colors hover:text-primary"
                >
                  {copyingType === "url" ? (
                    <Check className="size-3.5" />
                  ) : (
                    <Copy className="size-3.5" />
                  )}
                </button>
              </div>

              <div className="h-4 w-px bg-border/60" />

              <div className="flex items-center gap-2">
                <KeyRound className="size-3.5 text-muted-foreground" />
                <span className="text-[10px] font-bold uppercase tracking-tight text-muted-foreground">
                  {t("个人密钥状态", "Personal key")}
                </span>
                {issuedKey ? (
                  <Badge
                    variant="outline"
                    className="h-5 border-emerald-500/20 bg-emerald-500/5 text-[10px] font-bold uppercase text-emerald-600"
                  >
                    <Check className="mr-1 size-2.5" />
                    {t("已签发", "Active")}
                  </Badge>
                ) : (
                  <button
                    type="button"
                    aria-disabled={issueButtonDisabled}
                    onClick={() => void handleIssueKey()}
                    className={cn(
                      "flex items-center gap-1 text-[10px] font-bold transition-colors",
                      issueButtonDisabled
                        ? "cursor-not-allowed text-muted-foreground"
                        : "text-primary hover:underline",
                    )}
                  >
                    <Zap className="size-3 fill-current" />
                    {issuingKey ? t("申请中", "Issuing") : issueButtonLabel}
                  </button>
                )}
              </div>
            </div>
          </header>

          <div className="flex flex-col space-y-4 p-4">
            <div className="rounded-xl border border-border/60 bg-[color:color-mix(in_srgb,var(--surface-1)_96%,var(--surface-canvas)_4%)] p-4">
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-3 border-b border-border/50 pb-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] font-medium text-muted-foreground">
                      {t("当前上下文", "Current context")}
                    </span>
                    <Badge
                      variant="outline"
                      className="border-border/60 font-mono text-[10px] uppercase text-muted-foreground"
                    >
                      {currentProject?.slug || "none"}
                    </Badge>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      disabled={issueButtonDisabled}
                      onClick={() => void handleIssueKey()}
                      className="h-9 gap-2"
                    >
                      <Zap className="size-4" />
                      {issuingKey
                        ? t("申请中", "Issuing")
                        : t("申请个人开发密钥", "Issue personal key")}
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            {issueKeyFeedback ? (
              <div
                className={cn(
                  "rounded-xl border px-4 py-3",
                  issueKeyFeedback.tone === "success" &&
                    "border-emerald-500/20 bg-emerald-500/5",
                  issueKeyFeedback.tone === "error" &&
                    "border-amber-500/20 bg-amber-500/5",
                  issueKeyFeedback.tone === "neutral" &&
                    "border-border/60 bg-muted/20",
                )}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={cn(
                      "mt-0.5 shrink-0",
                      issueKeyFeedback.tone === "success" && "text-emerald-600",
                      issueKeyFeedback.tone === "error" && "text-amber-700",
                      issueKeyFeedback.tone === "neutral" &&
                        "text-muted-foreground",
                    )}
                  >
                    {issueKeyFeedback.tone === "success" ? (
                      <Check className="size-4" />
                    ) : issueKeyFeedback.tone === "error" ? (
                      <TriangleAlert className="size-4" />
                    ) : (
                      <RefreshCw className="size-4 animate-spin" />
                    )}
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-foreground">
                      {issueKeyFeedback.title}
                    </p>
                    <p className="text-sm leading-6 text-muted-foreground">
                      {issueKeyFeedback.message}
                    </p>
                  </div>
                </div>
              </div>
            ) : null}

            {issuedKey ? (
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-4">
                <div className="space-y-3">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-foreground">
                      {t("当前个人开发密钥", "Current personal key")}
                    </p>
                    <p className="text-sm leading-6 text-muted-foreground">
                      {t(
                        "仅在当前会话显示，请立即复制。下方代码片段也已同步为这把密钥。",
                        "Only shown in the current session. Copy it now. The snippets below already use this key.",
                      )}
                    </p>
                  </div>
                  <div className="flex flex-col gap-3 rounded-lg border border-emerald-500/20 bg-background/80 p-3 sm:flex-row sm:items-center sm:justify-between">
                    <code className="select-all break-all font-mono text-[13px] font-semibold leading-6 text-foreground">
                      {issuedKey}
                    </code>
                    <CopyButton
                      className="h-8 shrink-0 text-emerald-700"
                      label={t("复制密钥", "Copy key")}
                      value={issuedKey}
                    />
                  </div>
                </div>
              </div>
            ) : null}

            <div className="flex flex-col overflow-hidden rounded-xl border border-border/60 bg-zinc-950 shadow-none">
              <Tabs
                value={activeTab}
                onValueChange={setActiveTab}
                className="flex flex-col"
              >
                <div className="flex items-center justify-between border-b border-white/5 bg-zinc-900 px-2">
                  <TabsList className="h-10 gap-1 bg-transparent p-0">
                    {[
                      { value: "curl", label: "cURL", icon: Terminal },
                      { value: "python", label: "Python", icon: Code2 },
                      { value: "nodejs", label: "Node.js", icon: FileCode2 },
                      { value: "env", label: ".env", icon: Settings2 },
                    ].map((tab) => (
                      <TabsTrigger
                        key={tab.value}
                        value={tab.value}
                        className="h-7 gap-2 rounded-md px-3 text-[11px] font-bold text-muted-foreground transition-all data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
                      >
                        <tab.icon className="size-3" />
                        {tab.label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                  <div className="flex items-center gap-4 px-2">
                    <span className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-zinc-600">
                      <Command className="size-3" />
                      {t("个人接入代码片段", "Personal access snippets")}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={copyCodeDisabled}
                      className="h-7 gap-2 text-[11px] font-bold text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                      onClick={() => {
                        if (snippets) {
                          void copyToClipboard(
                            snippets[activeTab as keyof typeof snippets],
                            "snippet",
                          );
                        }
                      }}
                    >
                      {copyingType === "snippet" ? (
                        <Check className="size-3.5" />
                      ) : (
                        <Copy className="size-3.5" />
                      )}
                      {t("全选复制", "Copy code")}
                    </Button>
                  </div>
                </div>

                <div className="min-h-[400px] flex flex-col bg-[#09090b]">
                  <TabsContent value="curl" className="flex-1 m-0">
                    <pre className="h-full p-6 font-mono text-[13px] leading-relaxed text-zinc-300 selection:bg-primary/30">
                      {snippets.curl}
                    </pre>
                  </TabsContent>
                  <TabsContent value="python" className="flex-1 m-0">
                    <pre className="h-full p-6 font-mono text-[13px] leading-relaxed text-zinc-300 selection:bg-primary/30">
                      {snippets.python}
                    </pre>
                  </TabsContent>
                  <TabsContent value="nodejs" className="flex-1 m-0">
                    <pre className="h-full p-6 font-mono text-[13px] leading-relaxed text-zinc-300 selection:bg-primary/30">
                      {snippets.nodejs}
                    </pre>
                  </TabsContent>
                  <TabsContent value="env" className="flex-1 m-0">
                    <pre className="h-full p-6 font-mono text-[13px] leading-relaxed text-zinc-300 selection:bg-primary/30">
                      {snippets.env}
                    </pre>
                  </TabsContent>
                  <div className="mt-auto flex items-center justify-between border-t border-white/5 bg-zinc-900/50 p-3 px-4">
                    <p className="text-[11px] text-zinc-400">
                      {t(
                        "提示：在代码中将 <model_name> 替换为上方列出的任意模型名称即可。",
                        "Hint: Replace <model_name> in the code with any model name listed above.",
                      )}
                    </p>
                    <Button asChild variant="outline" size="sm" className="h-7 text-[11px] font-bold text-muted-foreground transition-colors hover:text-foreground">
                      <Link href={`/models${workspaceId ? `?workspaceId=${workspaceId}` : ""}`}>
                        {t("前往模型大厅", "Open Model Catalog")}
                      </Link>
                    </Button>
                  </div>
                </div>
              </Tabs>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
