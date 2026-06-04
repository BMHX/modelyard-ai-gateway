"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import {
  Activity,
  Gauge,
  LayoutPanelLeft,
  MonitorCog,
  RefreshCcw,
  Save,
  Settings2,
  Sparkles,
  TimerReset,
} from "lucide-react";

import { AppShell } from "../components/app-shell";
import {
  ConsoleHttpError,
  fetchConsoleSettings,
  fetchConsoleSettingsWorkspaceContext,
  probeConsoleSettings,
  updateConsoleRuntimeSettings,
  updateConsoleWorkspaceDefaults,
} from "../lib/console-api-client";
import type {
  ConsoleSettingsProbeResponse,
  ConsoleSettingsResponse,
  ConsoleSettingsWorkspaceContextResponse,
} from "../lib/console-api-contracts";
import {
  getDefaultConsolePreferences,
  normalizeConsolePreferences,
  persistConsolePreferences,
  readConsolePreferences,
  type ConsolePreferences,
} from "../lib/console-preferences";
import { usePathLocale } from "../lib/i18n-client";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

type SettingsSection = "console" | "workspace" | "runtime" | "diagnostics";

type RuntimeSettingsFormState = {
  gatewayBaseUrl: string;
  gatewayRequestBasePath: string;
  gatewayChatCompletionsPath: string;
  gatewayResponsesPath: string;
  gatewayModelsPath: string;
  gatewayHealthPath: string;
  gatewayRequestTimeoutMs: string;
};

type WorkspaceDefaultsFormState = {
  defaultProviderConnectionId: string;
  defaultModelCatalogSourceHint: string;
  defaultVirtualKeyTtlHours: string;
  defaultVirtualKeyScopesTemplate: string;
  defaultProjectId: string;
};

function toRuntimeFormState(response: ConsoleSettingsResponse): RuntimeSettingsFormState {
  return {
    gatewayBaseUrl: response.runtimeSettings.gatewayBaseUrl,
    gatewayRequestBasePath: response.runtimeSettings.gatewayRequestBasePath,
    gatewayChatCompletionsPath: response.runtimeSettings.gatewayChatCompletionsPath,
    gatewayResponsesPath: response.runtimeSettings.gatewayResponsesPath,
    gatewayModelsPath: response.runtimeSettings.gatewayModelsPath,
    gatewayHealthPath: response.runtimeSettings.gatewayHealthPath,
    gatewayRequestTimeoutMs: String(response.runtimeSettings.gatewayRequestTimeoutMs),
  };
}

function toWorkspaceDefaultsFormState(
  defaults:
    | ConsoleSettingsResponse["workspaceDefaultsDefaults"]
    | ConsoleSettingsResponse["workspaceDefaultsById"][string],
): WorkspaceDefaultsFormState {
  return {
    defaultProviderConnectionId: defaults.defaultProviderConnectionId ?? "",
    defaultModelCatalogSourceHint: defaults.defaultModelCatalogSourceHint ?? "",
    defaultVirtualKeyTtlHours: String(defaults.defaultVirtualKeyTtlHours),
    defaultVirtualKeyScopesTemplate: defaults.defaultVirtualKeyScopesTemplate.join(", "),
    defaultProjectId: defaults.defaultProjectId ?? "",
  };
}

function normalizePreviewPath(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return "/";
  }

  const normalized = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const compacted = normalized.replace(/\/{2,}/g, "/");

  return compacted.length > 1 ? compacted.replace(/\/+$/, "") : compacted;
}

function normalizePreviewBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

function buildPreviewEndpoint(form: RuntimeSettingsFormState) {
  const baseUrl = normalizePreviewBaseUrl(form.gatewayBaseUrl);
  const basePath = normalizePreviewPath(form.gatewayRequestBasePath);
  return basePath === "/" ? baseUrl : `${baseUrl}${basePath}`;
}

function buildPreviewRequestUrl(form: RuntimeSettingsFormState, requestPath: string) {
  return `${buildPreviewEndpoint(form)}${normalizePreviewPath(requestPath)}`;
}

function buildPreviewDirectUrl(form: RuntimeSettingsFormState, requestPath: string) {
  return `${normalizePreviewBaseUrl(form.gatewayBaseUrl)}${normalizePreviewPath(requestPath)}`;
}

function toRuntimeMutationInput(
  form: RuntimeSettingsFormState,
): ConsoleSettingsResponse["runtimeDefaults"] {
  return {
    gatewayBaseUrl: form.gatewayBaseUrl,
    gatewayRequestBasePath: form.gatewayRequestBasePath,
    gatewayChatCompletionsPath: form.gatewayChatCompletionsPath,
    gatewayResponsesPath: form.gatewayResponsesPath,
    gatewayModelsPath: form.gatewayModelsPath,
    gatewayHealthPath: form.gatewayHealthPath,
    gatewayRequestTimeoutMs: Number.parseInt(form.gatewayRequestTimeoutMs.trim(), 10),
  };
}

function toWorkspaceMutationInput(
  form: WorkspaceDefaultsFormState,
): ConsoleSettingsResponse["workspaceDefaultsDefaults"] {
  return {
    defaultProviderConnectionId: form.defaultProviderConnectionId || null,
    defaultModelCatalogSourceHint: form.defaultModelCatalogSourceHint.trim() || null,
    defaultVirtualKeyTtlHours: Number.parseInt(form.defaultVirtualKeyTtlHours.trim(), 10),
    defaultVirtualKeyScopesTemplate: form.defaultVirtualKeyScopesTemplate
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
    defaultProjectId: form.defaultProjectId || null,
  };
}

function SectionButton({
  active,
  description,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  description: string;
  icon: typeof Settings2;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        "flex w-full items-start gap-3 rounded-xl border px-3 py-3 text-left transition-colors",
        active
          ? "border-[color:var(--primary-border)] bg-[color:color-mix(in_srgb,var(--surface-1)_78%,var(--surface-selected)_22%)]"
          : "border-border/60 bg-background hover:border-border hover:bg-[color:color-mix(in_srgb,var(--surface-1)_92%,var(--surface-canvas)_8%)]",
      )}
      onClick={onClick}
      type="button"
    >
      <span
        className={cn(
          "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border",
          active
            ? "border-[color:var(--primary-border)] bg-[color:var(--primary-soft)] text-[color:var(--primary-strong)]"
            : "border-border/60 bg-[color:color-mix(in_srgb,var(--surface-1)_96%,var(--surface-canvas)_4%)] text-muted-foreground",
        )}
      >
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 space-y-1">
        <span className="block text-sm font-medium text-foreground">{label}</span>
        <span className="block text-xs leading-5 text-muted-foreground">{description}</span>
      </span>
    </button>
  );
}

function BooleanField({
  checked,
  description,
  label,
  onChange,
}: {
  checked: boolean;
  description: string;
  label: string;
  onChange: (nextValue: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 rounded-xl border border-border/60 bg-background px-3 py-3">
      <input
        checked={checked}
        className="mt-1 h-4 w-4 rounded border-border text-primary focus:ring-0"
        onChange={(event) => onChange(event.currentTarget.checked)}
        type="checkbox"
      />
      <span className="space-y-1">
        <span className="block text-sm font-medium text-foreground">{label}</span>
        <span className="block text-xs leading-5 text-muted-foreground">{description}</span>
      </span>
    </label>
  );
}

export default function SettingsPage() {
  const locale = usePathLocale();
  const searchParams = useSearchParams() ?? new URLSearchParams();
  const workspaceId = searchParams.get("workspaceId");
  const isZh = locale.startsWith("zh");
  const t = useCallback((zh: string, en: string) => (isZh ? zh : en), [isZh]);

  const [activeSection, setActiveSection] = useState<SettingsSection>("console");
  const [loading, setLoading] = useState(true);
  const [runtimeSaving, setRuntimeSaving] = useState(false);
  const [workspaceSaving, setWorkspaceSaving] = useState(false);
  const [preferencesSaving, setPreferencesSaving] = useState(false);
  const [probing, setProbing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<ConsoleSettingsResponse | null>(null);
  const [runtimeForm, setRuntimeForm] = useState<RuntimeSettingsFormState | null>(null);
  const [preferencesForm, setPreferencesForm] = useState<ConsolePreferences>(
    getDefaultConsolePreferences(),
  );
  const [workspaceForm, setWorkspaceForm] = useState<WorkspaceDefaultsFormState | null>(null);
  const [probeResult, setProbeResult] = useState<ConsoleSettingsProbeResponse | null>(null);
  const [workspaceContext, setWorkspaceContext] =
    useState<ConsoleSettingsWorkspaceContextResponse | null>(null);
  const [workspaceContextLoading, setWorkspaceContextLoading] = useState(false);
  const [runtimeNotice, setRuntimeNotice] = useState<string | null>(null);
  const [workspaceNotice, setWorkspaceNotice] = useState<string | null>(null);
  const [preferencesNotice, setPreferencesNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);
        const nextResponse = await fetchConsoleSettings();

        if (cancelled) {
          return;
        }

        setResponse(nextResponse);
        setRuntimeForm(toRuntimeFormState(nextResponse));
        setPreferencesForm(readConsolePreferences(window.localStorage));
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof ConsoleHttpError || loadError instanceof Error
              ? loadError.message
              : t("当前无法加载设置。", "Unable to load settings."),
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [t]);

  useEffect(() => {
    if (!response) {
      return;
    }

    if (!workspaceId) {
      setWorkspaceForm(toWorkspaceDefaultsFormState(response.workspaceDefaultsDefaults));
      setWorkspaceContext(null);
      return;
    }

    const defaults =
      response.workspaceDefaultsById[workspaceId] ?? response.workspaceDefaultsDefaults;
    setWorkspaceForm(toWorkspaceDefaultsFormState(defaults));
  }, [response, workspaceId]);

  useEffect(() => {
    let cancelled = false;

    async function loadWorkspaceContext() {
      if (!workspaceId) {
        setWorkspaceContext(null);
        return;
      }

      try {
        setWorkspaceContextLoading(true);
        const nextContext = await fetchConsoleSettingsWorkspaceContext(workspaceId);
        if (!cancelled) {
          setWorkspaceContext(nextContext);
        }
      } catch {
        if (!cancelled) {
          setWorkspaceContext(null);
        }
      } finally {
        if (!cancelled) {
          setWorkspaceContextLoading(false);
        }
      }
    }

    void loadWorkspaceContext();

    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const runtimePreviews = useMemo(() => {
    if (!runtimeForm) {
      return null;
    }

    return {
      endpoint: buildPreviewEndpoint(runtimeForm),
      chatCompletions: buildPreviewRequestUrl(
        runtimeForm,
        runtimeForm.gatewayChatCompletionsPath,
      ),
      responses: buildPreviewRequestUrl(runtimeForm, runtimeForm.gatewayResponsesPath),
      models: buildPreviewRequestUrl(runtimeForm, runtimeForm.gatewayModelsPath),
      health: buildPreviewDirectUrl(runtimeForm, runtimeForm.gatewayHealthPath),
    };
  }, [runtimeForm]);

  const hasRuntimeChanges = useMemo(() => {
    if (!response || !runtimeForm) {
      return false;
    }

    return (
      runtimeForm.gatewayBaseUrl !== response.runtimeSettings.gatewayBaseUrl ||
      runtimeForm.gatewayRequestBasePath !== response.runtimeSettings.gatewayRequestBasePath ||
      runtimeForm.gatewayChatCompletionsPath !==
        response.runtimeSettings.gatewayChatCompletionsPath ||
      runtimeForm.gatewayResponsesPath !== response.runtimeSettings.gatewayResponsesPath ||
      runtimeForm.gatewayModelsPath !== response.runtimeSettings.gatewayModelsPath ||
      runtimeForm.gatewayHealthPath !== response.runtimeSettings.gatewayHealthPath ||
      runtimeForm.gatewayRequestTimeoutMs !==
        String(response.runtimeSettings.gatewayRequestTimeoutMs)
    );
  }, [response, runtimeForm]);

  const hasWorkspaceChanges = useMemo(() => {
    if (!response || !workspaceForm) {
      return false;
    }

    const baseline = workspaceId
      ? response.workspaceDefaultsById[workspaceId] ?? response.workspaceDefaultsDefaults
      : response.workspaceDefaultsDefaults;

    return JSON.stringify(toWorkspaceMutationInput(workspaceForm)) !== JSON.stringify(baseline);
  }, [response, workspaceForm, workspaceId]);

  const invalidWorkspaceSelections = useMemo(() => {
    if (!workspaceId || !workspaceForm || !workspaceContext) {
      return {
        provider: false,
        project: false,
      };
    }

    return {
      provider:
        Boolean(workspaceForm.defaultProviderConnectionId) &&
        !workspaceContext.providerConnections.some(
          (connection) =>
            connection.id === workspaceForm.defaultProviderConnectionId,
        ),
      project:
        Boolean(workspaceForm.defaultProjectId) &&
        !workspaceContext.projects.some(
          (project) => project.id === workspaceForm.defaultProjectId,
        ),
    };
  }, [workspaceContext, workspaceForm, workspaceId]);

  const diagnosticsSnapshot = useMemo(() => {
    if (!runtimeForm || !workspaceForm) {
      return null;
    }

    return {
      myConsole: preferencesForm,
      workspaceDefaults: toWorkspaceMutationInput(workspaceForm),
      systemRuntime: toRuntimeMutationInput(runtimeForm),
    };
  }, [preferencesForm, runtimeForm, workspaceForm]);

  function updateRuntimeField<Key extends keyof RuntimeSettingsFormState>(
    key: Key,
    value: RuntimeSettingsFormState[Key],
  ) {
    setRuntimeForm((current) => (current ? { ...current, [key]: value } : current));
  }

  function updateWorkspaceField<Key extends keyof WorkspaceDefaultsFormState>(
    key: Key,
    value: WorkspaceDefaultsFormState[Key],
  ) {
    setWorkspaceForm((current) => (current ? { ...current, [key]: value } : current));
  }

  function updatePreferencesField<Key extends keyof ConsolePreferences>(
    key: Key,
    value: ConsolePreferences[Key],
  ) {
    setPreferencesForm((current) => ({ ...current, [key]: value }));
  }

  async function handleRuntimeSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!runtimeForm) {
      return;
    }

    try {
      setRuntimeSaving(true);
      const nextResponse = await updateConsoleRuntimeSettings(
        toRuntimeMutationInput(runtimeForm),
      );
      setResponse(nextResponse);
      setRuntimeForm(toRuntimeFormState(nextResponse));
      setRuntimeNotice(t("运行时设置已保存。", "Runtime settings saved."));
    } catch (saveError) {
      setRuntimeNotice(
        saveError instanceof ConsoleHttpError || saveError instanceof Error
          ? saveError.message
          : t("保存失败，请稍后再试。", "Save failed. Try again."),
      );
    } finally {
      setRuntimeSaving(false);
    }
  }

  async function handleWorkspaceSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!workspaceId || !workspaceForm) {
      return;
    }

    try {
      setWorkspaceSaving(true);
      const nextResponse = await updateConsoleWorkspaceDefaults({
        workspaceId,
        defaults: toWorkspaceMutationInput(workspaceForm),
      });
      setResponse(nextResponse);
      setWorkspaceNotice(t("工作区默认值已保存。", "Workspace defaults saved."));
    } catch (saveError) {
      setWorkspaceNotice(
        saveError instanceof ConsoleHttpError || saveError instanceof Error
          ? saveError.message
          : t("保存失败，请稍后再试。", "Save failed. Try again."),
      );
    } finally {
      setWorkspaceSaving(false);
    }
  }

  function handlePreferencesSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    try {
      setPreferencesSaving(true);
      persistConsolePreferences(
        window.localStorage,
        normalizeConsolePreferences(preferencesForm),
      );
      setPreferencesNotice(t("个人控制台偏好已保存。", "Console preferences saved."));
    } finally {
      setPreferencesSaving(false);
    }
  }

  async function handleProbe() {
    if (!runtimeForm) {
      return;
    }

    try {
      setProbing(true);
      const result = await probeConsoleSettings(toRuntimeMutationInput(runtimeForm));
      setProbeResult(result);
    } catch (probeError) {
      setProbeResult({
        ok: false,
        url: runtimePreviews?.health ?? "",
        durationMs: 0,
        httpStatus: null,
        service: null,
        timestamp: null,
        message:
          probeError instanceof ConsoleHttpError || probeError instanceof Error
            ? probeError.message
            : t("探测失败。", "Probe failed."),
      });
    } finally {
      setProbing(false);
    }
  }

  function resetRuntime() {
    if (!response) {
      return;
    }

    setRuntimeNotice(null);
    setProbeResult(null);
    setRuntimeForm({
      gatewayBaseUrl: response.runtimeDefaults.gatewayBaseUrl,
      gatewayRequestBasePath: response.runtimeDefaults.gatewayRequestBasePath,
      gatewayChatCompletionsPath: response.runtimeDefaults.gatewayChatCompletionsPath,
      gatewayResponsesPath: response.runtimeDefaults.gatewayResponsesPath,
      gatewayModelsPath: response.runtimeDefaults.gatewayModelsPath,
      gatewayHealthPath: response.runtimeDefaults.gatewayHealthPath,
      gatewayRequestTimeoutMs: String(response.runtimeDefaults.gatewayRequestTimeoutMs),
    });
  }

  function resetWorkspaceDefaults() {
    if (!response) {
      return;
    }

    setWorkspaceNotice(null);
    setWorkspaceForm(
      toWorkspaceDefaultsFormState(response.workspaceDefaultsDefaults),
    );
  }

  function resetPreferences() {
    setPreferencesNotice(null);
    setPreferencesForm(getDefaultConsolePreferences());
  }

  const sections = [
    {
      id: "console" as const,
      icon: Sparkles,
      label: t("My Console", "My Console"),
      description: t(
        "调整当前账号看到的主题、密度、导航和控制台习惯。",
        "Adjust theme, density, navigation, and console behavior for the current account.",
      ),
    },
    {
      id: "workspace" as const,
      icon: LayoutPanelLeft,
      label: t("Workspace Defaults", "Workspace Defaults"),
      description: t(
        "为当前工作区设置接入与密钥相关的默认值。",
        "Set access and key defaults for the current workspace.",
      ),
    },
    {
      id: "runtime" as const,
      icon: MonitorCog,
      label: t("System Runtime", "System Runtime"),
      description: t(
        "配置网关端点、代理路径、探测和超时策略。",
        "Configure gateway endpoints, proxy paths, probe targets, and timeout policy.",
      ),
    },
    {
      id: "diagnostics" as const,
      icon: Gauge,
      label: t("Diagnostics", "Diagnostics"),
      description: t(
        "确认当前生效配置、来源和即时探测结果。",
        "Inspect effective configuration, source, and live probe results.",
      ),
    },
  ];

  return (
    <AppShell
      title={t("设置中心", "Settings Center")}
      subtitle={t(
        "把个人控制台偏好、工作区默认值和系统运行时配置集中到同一处管理。",
        "Manage console preferences, workspace defaults, and system runtime behavior from one place.",
      )}
      headerMode="compact"
      showOperatorContextCards={false}
      showSupportPanels={false}
      sidebarVariant="minimal"
    >
      <section className="grid gap-5 xl:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="space-y-3">
          <section className="rounded-xl border border-border/60 bg-[color:color-mix(in_srgb,var(--surface-1)_97%,var(--surface-canvas)_3%)] px-4 py-4">
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {t("设置分区", "Sections")}
              </p>
              <p className="text-sm text-muted-foreground">
                {t(
                  "按作用范围组织：个人、工作区、运行时和诊断。",
                  "Organized by scope: personal, workspace, runtime, and diagnostics.",
                )}
              </p>
            </div>
          </section>
          {sections.map((section) => (
            <SectionButton
              active={activeSection === section.id}
              description={section.description}
              icon={section.icon}
              key={section.id}
              label={section.label}
              onClick={() => setActiveSection(section.id)}
            />
          ))}
        </aside>

        <div className="space-y-5">
          {error ? (
            <section className="rounded-xl border border-[color:var(--destructive-border)] bg-[color:color-mix(in_srgb,var(--surface-1)_94%,var(--destructive-soft)_6%)] px-4 py-3 text-sm text-[color:var(--destructive-strong)]">
              {error}
            </section>
          ) : null}

          {activeSection === "console" ? (
            <form className="space-y-5" onSubmit={handlePreferencesSave}>
              <section className="rounded-xl border border-border/60 bg-background px-5 py-5">
                <div className="space-y-4">
                  <div className="space-y-1">
                    <h2 className="text-base font-semibold text-foreground">
                      {t("My Console", "My Console")}
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      {t(
                        "这些设置只影响当前浏览器里的控制台体验，并保存在本地。",
                        "These settings affect only this browser's console experience and are stored locally.",
                      )}
                    </p>
                  </div>

                  <div className="grid gap-5 sm:grid-cols-2">
                    <label className="space-y-2">
                      <span className="text-sm font-medium text-foreground">{t("主题模式", "Theme mode")}</span>
                      <Select
                        onValueChange={(value) =>
                          updatePreferencesField("themeMode", value as ConsolePreferences["themeMode"])
                        }
                        value={preferencesForm.themeMode}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="system">{t("跟随系统", "System")}</SelectItem>
                          <SelectItem value="light">{t("浅色", "Light")}</SelectItem>
                          <SelectItem value="dark">{t("深色", "Dark")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </label>

                    <label className="space-y-2">
                      <span className="text-sm font-medium text-foreground">{t("强调色", "Accent preset")}</span>
                      <Select
                        onValueChange={(value) =>
                          updatePreferencesField("accentPreset", value as ConsolePreferences["accentPreset"])
                        }
                        value={preferencesForm.accentPreset}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="blue">{t("蓝色", "Blue")}</SelectItem>
                          <SelectItem value="green">{t("绿色", "Green")}</SelectItem>
                          <SelectItem value="amber">{t("琥珀", "Amber")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </label>

                    <label className="space-y-2">
                      <span className="text-sm font-medium text-foreground">{t("字体大小", "Font size")}</span>
                      <Select
                        onValueChange={(value) =>
                          updatePreferencesField("fontSize", value as ConsolePreferences["fontSize"])
                        }
                        value={preferencesForm.fontSize}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="small">{t("小", "Small")}</SelectItem>
                          <SelectItem value="medium">{t("标准", "Medium")}</SelectItem>
                          <SelectItem value="large">{t("大", "Large")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </label>

                    <label className="space-y-2">
                      <span className="text-sm font-medium text-foreground">{t("信息密度", "Density")}</span>
                      <Select
                        onValueChange={(value) =>
                          updatePreferencesField("density", value as ConsolePreferences["density"])
                        }
                        value={preferencesForm.density}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="compact">{t("紧凑", "Compact")}</SelectItem>
                          <SelectItem value="standard">{t("标准", "Standard")}</SelectItem>
                          <SelectItem value="comfortable">{t("舒适", "Comfortable")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </label>

                    <label className="space-y-2">
                      <span className="text-sm font-medium text-foreground">{t("侧边栏宽度", "Sidebar width")}</span>
                      <Select
                        onValueChange={(value) =>
                          updatePreferencesField("sidebarWidth", value as ConsolePreferences["sidebarWidth"])
                        }
                        value={preferencesForm.sidebarWidth}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="narrow">{t("窄", "Narrow")}</SelectItem>
                          <SelectItem value="standard">{t("标准", "Standard")}</SelectItem>
                          <SelectItem value="wide">{t("宽", "Wide")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </label>

                    <label className="space-y-2">
                      <span className="text-sm font-medium text-foreground">{t("默认首页", "Default landing page")}</span>
                      <Select
                        onValueChange={(value) =>
                          updatePreferencesField(
                            "defaultLandingPage",
                            value as ConsolePreferences["defaultLandingPage"],
                          )
                        }
                        value={preferencesForm.defaultLandingPage}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="home">{t("首页", "Home")}</SelectItem>
                          <SelectItem value="workspaces">{t("工作区", "Workspaces")}</SelectItem>
                          <SelectItem value="providers">{t("供应商", "Providers")}</SelectItem>
                          <SelectItem value="usage-events">{t("用量", "Usage Events")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </label>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <BooleanField
                      checked={preferencesForm.rememberLastWorkspace}
                      description={t(
                        "工作区切换后继续记住最近使用的工作区。",
                        "Keep using the most recent workspace after switches.",
                      )}
                      label={t("记住上次工作区", "Remember last workspace")}
                      onChange={(nextValue) =>
                        updatePreferencesField("rememberLastWorkspace", nextValue)
                      }
                    />
                    <BooleanField
                      checked={preferencesForm.rememberLastFilters}
                      description={t(
                        "在 Providers、Usage 等资源页恢复上次筛选。",
                        "Restore the most recent filters on resource pages like Providers and Usage.",
                      )}
                      label={t("记住筛选条件", "Remember last filters")}
                      onChange={(nextValue) =>
                        updatePreferencesField("rememberLastFilters", nextValue)
                      }
                    />
                    <BooleanField
                      checked={preferencesForm.showSupportPanelsByDefault}
                      description={t(
                        "在支持的页面显示右侧辅助面板。",
                        "Show support panels on pages that allow them.",
                      )}
                      label={t("显示辅助面板", "Show support panels")}
                      onChange={(nextValue) =>
                        updatePreferencesField("showSupportPanelsByDefault", nextValue)
                      }
                    />
                  </div>
                </div>
              </section>

              <div className="flex flex-wrap items-center gap-3">
                <Button disabled={loading || preferencesSaving} type="submit">
                  <Save className="mr-2 size-4" />
                  {preferencesSaving ? t("保存中", "Saving") : t("保存偏好", "Save preferences")}
                </Button>
                <Button onClick={resetPreferences} type="button" variant="ghost">
                  <RefreshCcw className="mr-2 size-4" />
                  {t("恢复默认", "Reset to defaults")}
                </Button>
                {preferencesNotice ? (
                  <span className="text-sm text-muted-foreground">{preferencesNotice}</span>
                ) : null}
              </div>
            </form>
          ) : null}

          {activeSection === "workspace" ? (
            <form className="space-y-5" onSubmit={handleWorkspaceSave}>
              <section className="rounded-xl border border-border/60 bg-background px-5 py-5">
                <div className="space-y-4">
                  <div className="space-y-1">
                    <h2 className="text-base font-semibold text-foreground">
                      {t("Workspace Defaults", "Workspace Defaults")}
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      {t(
                        "为当前工作区预置接入目标、默认项目和个人密钥默认值。",
                        "Preconfigure access targets, default project selection, and self-serve key defaults for the current workspace.",
                      )}
                    </p>
                  </div>

                  {!workspaceId ? (
                    <div className="rounded-xl border border-dashed border-border/60 bg-[color:color-mix(in_srgb,var(--surface-1)_96%,var(--surface-canvas)_4%)] px-4 py-4 text-sm text-muted-foreground">
                      {t(
                        "请先在页头选择一个工作区，再编辑该工作区的默认值。",
                        "Choose a workspace in the header before editing workspace defaults.",
                      )}
                    </div>
                  ) : null}

                  {workspaceId && workspaceForm ? (
                    <>
                      <div className="grid gap-5 sm:grid-cols-2">
                        <label className="space-y-2">
                          <span className="text-sm font-medium text-foreground">{t("默认接入目标", "Default access target")}</span>
                          <Select
                            disabled={workspaceContextLoading}
                            onValueChange={(value) =>
                              updateWorkspaceField("defaultProviderConnectionId", value === "__none__" ? "" : value)
                            }
                            value={workspaceForm.defaultProviderConnectionId || "__none__"}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">{t("不设置", "No default")}</SelectItem>
                              {(workspaceContext?.providerConnections ?? []).map((connection) => (
                                <SelectItem key={connection.id} value={connection.id}>
                                  {connection.label} · {connection.provider}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </label>

                        <label className="space-y-2">
                          <span className="text-sm font-medium text-foreground">{t("默认项目", "Default project")}</span>
                          <Select
                            disabled={workspaceContextLoading}
                            onValueChange={(value) =>
                              updateWorkspaceField("defaultProjectId", value === "__none__" ? "" : value)
                            }
                            value={workspaceForm.defaultProjectId || "__none__"}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">{t("不设置", "No default")}</SelectItem>
                              {(workspaceContext?.projects ?? []).map((project) => (
                                <SelectItem key={project.id} value={project.id}>
                                  {project.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </label>

                        <label className="space-y-2">
                          <span className="text-sm font-medium text-foreground">{t("模型目录提示", "Model catalog hint")}</span>
                          <Input
                            disabled={workspaceContextLoading}
                            onChange={(event) =>
                              updateWorkspaceField("defaultModelCatalogSourceHint", event.currentTarget.value)
                            }
                            placeholder={t("例如 official / customer-gateway", "For example, official / customer-gateway")}
                            value={workspaceForm.defaultModelCatalogSourceHint}
                          />
                        </label>

                        <label className="space-y-2">
                          <span className="text-sm font-medium text-foreground">{t("默认 TTL（小时）", "Default TTL (hours)")}</span>
                          <Input
                            disabled={workspaceContextLoading}
                            inputMode="numeric"
                            onChange={(event) =>
                              updateWorkspaceField("defaultVirtualKeyTtlHours", event.currentTarget.value)
                            }
                            value={workspaceForm.defaultVirtualKeyTtlHours}
                          />
                        </label>

                        <label className="space-y-2 sm:col-span-2">
                          <span className="text-sm font-medium text-foreground">{t("默认 scopes 模板", "Default scopes template")}</span>
                          <Input
                            disabled={workspaceContextLoading}
                            onChange={(event) =>
                              updateWorkspaceField("defaultVirtualKeyScopesTemplate", event.currentTarget.value)
                            }
                            placeholder="gateway:models, gateway:responses"
                            value={workspaceForm.defaultVirtualKeyScopesTemplate}
                          />
                        </label>
                      </div>

                      {(invalidWorkspaceSelections.provider || invalidWorkspaceSelections.project) ? (
                        <div className="rounded-xl border border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] px-4 py-3 text-sm text-[color:var(--warning-strong)]">
                          {invalidWorkspaceSelections.provider
                            ? t(
                                "已保存的默认接入目标当前在此工作区不可用，需要重新选择。",
                                "The saved default access target is no longer available in this workspace and must be reselected.",
                              )
                            : null}
                          {invalidWorkspaceSelections.provider && invalidWorkspaceSelections.project ? " " : null}
                          {invalidWorkspaceSelections.project
                            ? t(
                                "已保存的默认项目当前不存在或不可用，需要重新选择。",
                                "The saved default project no longer exists or is unavailable and must be reselected.",
                              )
                            : null}
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </section>

              <div className="flex flex-wrap items-center gap-3">
                <Button disabled={!workspaceId || workspaceSaving || !hasWorkspaceChanges} type="submit">
                  <Save className="mr-2 size-4" />
                  {workspaceSaving ? t("保存中", "Saving") : t("保存工作区默认值", "Save workspace defaults")}
                </Button>
                <Button disabled={!workspaceId} onClick={resetWorkspaceDefaults} type="button" variant="ghost">
                  <RefreshCcw className="mr-2 size-4" />
                  {t("恢复默认", "Reset to defaults")}
                </Button>
                {workspaceNotice ? (
                  <span className="text-sm text-muted-foreground">{workspaceNotice}</span>
                ) : null}
              </div>
            </form>
          ) : null}

          {activeSection === "runtime" ? (
            <form className="space-y-5" onSubmit={handleRuntimeSave}>
              <section className="rounded-xl border border-border/60 bg-background px-5 py-5">
                <div className="space-y-4">
                  <div className="space-y-1">
                    <h2 className="text-base font-semibold text-foreground">
                      {t("System Runtime", "System Runtime")}
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      {t(
                        "这些值会影响 Developer Access、/v1 代理和即时探测。",
                        "These values affect Developer Access, the /v1 proxy, and live probing.",
                      )}
                    </p>
                  </div>

                  {runtimeForm ? (
                    <div className="grid gap-5 sm:grid-cols-2">
                      <label className="space-y-2 sm:col-span-2">
                        <span className="text-sm font-medium text-foreground">{t("网关端点", "Gateway endpoint")}</span>
                        <Input
                          onChange={(event) => updateRuntimeField("gatewayBaseUrl", event.currentTarget.value)}
                          placeholder="https://gateway.example.com"
                          value={runtimeForm.gatewayBaseUrl}
                        />
                      </label>

                      <label className="space-y-2">
                        <span className="text-sm font-medium text-foreground">{t("请求基础路径", "Request base path")}</span>
                        <Input
                          onChange={(event) =>
                            updateRuntimeField("gatewayRequestBasePath", event.currentTarget.value)
                          }
                          placeholder="/v1"
                          value={runtimeForm.gatewayRequestBasePath}
                        />
                      </label>

                      <label className="space-y-2">
                        <span className="text-sm font-medium text-foreground">{t("健康检查路径", "Health path")}</span>
                        <Input
                          onChange={(event) => updateRuntimeField("gatewayHealthPath", event.currentTarget.value)}
                          placeholder="/healthz"
                          value={runtimeForm.gatewayHealthPath}
                        />
                      </label>

                      <label className="space-y-2">
                        <span className="text-sm font-medium text-foreground">Chat Completions</span>
                        <Input
                          onChange={(event) =>
                            updateRuntimeField(
                              "gatewayChatCompletionsPath",
                              event.currentTarget.value,
                            )
                          }
                          placeholder="/chat/completions"
                          value={runtimeForm.gatewayChatCompletionsPath}
                        />
                      </label>

                      <label className="space-y-2">
                        <span className="text-sm font-medium text-foreground">Responses</span>
                        <Input
                          onChange={(event) =>
                            updateRuntimeField("gatewayResponsesPath", event.currentTarget.value)
                          }
                          placeholder="/responses"
                          value={runtimeForm.gatewayResponsesPath}
                        />
                      </label>

                      <label className="space-y-2">
                        <span className="text-sm font-medium text-foreground">Models</span>
                        <Input
                          onChange={(event) =>
                            updateRuntimeField("gatewayModelsPath", event.currentTarget.value)
                          }
                          placeholder="/models"
                          value={runtimeForm.gatewayModelsPath}
                        />
                      </label>

                      <label className="space-y-2">
                        <span className="text-sm font-medium text-foreground">{t("请求超时（毫秒）", "Timeout (ms)")}</span>
                        <Input
                          inputMode="numeric"
                          onChange={(event) =>
                            updateRuntimeField("gatewayRequestTimeoutMs", event.currentTarget.value)
                          }
                          placeholder="15000"
                          value={runtimeForm.gatewayRequestTimeoutMs}
                        />
                      </label>
                    </div>
                  ) : null}
                </div>
              </section>

              <section className="rounded-xl border border-border/60 bg-[color:color-mix(in_srgb,var(--surface-1)_97%,var(--surface-canvas)_3%)] px-5 py-5">
                <div className="space-y-3">
                  <p className="text-sm font-medium text-foreground">{t("即时预览", "Live preview")}</p>
                  <div className="space-y-3 text-sm">
                    <div>
                      <div className="text-xs text-muted-foreground">{t("接入端点", "Access endpoint")}</div>
                      <code className="mt-1 block break-all rounded-lg border border-border/50 bg-background px-3 py-2 font-mono text-[12px] text-foreground">
                        {runtimePreviews?.endpoint ?? " "}
                      </code>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Chat Completions</div>
                      <code className="mt-1 block break-all rounded-lg border border-border/50 bg-background px-3 py-2 font-mono text-[12px] text-foreground">
                        {runtimePreviews?.chatCompletions ?? " "}
                      </code>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Responses</div>
                      <code className="mt-1 block break-all rounded-lg border border-border/50 bg-background px-3 py-2 font-mono text-[12px] text-foreground">
                        {runtimePreviews?.responses ?? " "}
                      </code>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Models</div>
                      <code className="mt-1 block break-all rounded-lg border border-border/50 bg-background px-3 py-2 font-mono text-[12px] text-foreground">
                        {runtimePreviews?.models ?? " "}
                      </code>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">{t("探测地址", "Probe URL")}</div>
                      <code className="mt-1 block break-all rounded-lg border border-border/50 bg-background px-3 py-2 font-mono text-[12px] text-foreground">
                        {runtimePreviews?.health ?? " "}
                      </code>
                    </div>
                  </div>
                </div>
              </section>

              <div className="flex flex-wrap items-center gap-3">
                <Button disabled={runtimeSaving || !hasRuntimeChanges} type="submit">
                  <Save className="mr-2 size-4" />
                  {runtimeSaving ? t("保存中", "Saving") : t("保存运行时设置", "Save runtime settings")}
                </Button>
                <Button disabled={probing || !runtimeForm} onClick={() => void handleProbe()} type="button" variant="outline">
                  <Activity className="mr-2 size-4" />
                  {probing ? t("探测中", "Probing") : t("立即探测", "Probe now")}
                </Button>
                <Button onClick={resetRuntime} type="button" variant="ghost">
                  <RefreshCcw className="mr-2 size-4" />
                  {t("恢复默认", "Reset to defaults")}
                </Button>
                {runtimeNotice ? (
                  <span className="text-sm text-muted-foreground">{runtimeNotice}</span>
                ) : null}
              </div>
            </form>
          ) : null}

          {activeSection === "diagnostics" ? (
            <div className="space-y-5">
              <section className="rounded-xl border border-border/60 bg-background px-5 py-5">
                <div className="space-y-4">
                  <div className="space-y-1">
                    <h2 className="text-base font-semibold text-foreground">
                      {t("Diagnostics", "Diagnostics")}
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      {t(
                        "查看当前配置来源、文件位置以及最近一次即时探测结果。",
                        "Inspect configuration source, file location, and the latest live probe result.",
                      )}
                    </p>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    <div className="rounded-xl border border-border/60 bg-[color:color-mix(in_srgb,var(--surface-1)_96%,var(--surface-canvas)_4%)] px-4 py-3">
                      <div className="text-xs text-muted-foreground">{t("配置来源", "Config source")}</div>
                      <div className="mt-2">
                        <StatusBadge indicator status={response?.source === "file" ? "healthy" : "default"}>
                          {response?.source === "file"
                            ? t("本地文件", "Local file")
                            : t("默认值", "Defaults")}
                        </StatusBadge>
                      </div>
                    </div>

                    <div className="rounded-xl border border-border/60 bg-[color:color-mix(in_srgb,var(--surface-1)_96%,var(--surface-canvas)_4%)] px-4 py-3">
                      <div className="text-xs text-muted-foreground">{t("最近更新时间", "Last updated")}</div>
                      <div className="mt-2 text-sm font-medium text-foreground">
                        {response?.updatedAt
                          ? new Date(response.updatedAt).toLocaleString(locale)
                          : t("尚未保存", "Not saved yet")}
                      </div>
                    </div>

                    <div className="rounded-xl border border-border/60 bg-[color:color-mix(in_srgb,var(--surface-1)_96%,var(--surface-canvas)_4%)] px-4 py-3">
                      <div className="text-xs text-muted-foreground">{t("即时探测", "Latest probe")}</div>
                      <div className="mt-2">
                        {probeResult ? (
                          <StatusBadge indicator status={probeResult.ok ? "healthy" : "warning"}>
                            {probeResult.ok ? t("可达", "Reachable") : t("异常", "Problem")}
                          </StatusBadge>
                        ) : (
                          <span className="text-sm text-muted-foreground">{t("尚未探测", "Not probed yet")}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3 text-sm">
                    <div>
                      <div className="text-xs text-muted-foreground">{t("设置文件", "Settings file")}</div>
                      <code className="mt-1 block break-all rounded-lg border border-border/50 bg-[color:color-mix(in_srgb,var(--surface-1)_96%,var(--surface-canvas)_4%)] px-3 py-2 font-mono text-[12px] text-foreground">
                        {response?.filePath ?? " "}
                      </code>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Control API</div>
                      <code className="mt-1 block break-all rounded-lg border border-border/50 bg-[color:color-mix(in_srgb,var(--surface-1)_96%,var(--surface-canvas)_4%)] px-3 py-2 font-mono text-[12px] text-foreground">
                        {response?.references.controlApiBaseUrl ?? " "}
                      </code>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <div className="text-xs text-muted-foreground">{t("本地代理入口", "Local proxy entry")}</div>
                        <code className="mt-1 block rounded-lg border border-border/50 bg-[color:color-mix(in_srgb,var(--surface-1)_96%,var(--surface-canvas)_4%)] px-3 py-2 font-mono text-[12px] text-foreground">
                          {response?.references.gatewayProxyPathPrefix ?? "/v1"}
                        </code>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">{t("web-admin 健康检查", "web-admin health")}</div>
                        <code className="mt-1 block rounded-lg border border-border/50 bg-[color:color-mix(in_srgb,var(--surface-1)_96%,var(--surface-canvas)_4%)] px-3 py-2 font-mono text-[12px] text-foreground">
                          {response?.references.webAdminHealthPath ?? "/api/healthz"}
                        </code>
                      </div>
                    </div>
                    {probeResult ? (
                      <div className="rounded-xl border border-border/60 bg-background px-4 py-3">
                        <div className="flex flex-wrap items-center gap-3">
                          <StatusBadge indicator status={probeResult.ok ? "healthy" : "warning"}>
                            {probeResult.httpStatus ?? "ERR"}
                          </StatusBadge>
                          <span className="text-sm text-muted-foreground">{probeResult.durationMs}ms</span>
                          {probeResult.service ? (
                            <span className="text-sm text-muted-foreground">{probeResult.service}</span>
                          ) : null}
                        </div>
                        <code className="mt-3 block break-all rounded-lg border border-border/50 bg-[color:color-mix(in_srgb,var(--surface-1)_96%,var(--surface-canvas)_4%)] px-3 py-2 font-mono text-[12px] text-foreground">
                          {probeResult.url}
                        </code>
                        {probeResult.message ? (
                          <p className="mt-3 text-sm text-muted-foreground">{probeResult.message}</p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              </section>

              <section className="rounded-xl border border-border/60 bg-[color:color-mix(in_srgb,var(--surface-1)_97%,var(--surface-canvas)_3%)] px-5 py-5">
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <TimerReset className="size-4 text-muted-foreground" />
                    <p className="text-sm font-medium text-foreground">{t("当前生效快照", "Effective snapshot")}</p>
                  </div>
                  <pre className="overflow-x-auto rounded-xl border border-border/60 bg-background px-4 py-4 font-mono text-[12px] leading-6 text-foreground">
                    {diagnosticsSnapshot ? JSON.stringify(diagnosticsSnapshot, null, 2) : "{}"}
                  </pre>
                </div>
              </section>
            </div>
          ) : null}
        </div>
      </section>
    </AppShell>
  );
}
