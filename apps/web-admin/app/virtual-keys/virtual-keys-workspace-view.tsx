"use client";

import {
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  type ChangeEvent,
  type FormEvent,
  useState,
} from "react";
import { useRouter } from "next/navigation";

import {
  VirtualKeyGatewayScopeValues,
  normalizeVirtualKeyScopes,
  type Environment,
  type Project,
  type ProviderConnection,
  type VirtualKey,
  type VirtualKeyInventorySummary,
} from "@teamops/contracts";

import {
  bulkRevokeVirtualKeysAction,
  bulkRotateVirtualKeysAction,
  createVirtualKeyAction,
  revokeVirtualKeyAction,
  rotateVirtualKeyAction,
  type BulkRotateVirtualKeysActionResult,
  type CreateVirtualKeyActionResult,
} from "./actions";
import enVirtualKeysMessages from "../messages/en/virtualKeys.json";
import zhVirtualKeysMessages from "../messages/zh/virtualKeys.json";
import { CompactToolbar, FilterField } from "../components/resource-compact-toolbar";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { ChevronDown, Plus, Settings2, Shield, Sparkles, SquareTerminal, Users } from "lucide-react";
import { CopyButton } from "../components/copy-button";
import { ResourceCreateDialog } from "../components/resource-create-dialog";
import { ResourceInlineNotice } from "../components/resource-inline-notice";
import { ConfirmActionButton } from "../components/confirm-action-button";
import { useCapabilities } from "../components/capability-provider";
import {
  compareDisplayLabels,
  filterEnvironmentsForProject,
  formatEnvironmentOptionLabel,
  formatProjectOptionLabel,
  sortEnvironmentsForDisplay,
  sortProjectsForDisplay,
} from "../lib/resource-scope";
import { translateInlineText, type AppLocale } from "../lib/i18n";
import { buildContextualHref } from "../lib/navigation";

export type VirtualKeysWorkspaceViewProps = {
  workspaceId: string;
  returnTo?: string | null;
  initialSearchQuery?: string;
  initialStatusFilter?: VirtualKeyStatusFilter;
  initialBindingFilter?: VirtualKeyBindingFilter;
  initialRiskFilter?: VirtualKeyRiskFilter;
  initialIssuanceFilter?: VirtualKeyIssuanceFilter;
  initialVirtualKeys: VirtualKey[];
  initialInventorySummary: VirtualKeyInventorySummary;
  providerConnections: ProviderConnection[];
  projects: Project[];
  environments: Environment[];
  totalVirtualKeys: number;
  pageOffset: number;
  pageSize: number;
  locale: AppLocale;
  [key: string]: unknown;
};

type VirtualKeyStatusFilter = "all" | "active" | "expired" | "revoked" | "unused" | "expiring_soon";
type VirtualKeyBindingFilter = "all" | "workspace" | "project" | "environment";
type VirtualKeyRiskFilter = "all" | "expiring_soon" | "never_used" | "dormant_wide_access" | "workspace_wide_active";
type VirtualKeyIssuanceFilter = "all" | "self_serve" | "admin";
type WorkloadType = "service" | "shared";
type IssuancePreset = {
  id: "human-session" | "service-bot" | "prod-runtime";
  titleKey: string;
  summaryKey: string;
  scopes: string[];
  expiresInDays: number | null;
  environmentRuntime: "development" | "staging" | "production";
};

type ResetCreateFormOptions = {
  preserveSticky?: boolean;
};

type VirtualKeyRowModel = {
  auditHref: string;
  bindingDisplay: string;
  bindingMeta: string | null;
  daysUntilExpiry: number | null;
  expired: boolean;
  expiringSoon: boolean;
  riskState: ReturnType<typeof getVirtualKeyRiskState>;
  trailHref: string;
  trailLabel: string;
  virtualKey: VirtualKey;
};

type SuggestionOption = {
  label: string;
  value: string;
};

const knownServiceLabels = {
  "campaign-review": {
    zh: "活动审核（campaign-review）",
  },
  "campaign-runtime": {
    zh: "活动运行时（campaign-runtime）",
  },
  "core-api": {
    zh: "核心 API（core-api）",
  },
  "support-agent": {
    zh: "支持代理（support-agent）",
  },
  "web-frontend": {
    zh: "前端应用（web-frontend）",
  },
} as const satisfies Record<string, { zh: string }>;

const initialCreateState: CreateVirtualKeyActionResult = {
  status: "idle",
  message: null,
  created: null,
};
const documentedGatewayScopes = VirtualKeyGatewayScopeValues.join(", ");
const virtualKeyViewPreferenceStorageKeyPrefix = "teamops:virtual-keys:view";
const virtualKeyIssuancePreferenceStorageKeyPrefix = "teamops:virtual-keys:issuance";
const emptySelectValue = "__empty__";
const issuancePresets: IssuancePreset[] = [
  {
    id: "human-session",
    titleKey: "presets.humanSession.title",
    summaryKey: "presets.humanSession.summary",
    scopes: ["gateway:models", "gateway:messages"],
    expiresInDays: 7,
    environmentRuntime: "development",
  },
  {
    id: "service-bot",
    titleKey: "presets.serviceBot.title",
    summaryKey: "presets.serviceBot.summary",
    scopes: ["gateway:models", "gateway:responses"],
    expiresInDays: 30,
    environmentRuntime: "staging",
  },
  {
    id: "prod-runtime",
    titleKey: "presets.productionRuntime.title",
    summaryKey: "presets.productionRuntime.summary",
    scopes: ["gateway:*"],
    expiresInDays: 30,
    environmentRuntime: "production",
  },
];

function getIssuancePresetById(id: IssuancePreset["id"]) {
  return issuancePresets.find((preset) => preset.id === id) ?? issuancePresets[0];
}

function buildSuggestionOptions(
  locale: AppLocale,
  values: Array<string | null | undefined>,
  fallbacks: string[],
): SuggestionOption[] {
  const uniqueValues = new Set<string>();

  for (const value of [...values, ...fallbacks]) {
    if (!value?.trim()) {
      continue;
    }

    uniqueValues.add(value.trim());
  }

  return Array.from(uniqueValues)
    .sort((left, right) => compareDisplayLabels(left, right, locale))
    .map((value) => ({
      value,
      label: value,
    }));
}

function formatKnownServiceLabel(value: string, locale: AppLocale) {
  if (locale !== "zh") {
    return value;
  }

  return knownServiceLabels[value as keyof typeof knownServiceLabels]?.zh ?? value;
}

function getVirtualKeyLabelPlaceholder(presetId: IssuancePreset["id"], workloadType: WorkloadType) {
  if (workloadType === "shared") {
    return "workspace-shared-tool";
  }

  switch (presetId) {
    case "human-session":
      return "shared-tool";
    case "service-bot":
      return "support-bot";
    case "prod-runtime":
      return "gateway-prod";
    default:
      return "virtual-key";
  }
}


function resolveVirtualKeysMessage(messages: Record<string, unknown>, key: string): string | null {
  const exact = messages[key];
  if (typeof exact === "string") return exact;
  const nested = key.split(".").reduce<unknown>((current, part) =>
    current && typeof current === "object" && part in (current as Record<string, unknown>)
      ? (current as Record<string, unknown>)[part]
      : null, messages);
  return typeof nested === "string" ? nested : null;
}

function createVirtualKeysTranslator(locale: AppLocale) {
  const messages = (locale === "zh" ? zhVirtualKeysMessages : enVirtualKeysMessages) as Record<string, unknown>;
  return (key: string, values?: Record<string, string | number>) => {
    const template = resolveVirtualKeysMessage(messages, key);
    if (!template) return translateInlineText(locale, key);
    return template.replace(/\{(\w+)\}/g, (_, token) => String(values?.[token] ?? `{${token}}`));
  };
}

function getIntlLocale(locale: AppLocale) {
  return locale === "zh" ? "zh-CN" : "en-US";
}

function getLocalizedKeyPrefixLabel(
  locale: AppLocale,
  tr: ReturnType<typeof createVirtualKeysTranslator>,
  keyPrefix: string,
) {
  return keyPrefix.trim() || tr("maskedKeyFragment");
}

function createFormatters(locale: AppLocale, tr: ReturnType<typeof createVirtualKeysTranslator>) {
  const intlLocale = getIntlLocale(locale);

  return {
    formatDateTime(value: string | null) {
      if (!value) {
        return tr("Never used");
      }

      return new Intl.DateTimeFormat(intlLocale, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value));
    },
    formatInteger(value: number) {
      return new Intl.NumberFormat(intlLocale).format(value);
    },
  };
}

function formatDateTimeInputValue(value: string | null) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  const pad = (input: number) => String(input).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function parseScopes(value: string) {
  return normalizeVirtualKeyScopes(value.split(/[\n,]+/));
}

function getFutureDateTimeInputValue(daysFromNow: number) {
  const date = new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000);
  const pad = (input: number) => String(input).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function getLocalizedRuntimeLabel(
  tr: ReturnType<typeof createVirtualKeysTranslator>,
  runtime: "development" | "staging" | "production" | null | undefined,
) {
  if (!runtime) {
    return tr("runtime.unset");
  }

  switch (runtime) {
    case "development":
      return tr("runtime.development");
    case "staging":
      return tr("runtime.staging");
    case "production":
      return tr("runtime.production");
    default:
      return runtime;
  }
}

function getLocalizedScopeLabel(locale: AppLocale, scope: string) {
  if (locale !== "zh") {
    return scope;
  }

  switch (scope) {
    case "gateway:models":
      return "模型访问";
    case "gateway:messages":
      return "消息接口";
    case "gateway:responses":
      return "响应接口";
    case "gateway:*":
      return "全部网关范围";
    default:
      return scope;
  }
}

function formatDaysLeftLabel(
  tr: ReturnType<typeof createVirtualKeysTranslator>,
  daysUntilExpiry: number,
) {
  return tr(
    daysUntilExpiry === 1 ? "expiry.daysLeft.one" : "expiry.daysLeft.other",
    { days: daysUntilExpiry },
  );
}

function getLocalizedStatusLabel(tr: ReturnType<typeof createVirtualKeysTranslator>, status: VirtualKey["status"]) {
  switch (status) {
    case "active":
      return tr("status.active");
    case "revoked":
      return tr("status.revoked");
    default:
      return status;
  }
}

function getStatusTagClass(status: VirtualKey["status"]) {
  return status === "revoked" ? "tag tag--critical" : "tag";
}

function getIssuanceModeTagClass(issuanceMode: VirtualKey["issuanceMode"]) {
  return issuanceMode === "self_serve" ? "tag tag--resolved" : "tag";
}

function getLocalizedIssuanceModeLabel(
  locale: AppLocale,
  issuanceMode: VirtualKey["issuanceMode"],
) {
  if (issuanceMode === "self_serve") {
    return locale === "zh" ? "self-serve" : "self-serve";
  }

  return locale === "zh" ? "admin-issued" : "admin-issued";
}

function isExpired(value: string | null, now = new Date()) {
  if (!value) {
    return false;
  }

  return Date.parse(value) <= now.getTime();
}

function getDaysUntil(value: string | null, now = new Date()) {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.ceil((parsed - now.getTime()) / (24 * 60 * 60 * 1000));
}

function isExpiringSoon(value: string | null, now = new Date()) {
  const daysUntil = getDaysUntil(value, now);
  return daysUntil !== null && daysUntil >= 0 && daysUntil <= 14;
}

function getDaysSince(value: string | null, now = new Date()) {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.max(0, Math.floor((now.getTime() - parsed) / (24 * 60 * 60 * 1000)));
}

function isDormantWideAccess(virtualKey: VirtualKey, now = new Date()) {
  if (virtualKey.status !== "active" || isExpired(virtualKey.expiresAt, now) || virtualKey.lastUsedAt) {
    return false;
  }

  if (getVirtualKeyBindingFilterValue(virtualKey) !== "workspace" || virtualKey.expiresAt) {
    return false;
  }

  const ageDays = getDaysSince(virtualKey.createdAt, now);
  return ageDays !== null && ageDays >= 14;
}

function getVirtualKeyBindingFilterValue(virtualKey: Pick<VirtualKey, "projectId" | "environmentId">) {
  if (virtualKey.environmentId) {
    return "environment" as const;
  }

  if (virtualKey.projectId) {
    return "project" as const;
  }

  return "workspace" as const;
}

function buildVirtualKeysPageHref(args: {
  workspaceId: string;
  offset: number;
  q?: string | null;
  statusFilter?: VirtualKeyStatusFilter;
  bindingFilter?: VirtualKeyBindingFilter;
  riskFilter?: VirtualKeyRiskFilter;
  issuanceFilter?: VirtualKeyIssuanceFilter;
  returnTo?: string | null;
}) {
  const params = new URLSearchParams({
    workspaceId: args.workspaceId,
  });

  if (args.offset > 0) {
    params.set("offset", String(args.offset));
  }

  if (args.q?.trim()) {
    params.set("q", args.q.trim());
  }

  if (args.statusFilter && args.statusFilter !== "all") {
    params.set("status", args.statusFilter);
  }

  if (args.bindingFilter && args.bindingFilter !== "all") {
    params.set("binding", args.bindingFilter);
  }

  if (args.riskFilter && args.riskFilter !== "all") {
    params.set("risk", args.riskFilter);
  }

  if (args.issuanceFilter && args.issuanceFilter !== "all") {
    params.set("issuance", args.issuanceFilter);
  }

  return buildContextualHref(`/virtual-keys?${params.toString()}`, args.returnTo);
}

function getVirtualKeyRiskState(
  virtualKey: VirtualKey,
  tr: ReturnType<typeof createVirtualKeysTranslator>,
  now = new Date(),
) {
  const expired = isExpired(virtualKey.expiresAt, now);
  const expiringSoon = !expired && isExpiringSoon(virtualKey.expiresAt, now);
  const workspaceWide = getVirtualKeyBindingFilterValue(virtualKey) === "workspace";
  const dormantWideAccess = isDormantWideAccess(virtualKey, now);

  if (virtualKey.status === "revoked") {
    return {
      label: tr("risk.retired.label"),
      className: "tag",
      summary: tr("risk.retired.summary"),
      priority: 6,
    };
  }

  if (expired) {
    return {
      label: tr("risk.expired.label"),
      className: "tag tag--critical",
      summary: tr("risk.expired.summary"),
      priority: 0,
    };
  }

  if (expiringSoon) {
    const daysUntilExpiry = getDaysUntil(virtualKey.expiresAt, now);
    return {
      label: tr("risk.expiringSoon.label"),
      className: "tag tag--warning",
      summary:
        daysUntilExpiry === null
          ? tr("risk.expiringSoon.summary")
          : formatDaysLeftLabel(tr, daysUntilExpiry),
      priority: 1,
    };
  }

  if (!virtualKey.providerConnectionId) {
    return {
      label: tr("risk.providerBindingRequired.label"),
      className: "tag tag--critical",
      summary: tr("risk.providerBindingRequired.summary"),
      priority: 2,
    };
  }

  if (dormantWideAccess) {
    return {
      label: tr("risk.dormantWideAccess.label"),
      className: "tag tag--warning",
      summary: tr("risk.dormantWideAccess.summary"),
      priority: 3,
    };
  }

  if (!virtualKey.lastUsedAt) {
    return {
      label: tr("risk.neverUsed.label"),
      className: "tag tag--warning",
      summary: tr("risk.neverUsed.summary"),
      priority: 3,
    };
  }

  if (workspaceWide) {
    return {
      label: tr("risk.workspaceWideActive.label"),
      className: "tag",
      summary: tr("risk.workspaceWideActive.summary"),
      priority: 4,
    };
  }

  return {
    label: tr("risk.healthy.label"),
    className: "tag tag--resolved",
    summary: tr("risk.healthy.summary"),
    priority: 5,
  };
}

function getLocalizedActionMessage(
  tr: ReturnType<typeof createVirtualKeysTranslator>,
  formatInteger: (value: number) => string,
  message: string | null,
  values?: Record<string, string | number>,
) {
  if (!message) {
    return null;
  }

  return tr(message, values);
}

export function VirtualKeysWorkspaceView({
  workspaceId,
  returnTo,
  initialSearchQuery = "",
  initialStatusFilter = "all",
  initialBindingFilter = "all",
  initialRiskFilter = "all",
  initialIssuanceFilter = "all",
  initialVirtualKeys,
  initialInventorySummary,
  providerConnections,
  projects,
  environments,
  totalVirtualKeys,
  pageOffset,
  pageSize,
  locale,
}: VirtualKeysWorkspaceViewProps) {
  const router = useRouter();
  const capabilities = useCapabilities();
  const tr = createVirtualKeysTranslator(locale);
  const { formatDateTime, formatInteger } = useMemo(
    () => createFormatters(locale, tr),
    [locale, tr],
  );
  const virtualKeyViewPreferenceStorageKey = `${virtualKeyViewPreferenceStorageKeyPrefix}:${workspaceId}`;
  const virtualKeyIssuancePreferenceStorageKey = `${virtualKeyIssuancePreferenceStorageKeyPrefix}:${workspaceId}`;
  const [virtualKeys, setVirtualKeys] = useState(initialVirtualKeys);
  const [inventorySummary, setInventorySummary] = useState(initialInventorySummary);
  const [providerConnectionId, setProviderConnectionId] = useState("");
  const [label, setLabel] = useState("");
  const [owner, setOwner] = useState("");
  const [team, setTeam] = useState("");
  const [service, setService] = useState("");
  const [projectId, setProjectId] = useState("");
  const [environmentId, setEnvironmentId] = useState("");
  const [environmentRuntime, setEnvironmentRuntime] = useState<"development" | "staging" | "production">("production");
  const [scopesInput, setScopesInput] = useState("");
  const [expiresAtInput, setExpiresAtInput] = useState("");
  const [selectedPresetId, setSelectedPresetId] = useState<IssuancePreset["id"]>("service-bot");
  const [workloadType, setWorkloadType] = useState<WorkloadType>("service");
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery);
  const [statusFilter, setStatusFilter] = useState<VirtualKeyStatusFilter>(initialStatusFilter);
  const [bindingFilter, setBindingFilter] = useState<VirtualKeyBindingFilter>(initialBindingFilter);
  const [riskFilter, setRiskFilter] = useState<VirtualKeyRiskFilter>(initialRiskFilter);
  const [issuanceFilter, setIssuanceFilter] = useState<VirtualKeyIssuanceFilter>(initialIssuanceFilter);
  const [selectedVirtualKeyIds, setSelectedVirtualKeyIds] = useState<string[]>([]);
  const [createState, setCreateState] = useState<CreateVirtualKeyActionResult>(initialCreateState);
  const [createFlowState, setCreateFlowState] = useState<CreateVirtualKeyActionResult>(initialCreateState);
  const [bulkRotateState, setBulkRotateState] = useState<BulkRotateVirtualKeysActionResult | null>(null);
  const [isCreatePending, setIsCreatePending] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [revokePendingId, setRevokePendingId] = useState<string | null>(null);
  const [rotatePendingId, setRotatePendingId] = useState<string | null>(null);
  const [isBulkRevokePending, setIsBulkRevokePending] = useState(false);
  const [isBulkRotatePending, setIsBulkRotatePending] = useState(false);
  const [revokeMessage, setRevokeMessage] = useState<string | null>(null);
  const [hasHydratedPreferences, setHasHydratedPreferences] = useState(false);
  const deferredSearchQuery = useDeferredValue(searchQuery.trim().toLowerCase());
  const currentPageHref = useMemo(
    () =>
      buildVirtualKeysPageHref({
        workspaceId,
        offset: pageOffset,
        q: searchQuery.trim(),
        statusFilter,
        bindingFilter,
        riskFilter,
        issuanceFilter,
        returnTo,
      }),
    [
      bindingFilter,
      issuanceFilter,
      pageOffset,
      returnTo,
      riskFilter,
      searchQuery,
      statusFilter,
      workspaceId,
    ],
  );

  useEffect(() => {
    setSearchQuery(initialSearchQuery);
    setStatusFilter(initialStatusFilter);
    setBindingFilter(initialBindingFilter);
    setRiskFilter(initialRiskFilter);
    setIssuanceFilter(initialIssuanceFilter);
  }, [initialBindingFilter, initialIssuanceFilter, initialRiskFilter, initialSearchQuery, initialStatusFilter, workspaceId]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.history.replaceState(window.history.state, "", currentPageHref);
  }, [currentPageHref]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      const storedViewValue = window.localStorage.getItem(virtualKeyViewPreferenceStorageKey);
      if (storedViewValue) {
        const parsed = JSON.parse(storedViewValue) as {
          statusFilter?: VirtualKeyStatusFilter;
          bindingFilter?: VirtualKeyBindingFilter;
          riskFilter?: VirtualKeyRiskFilter;
          issuanceFilter?: VirtualKeyIssuanceFilter;
        };

        if (
          parsed.statusFilter === "all" ||
          parsed.statusFilter === "active" ||
          parsed.statusFilter === "expired" ||
          parsed.statusFilter === "revoked" ||
          parsed.statusFilter === "unused" ||
          parsed.statusFilter === "expiring_soon"
        ) {
          setStatusFilter(parsed.statusFilter);
        }

        if (
          parsed.bindingFilter === "all" ||
          parsed.bindingFilter === "workspace" ||
          parsed.bindingFilter === "project" ||
          parsed.bindingFilter === "environment"
        ) {
          setBindingFilter(parsed.bindingFilter);
        }

        if (
          parsed.riskFilter === "all" ||
          parsed.riskFilter === "expiring_soon" ||
          parsed.riskFilter === "never_used" ||
          parsed.riskFilter === "dormant_wide_access" ||
          parsed.riskFilter === "workspace_wide_active"
        ) {
          setRiskFilter(parsed.riskFilter);
        }

        if (
          parsed.issuanceFilter === "all" ||
          parsed.issuanceFilter === "self_serve" ||
          parsed.issuanceFilter === "admin"
        ) {
          setIssuanceFilter(parsed.issuanceFilter);
        }
      }

      const storedIssuanceValue =
        window.sessionStorage.getItem(virtualKeyIssuancePreferenceStorageKey) ??
        window.localStorage.getItem(virtualKeyIssuancePreferenceStorageKey);
      if (storedIssuanceValue) {
        const parsed = JSON.parse(storedIssuanceValue) as {
          providerConnectionId?: string;
          owner?: string;
          team?: string;
          service?: string;
          projectId?: string;
          environmentId?: string;
          environmentRuntime?: "development" | "staging" | "production";
          selectedPresetId?: IssuancePreset["id"];
          workloadType?: WorkloadType;
        };

        if (typeof parsed.providerConnectionId === "string") {
          setProviderConnectionId(parsed.providerConnectionId);
        }
        if (typeof parsed.owner === "string") {
          setOwner(parsed.owner);
        }
        if (typeof parsed.team === "string") {
          setTeam(parsed.team);
        }
        if (typeof parsed.service === "string") {
          setService(parsed.service);
        }
        if (typeof parsed.projectId === "string") {
          setProjectId(parsed.projectId);
        }
        if (typeof parsed.environmentId === "string") {
          setEnvironmentId(parsed.environmentId);
        }
        if (
          parsed.environmentRuntime === "development" ||
          parsed.environmentRuntime === "staging" ||
          parsed.environmentRuntime === "production"
        ) {
          setEnvironmentRuntime(parsed.environmentRuntime);
        }
        if (
          parsed.selectedPresetId === "human-session" ||
          parsed.selectedPresetId === "service-bot" ||
          parsed.selectedPresetId === "prod-runtime"
        ) {
          setSelectedPresetId(parsed.selectedPresetId);
        }
        if (parsed.workloadType === "service" || parsed.workloadType === "shared") {
          setWorkloadType(parsed.workloadType);
        }
      }

      window.localStorage.removeItem(virtualKeyIssuancePreferenceStorageKey);
    } catch {
      // Ignore malformed local preferences and fall back to defaults.
    }

    setHasHydratedPreferences(true);
  }, [virtualKeyIssuancePreferenceStorageKey, virtualKeyViewPreferenceStorageKey]);

  useEffect(() => {
    if (typeof window === "undefined" || !hasHydratedPreferences) {
      return;
    }

    window.localStorage.setItem(
      virtualKeyViewPreferenceStorageKey,
      JSON.stringify({
        statusFilter,
        bindingFilter,
        riskFilter,
        issuanceFilter,
      }),
    );
  }, [
    bindingFilter,
    hasHydratedPreferences,
    issuanceFilter,
    riskFilter,
    statusFilter,
    virtualKeyViewPreferenceStorageKey,
  ]);

  useEffect(() => {
    if (typeof window === "undefined" || !hasHydratedPreferences) {
      return;
    }

    window.sessionStorage.setItem(
      virtualKeyIssuancePreferenceStorageKey,
      JSON.stringify({
        providerConnectionId,
        owner,
        team,
        service,
        projectId,
        environmentId,
        environmentRuntime,
        selectedPresetId,
        workloadType,
      }),
    );
    window.localStorage.removeItem(virtualKeyIssuancePreferenceStorageKey);
  }, [
    environmentRuntime,
    hasHydratedPreferences,
    owner,
    providerConnectionId,
    projectId,
    environmentId,
    selectedPresetId,
    service,
    team,
    workloadType,
    virtualKeyIssuancePreferenceStorageKey,
  ]);

  const selectedVirtualKeyIdSet = useMemo(
    () => new Set(selectedVirtualKeyIds),
    [selectedVirtualKeyIds],
  );
  const {
    activeEnvironments,
    activeProjects,
    activeProviderConnections,
    environmentsById,
    hiddenArchivedEnvironmentCount,
    hiddenArchivedProjectCount,
    projectNamesById,
    providerConnectionsById,
    virtualKeysById,
  } = useMemo(() => {
    const nextSortedProjects = sortProjectsForDisplay(projects, locale);
    const nextSortedEnvironments = sortEnvironmentsForDisplay(
      environments,
      nextSortedProjects,
      locale,
    );
    const nextSortedProviderConnections = [...providerConnections].sort(
      (left, right) =>
        compareDisplayLabels(left.label, right.label, locale) ||
        compareDisplayLabels(left.provider, right.provider, locale),
    );
    const nextActiveProjects = nextSortedProjects.filter(
      (project) => project.status === "active",
    );
    const activeProjectIds = new Set(
      nextActiveProjects.map((project) => project.id),
    );
    const nextActiveEnvironments = nextSortedEnvironments.filter(
      (environment) =>
        environment.status === "active" &&
        activeProjectIds.has(environment.projectId),
    );

    return {
      activeProjects: nextActiveProjects,
      activeEnvironments: nextActiveEnvironments,
      projectNamesById: Object.fromEntries(
        nextSortedProjects.map((project) => [project.id, project.name]),
      ),
      environmentsById: Object.fromEntries(
        nextSortedEnvironments.map((environment) => [environment.id, environment]),
      ),
      providerConnectionsById: Object.fromEntries(
        nextSortedProviderConnections.map((provider) => [provider.id, provider]),
      ),
      virtualKeysById: Object.fromEntries(
        virtualKeys.map((virtualKey) => [virtualKey.id, virtualKey]),
      ),
      activeProviderConnections: nextSortedProviderConnections.filter(
        (provider) => provider.status === "active",
      ),
      hiddenArchivedProjectCount:
        nextSortedProjects.length - nextActiveProjects.length,
      hiddenArchivedEnvironmentCount:
        nextSortedEnvironments.length - nextActiveEnvironments.length,
    };
  }, [environments, locale, projects, providerConnections, virtualKeys]);
  const canCreateVirtualKey = activeProviderConnections.length > 0 && !isCreatePending;
  const canSubmitVirtualKey =
    canCreateVirtualKey && Boolean(label.trim());

  useEffect(() => {
    if (!providerConnectionId) {
      return;
    }

    if (activeProviderConnections.some((provider) => provider.id === providerConnectionId)) {
      return;
    }

    setProviderConnectionId(activeProviderConnections.length === 1 ? activeProviderConnections[0].id : "");
  }, [activeProviderConnections, providerConnectionId]);

  const availableEnvironments = useMemo(
    () => filterEnvironmentsForProject(activeEnvironments, projectId || null),
    [activeEnvironments, projectId],
  );
  const ownerOptions = useMemo(
    () =>
      buildSuggestionOptions(
        locale,
        [...virtualKeys.map((virtualKey) => virtualKey.owner), owner],
        ["admin@example.com", "alice@example.com"],
      ),
    [locale, owner, virtualKeys],
  );
  const teamOptions = useMemo(
    () =>
      buildSuggestionOptions(
        locale,
        [...virtualKeys.map((virtualKey) => virtualKey.team), team],
        ["engineering", "customer-success", "product"],
      ),
    [locale, team, virtualKeys],
  );
  const serviceOptions = useMemo(
    () =>
      buildSuggestionOptions(
        locale,
        [...virtualKeys.map((virtualKey) => virtualKey.service), service],
        ["support-agent", "core-api", "web-frontend"],
      ).map((option) => ({
        ...option,
        label: formatKnownServiceLabel(option.value, locale),
      })),
    [locale, service, virtualKeys],
  );
  const {
    bulkRevokeEligibleIds,
    bulkRotateEligibleIds,
    expiringSoonKeyCount,
    filteredVirtualKeys,
    prioritizedFilteredVirtualKeys,
    riskyDormantKeyCount,
    selectableVisibleVirtualKeys,
    visibleActiveKeys,
    visibleExpiringSoonKeys,
    wideAccessKeyCount,
  } = useMemo(() => {
    const sortedVirtualKeys = [...virtualKeys].sort((left, right) => {
      const leftRank =
        left.status === "active" ? (isExpired(left.expiresAt) ? 1 : 0) : 2;
      const rightRank =
        right.status === "active" ? (isExpired(right.expiresAt) ? 1 : 0) : 2;

      return (
        leftRank - rightRank ||
        Date.parse(right.lastUsedAt ?? right.createdAt) -
          Date.parse(left.lastUsedAt ?? left.createdAt) ||
        compareDisplayLabels(left.label, right.label, locale)
      );
    });

    const matchesVirtualKeySearch = (virtualKey: VirtualKey) => {
      if (!deferredSearchQuery) {
        return true;
      }

      const boundEnvironment = virtualKey.environmentId
        ? environmentsById[virtualKey.environmentId]
        : null;
      const boundProvider = virtualKey.providerConnectionId
        ? providerConnectionsById[virtualKey.providerConnectionId] ?? null
        : null;
      const providerLabel = boundProvider
        ? boundProvider.label
        : virtualKey.providerConnectionId
          ? tr("binding.boundProviderUnavailable")
          : tr("binding.providerBindingRequired");
      const providerDetail = boundProvider
        ? boundProvider.provider
        : virtualKey.providerConnectionId ?? tr("binding.unbound");
      const bindingDetail = boundEnvironment
        ? formatEnvironmentOptionLabel(boundEnvironment, locale)
        : virtualKey.environmentId
          ? `unknown environment ${virtualKey.environment}`
          : virtualKey.environment;

      return [
        virtualKey.label,
        virtualKey.owner ?? "",
        virtualKey.team ?? "",
        virtualKey.service ?? "",
        virtualKey.issuanceMode,
        virtualKey.keyPrefix,
        virtualKey.status,
        virtualKey.environment,
        virtualKey.scopes.join(" "),
        virtualKey.projectId
          ? projectNamesById[virtualKey.projectId] ?? ""
          : "workspace default",
        bindingDetail,
        providerLabel,
        providerDetail,
      ]
        .join(" ")
        .toLowerCase()
        .includes(deferredSearchQuery);
    };

    const searchScopedKeys = sortedVirtualKeys.filter(matchesVirtualKeySearch);
    let nextExpiringSoonKeyCount = 0;
    let nextWideAccessKeyCount = 0;
    let nextRiskyDormantKeyCount = 0;

    for (const virtualKey of searchScopedKeys) {
      const expired = isExpired(virtualKey.expiresAt);
      const activeUsable = virtualKey.status === "active" && !expired;

      if (activeUsable && isExpiringSoon(virtualKey.expiresAt)) {
        nextExpiringSoonKeyCount += 1;
      }

      if (
        activeUsable &&
        getVirtualKeyBindingFilterValue(virtualKey) === "workspace"
      ) {
        nextWideAccessKeyCount += 1;
      }

      if (isDormantWideAccess(virtualKey)) {
        nextRiskyDormantKeyCount += 1;
      }
    }

    const nextFilteredVirtualKeys = searchScopedKeys.filter((virtualKey) => {
      const expired = isExpired(virtualKey.expiresAt);
      const expiringSoon =
        virtualKey.status === "active" &&
        !expired &&
        isExpiringSoon(virtualKey.expiresAt);
      const binding = getVirtualKeyBindingFilterValue(virtualKey);

      if (statusFilter === "active" && (virtualKey.status !== "active" || expired)) {
        return false;
      }

      if (statusFilter === "expired" && !expired) {
        return false;
      }

      if (statusFilter === "revoked" && virtualKey.status !== "revoked") {
        return false;
      }

      if (statusFilter === "unused" && virtualKey.lastUsedAt) {
        return false;
      }

      if (statusFilter === "expiring_soon" && !expiringSoon) {
        return false;
      }

      if (bindingFilter !== "all" && binding !== bindingFilter) {
        return false;
      }

      if (issuanceFilter !== "all" && virtualKey.issuanceMode !== issuanceFilter) {
        return false;
      }

      if (riskFilter === "expiring_soon" && !expiringSoon) {
        return false;
      }

      if (riskFilter === "never_used" && Boolean(virtualKey.lastUsedAt)) {
        return false;
      }

      if (riskFilter === "dormant_wide_access" && !isDormantWideAccess(virtualKey)) {
        return false;
      }

      if (
        riskFilter === "workspace_wide_active" &&
        !(virtualKey.status === "active" && !expired && binding === "workspace")
      ) {
        return false;
      }

      return true;
    });

    const nextPrioritizedFilteredVirtualKeys = [...nextFilteredVirtualKeys].sort(
      (left, right) => {
        const leftRisk = getVirtualKeyRiskState(left, tr);
        const rightRisk = getVirtualKeyRiskState(right, tr);
        if (leftRisk.priority !== rightRisk.priority) {
          return leftRisk.priority - rightRisk.priority;
        }

        const leftSelected = selectedVirtualKeyIdSet.has(left.id) ? 1 : 0;
        const rightSelected = selectedVirtualKeyIdSet.has(right.id) ? 1 : 0;
        if (leftSelected !== rightSelected) {
          return rightSelected - leftSelected;
        }

        const leftUpdated = Date.parse(left.lastUsedAt ?? left.createdAt);
        const rightUpdated = Date.parse(right.lastUsedAt ?? right.createdAt);
        if (leftUpdated !== rightUpdated) {
          return rightUpdated - leftUpdated;
        }

        return compareDisplayLabels(left.label, right.label, locale);
      },
    );

    let nextVisibleActiveKeys = 0;
    let nextVisibleExpiringSoonKeys = 0;
    const nextSelectableVisibleVirtualKeys: VirtualKey[] = [];

    for (const virtualKey of nextFilteredVirtualKeys) {
      const expired = isExpired(virtualKey.expiresAt);
      if (virtualKey.status === "active" && !expired) {
        nextVisibleActiveKeys += 1;

        if (isExpiringSoon(virtualKey.expiresAt)) {
          nextVisibleExpiringSoonKeys += 1;
        }
      }

      if (virtualKey.status !== "revoked") {
        nextSelectableVisibleVirtualKeys.push(virtualKey);
      }
    }

    const nextBulkRevokeEligibleIds = selectedVirtualKeyIds.filter((virtualKeyId) => {
      const virtualKey = virtualKeysById[virtualKeyId];
      return Boolean(virtualKey && virtualKey.status !== "revoked");
    });
    const nextBulkRotateEligibleIds = selectedVirtualKeyIds.filter((virtualKeyId) => {
      const virtualKey = virtualKeysById[virtualKeyId];
      return Boolean(
        virtualKey &&
          virtualKey.status === "active" &&
          !isExpired(virtualKey.expiresAt),
      );
    });

    return {
      filteredVirtualKeys: nextFilteredVirtualKeys,
      prioritizedFilteredVirtualKeys: nextPrioritizedFilteredVirtualKeys,
      visibleActiveKeys: nextVisibleActiveKeys,
      visibleExpiringSoonKeys: nextVisibleExpiringSoonKeys,
      expiringSoonKeyCount: nextExpiringSoonKeyCount,
      wideAccessKeyCount: nextWideAccessKeyCount,
      riskyDormantKeyCount: nextRiskyDormantKeyCount,
      selectableVisibleVirtualKeys: nextSelectableVisibleVirtualKeys,
      bulkRevokeEligibleIds: nextBulkRevokeEligibleIds,
      bulkRotateEligibleIds: nextBulkRotateEligibleIds,
    };
  }, [
    bindingFilter,
    deferredSearchQuery,
    environmentsById,
    issuanceFilter,
    locale,
    projectNamesById,
    providerConnectionsById,
    riskFilter,
    selectedVirtualKeyIdSet,
    selectedVirtualKeyIds,
    statusFilter,
    virtualKeys,
    virtualKeysById,
  ]);
  const hasInventoryFilters =
    Boolean(searchQuery.trim()) ||
    statusFilter !== "all" ||
    bindingFilter !== "all" ||
    riskFilter !== "all" ||
    issuanceFilter !== "all";
  const pageStart = totalVirtualKeys === 0 || virtualKeys.length === 0 ? 0 : pageOffset + 1;
  const pageEnd = totalVirtualKeys === 0 || virtualKeys.length === 0 ? 0 : pageOffset + virtualKeys.length;
  const hasPreviousPage = pageOffset > 0;
  const hasNextPage = pageOffset + virtualKeys.length < totalVirtualKeys;
  const keyPriorityLane =
    activeProviderConnections.length === 0 ? "missing-provider"
    : expiringSoonKeyCount > 0 ? "expiry"
    : riskyDormantKeyCount > 0 ? "cleanup"
    : wideAccessKeyCount > 0 ? "scope"
    : inventorySummary.active === 0 ? "issue"
    : "healthy";
  const hasSelectedVirtualKeys = selectedVirtualKeyIds.length > 0;
  const hasEmptyInventory = inventorySummary.total === 0;
  const keyAuditTrailHref = buildContextualHref(
    `/audit-logs?workspaceId=${encodeURIComponent(workspaceId)}&subjectType=virtual-key`,
    currentPageHref,
  );
  const keyExportTrailHref = buildContextualHref(
    `/exports?workspaceId=${encodeURIComponent(workspaceId)}&kind=audit-logs`,
    currentPageHref,
  );
  const selectedVirtualKeyCount = selectedVirtualKeyIds.length;
  const bulkActionTitle = hasSelectedVirtualKeys
    ? tr("{selected} selected", { selected: formatInteger(selectedVirtualKeyCount) })
    : tr("Selection and bulk actions");
  const bulkActionDetail = hasSelectedVirtualKeys
    ? tr("{rotatable} rotatable · {revocable} revocable", { rotatable: formatInteger(bulkRotateEligibleIds.length), revocable: formatInteger(bulkRevokeEligibleIds.length) })
    : tr("Select rows to keep bulk actions close to the table.");
  const pageWindowLabel = tr("Page window: {start}-{end} of {total}", { start: formatInteger(pageStart), end: formatInteger(pageEnd), total: formatInteger(inventorySummary.total) });
  const presentedVirtualKeys = useMemo<VirtualKeyRowModel[]>(
    () =>
      prioritizedFilteredVirtualKeys.map((virtualKey) => {
        const boundEnvironment = virtualKey.environmentId ? environmentsById[virtualKey.environmentId] : null;
        const bindingLabel = virtualKey.projectId
          ? projectNamesById[virtualKey.projectId] ?? tr("binding.unknownProject")
          : tr("Workspace default");
        const bindingDetail = boundEnvironment
          ? formatEnvironmentOptionLabel(boundEnvironment, locale)
          : virtualKey.environmentId
            ? tr("binding.unknownEnvironment", {
                runtime: getLocalizedRuntimeLabel(tr, virtualKey.environment),
              })
            : getLocalizedRuntimeLabel(tr, virtualKey.environment);
        const bindingDisplay =
          boundEnvironment && bindingDetail !== bindingLabel
            ? `${bindingLabel} · ${bindingDetail}`
            : bindingLabel;
        const bindingMeta = !virtualKey.providerConnectionId
          ? tr("binding.providerBindingRequired")
          : virtualKey.environmentId && !boundEnvironment
            ? bindingDetail
            : null;
        const expired = isExpired(virtualKey.expiresAt);
        const expiringSoon = !expired && isExpiringSoon(virtualKey.expiresAt);
        const daysUntilExpiry = getDaysUntil(virtualKey.expiresAt);
        const riskState = getVirtualKeyRiskState(virtualKey, tr);
        const usageHref = buildContextualHref(
          `/usage-events?workspaceId=${encodeURIComponent(workspaceId)}&virtualKeyId=${encodeURIComponent(virtualKey.id)}`,
          currentPageHref,
        );
        const auditHref = buildContextualHref(
          `/audit-logs?workspaceId=${encodeURIComponent(workspaceId)}&subjectType=virtual-key&subjectId=${encodeURIComponent(virtualKey.id)}`,
          currentPageHref,
        );
        const trailHref = virtualKey.status === "active" && !expired ? usageHref : auditHref;
        const trailLabel = virtualKey.status === "active" && !expired ? tr("Usage") : tr("Audit");

        return {
          auditHref,
          bindingDisplay,
          bindingMeta,
          daysUntilExpiry,
          expired,
          expiringSoon,
          riskState,
          trailHref,
          trailLabel,
          virtualKey,
        };
      }),
    [
      currentPageHref,
      environmentsById,
      locale,
      prioritizedFilteredVirtualKeys,
      projectNamesById,
      tr,
      workspaceId,
    ],
  );

  const selectedIssuancePreset = useMemo(
    () => getIssuancePresetById(selectedPresetId),
    [selectedPresetId],
  );

  function resetCreateForm(options?: ResetCreateFormOptions) {
    const preserveSticky = options?.preserveSticky ?? true;
    const nextPreset = getIssuancePresetById(selectedPresetId);

    if (!preserveSticky) {
      setProviderConnectionId("");
      setOwner("");
      setTeam("");
      setService("");
      setProjectId("");
      setEnvironmentId("");
      setSelectedPresetId("service-bot");
      setWorkloadType("service");
    }

    setLabel("");
    setScopesInput(nextPreset.scopes.join(", "));
    setExpiresAtInput(
      nextPreset.expiresInDays === null ? "" : getFutureDateTimeInputValue(nextPreset.expiresInDays),
    );

    if (!preserveSticky || !environmentId) {
      setEnvironmentRuntime(nextPreset.environmentRuntime);
    }
  }

  function seedCreateFormFromPreset() {
    const nextPreset = getIssuancePresetById(selectedPresetId);

    if (!scopesInput) {
      setScopesInput(nextPreset.scopes.join(", "));
    }

    if (!expiresAtInput && nextPreset.expiresInDays !== null) {
      setExpiresAtInput(getFutureDateTimeInputValue(nextPreset.expiresInDays));
    }

    if (!environmentId) {
      setEnvironmentRuntime(nextPreset.environmentRuntime);
    }
  }

  function handleCreateDialogOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      setCreateFlowState(initialCreateState);
      setBulkRotateState(null);
      seedCreateFormFromPreset();
      setIsCreateOpen(true);
      return;
    }

    const shouldRefresh = createFlowState.status === "success";
    setIsCreateOpen(false);
    setCreateFlowState(initialCreateState);
    setIsCreatePending(false);
    resetCreateForm({ preserveSticky: true });

    if (shouldRefresh) {
      router.refresh();
    }
  }

  function openCreateDialog() {
    setCreateFlowState(initialCreateState);
    setBulkRotateState(null);
    seedCreateFormFromPreset();
    setIsCreateOpen(true);
  }

  function applyIssuancePreset(preset: IssuancePreset) {
    setSelectedPresetId(preset.id);
    setScopesInput(preset.scopes.join(", "));
    setEnvironmentRuntime(preset.environmentRuntime);
    setExpiresAtInput(preset.expiresInDays === null ? "" : getFutureDateTimeInputValue(preset.expiresInDays));
    setCreateFlowState(initialCreateState);
    setBulkRotateState(null);
    setRevokeMessage(null);
  }

  function handleWorkloadTypeChange(nextType: WorkloadType) {
    setWorkloadType(nextType);

    if (!service.trim()) {
      setService(nextType === "shared" ? "workspace-shared-tool" : "");
    }
  }

  function handleProjectChange(nextProjectId: string) {
    setProjectId(nextProjectId);

    if (!environmentId) {
      return;
    }

    const selectedEnvironment = environmentsById[environmentId];
    if (!selectedEnvironment || (nextProjectId && selectedEnvironment.projectId !== nextProjectId)) {
      setEnvironmentId("");
    }
  }

  function handleEnvironmentChange(nextEnvironmentId: string) {
    setEnvironmentId(nextEnvironmentId);

    if (!nextEnvironmentId) {
      return;
    }

    const selectedEnvironment = environmentsById[nextEnvironmentId];
    if (selectedEnvironment) {
      setProjectId(selectedEnvironment.projectId);
      setEnvironmentRuntime(selectedEnvironment.runtime);
    }
  }

  function handleLabelChange(event: ChangeEvent<HTMLInputElement>) {
    setLabel(event.currentTarget.value);
  }

  function handleScopesChange(event: ChangeEvent<HTMLInputElement>) {
    setScopesInput(event.currentTarget.value);
  }

  function handleExpiresAtChange(event: ChangeEvent<HTMLInputElement>) {
    setExpiresAtInput(event.currentTarget.value);
  }

  function handleSearchChange(event: ChangeEvent<HTMLInputElement>) {
    setSearchQuery(event.currentTarget.value);
  }

  function handleStatusFilterChange(event: ChangeEvent<HTMLSelectElement>) {
    setStatusFilter(event.currentTarget.value as VirtualKeyStatusFilter);
  }

  function handleBindingFilterChange(event: ChangeEvent<HTMLSelectElement>) {
    setBindingFilter(event.currentTarget.value as VirtualKeyBindingFilter);
  }

  function handleRiskFilterChange(event: ChangeEvent<HTMLSelectElement>) {
    setRiskFilter(event.currentTarget.value as VirtualKeyRiskFilter);
  }

  function handleIssuanceFilterChange(event: ChangeEvent<HTMLSelectElement>) {
    setIssuanceFilter(event.currentTarget.value as VirtualKeyIssuanceFilter);
  }

  function handleScopeSuggestionToggle(scope: string) {
    const currentScopes = parseScopes(scopesInput);
    const nextScopes =
      currentScopes.includes(scope) ? currentScopes.filter((item) => item !== scope) : [...currentScopes, scope];
    setScopesInput(nextScopes.join(", "));
  }

  function resetInventoryFilters() {
    setSearchQuery("");
    setStatusFilter("all");
    setBindingFilter("all");
    setRiskFilter("all");
    setIssuanceFilter("all");
  }

  function focusGovernanceSearch(value: string) {
    setSearchQuery(value);
    setStatusFilter("all");
    setBindingFilter("all");
    setRiskFilter("all");
    setIssuanceFilter("all");
  }

  function handleInlinePivot(value: string | null) {
    if (!value?.trim()) {
      return;
    }

    focusGovernanceSearch(value.trim());
  }

  function handleCreateSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRevokeMessage(null);
    setBulkRotateState(null);
    setIsCreatePending(true);
    setCreateFlowState(initialCreateState);

    startTransition(async () => {
      const result = await createVirtualKeyAction({
        workspaceId,
        providerConnectionId: providerConnectionId || null,
        label,
        owner: owner || null,
        team: team || null,
        service: service || null,
        projectId: projectId || null,
        environmentId: environmentId || null,
        environment: environmentRuntime,
        scopes: parseScopes(scopesInput),
        expiresAt: expiresAtInput ? new Date(expiresAtInput).toISOString() : null,
      });

      if (result.message === null) {
        setCreateFlowState(result);
      } else {
        setCreateFlowState({
          ...result,
          message: getLocalizedActionMessage(tr, formatInteger, result.message) ?? result.message,
        });
      }
      setIsCreatePending(false);

      if (result.status !== "success") {
        return;
      }

      const { token: _, ...createdVirtualKey } = result.created;
      setVirtualKeys((currentKeys) => [
        createdVirtualKey,
        ...currentKeys.filter((virtualKey) => virtualKey.id !== createdVirtualKey.id),
      ]);
      setInventorySummary((currentSummary) => ({
        total: currentSummary.total + 1,
        active: currentSummary.active + (isExpired(createdVirtualKey.expiresAt) ? 0 : 1),
        revoked: currentSummary.revoked,
        expired: currentSummary.expired + (isExpired(createdVirtualKey.expiresAt) ? 1 : 0),
        neverUsed: currentSummary.neverUsed + 1,
        environmentBound: currentSummary.environmentBound + (createdVirtualKey.environmentId ? 1 : 0),
      }));
      resetCreateForm();
    });
  }

  function handleRevoke(virtualKeyId: string) {
    setCreateState(initialCreateState);
    setBulkRotateState(null);
    setRevokeMessage(null);
    setRevokePendingId(virtualKeyId);

    startTransition(async () => {
      const result = await revokeVirtualKeyAction(virtualKeyId);
      setRevokePendingId(null);
      setRevokeMessage(getLocalizedActionMessage(tr, formatInteger, result.message));

      if (result.status !== "success") {
        return;
      }

      const previousVirtualKey = virtualKeys.find((virtualKey) => virtualKey.id === result.virtualKey.id) ?? null;
      setVirtualKeys((currentKeys) =>
        currentKeys.map((virtualKey) => (virtualKey.id === result.virtualKey.id ? result.virtualKey : virtualKey)),
      );
      setInventorySummary((currentSummary) => {
        const shouldReduceActive = previousVirtualKey
          ? previousVirtualKey.status === "active" && !isExpired(previousVirtualKey.expiresAt)
          : false;

        return {
          total: currentSummary.total,
          active: currentSummary.active - (shouldReduceActive ? 1 : 0),
          revoked: currentSummary.revoked + (previousVirtualKey?.status === "revoked" ? 0 : 1),
          expired: currentSummary.expired,
          neverUsed: currentSummary.neverUsed,
          environmentBound: currentSummary.environmentBound,
        };
      });
      router.refresh();
    });
  }

  function handleRotate(virtualKeyId: string) {
    setRevokeMessage(null);
    setBulkRotateState(null);
    setRotatePendingId(virtualKeyId);

    startTransition(async () => {
      const result = await rotateVirtualKeyAction(virtualKeyId);
      setRotatePendingId(null);
      if (result.message === null) {
        setCreateState(result);
      } else {
        setCreateState({
          ...result,
          message: getLocalizedActionMessage(tr, formatInteger, result.message) ?? result.message,
        });
      }

      if (result.status !== "success") {
        return;
      }

      const { token: _, ...createdVirtualKey } = result.created;
      setVirtualKeys((currentKeys) => {
        const rotatedKeys = currentKeys.map((virtualKey) =>
          virtualKey.id === virtualKeyId ? { ...virtualKey, status: "revoked" as const } : virtualKey,
        );

        return [createdVirtualKey, ...rotatedKeys.filter((virtualKey) => virtualKey.id !== createdVirtualKey.id)];
      });
      setInventorySummary((currentSummary) => ({
        total: currentSummary.total + 1,
        active: currentSummary.active,
        revoked: currentSummary.revoked + 1,
        expired: currentSummary.expired,
        neverUsed: currentSummary.neverUsed + 1,
        environmentBound: currentSummary.environmentBound + (createdVirtualKey.environmentId ? 1 : 0),
      }));
    });
  }

  function handleSelectedVirtualKeyToggle(virtualKeyId: string) {
    setSelectedVirtualKeyIds((currentIds) =>
      currentIds.includes(virtualKeyId)
        ? currentIds.filter((currentId) => currentId !== virtualKeyId)
        : [...currentIds, virtualKeyId],
    );
  }

  function handleSelectVisibleVirtualKeys() {
    setSelectedVirtualKeyIds(selectableVisibleVirtualKeys.map((virtualKey) => virtualKey.id));
  }

  function handleClearSelectedVirtualKeys() {
    setSelectedVirtualKeyIds([]);
  }

  function handleBulkRevoke() {
    if (!bulkRevokeEligibleIds.length) {
      setRevokeMessage(tr("actions.bulkRevoke.selectEligible"));
      return;
    }

    setCreateState(initialCreateState);
    setBulkRotateState(null);
    setIsBulkRevokePending(true);
    setRevokeMessage(null);

    startTransition(async () => {
      const result = await bulkRevokeVirtualKeysAction(bulkRevokeEligibleIds);
      setIsBulkRevokePending(false);
      setRevokeMessage(
        getLocalizedActionMessage(
          tr,
          formatInteger,
          result.message,
          result.message === "actions.bulkRevoke.partial"
            ? {
                count: formatInteger(result.virtualKeys.length),
                failed: formatInteger(result.failedIds.length),
              }
            : result.message === "actions.bulkRevoke.success"
              ? {
                  count: formatInteger(result.virtualKeys.length),
                }
              : undefined,
        ),
      );

      if (!result.virtualKeys.length) {
        return;
      }

      const updatedIds = new Set(result.virtualKeys.map((virtualKey) => virtualKey.id));
      setVirtualKeys((currentKeys) =>
        currentKeys.map((virtualKey) => (updatedIds.has(virtualKey.id) ? result.virtualKeys.find((item) => item.id === virtualKey.id) ?? virtualKey : virtualKey)),
      );
      const newlyRevokedCount = result.virtualKeys.filter((virtualKey) => {
        const previousVirtualKey = virtualKeysById[virtualKey.id];
        return previousVirtualKey?.status !== "revoked";
      }).length;
      const reducedActiveCount = result.virtualKeys.filter((virtualKey) => {
        const previousVirtualKey = virtualKeysById[virtualKey.id];
        return Boolean(previousVirtualKey && previousVirtualKey.status === "active" && !isExpired(previousVirtualKey.expiresAt));
      }).length;
      setInventorySummary((currentSummary) => ({
        ...currentSummary,
        active: Math.max(0, currentSummary.active - reducedActiveCount),
        revoked: currentSummary.revoked + newlyRevokedCount,
      }));
      setSelectedVirtualKeyIds(result.failedIds);
      router.refresh();
    });
  }

  function handleBulkRotate() {
    if (!bulkRotateEligibleIds.length) {
      setRevokeMessage(tr("actions.bulkRotate.selectEligible"));
      return;
    }

    setCreateState(initialCreateState);
    setBulkRotateState(null);
    setIsBulkRotatePending(true);
    setRevokeMessage(null);

    startTransition(async () => {
      const result = await bulkRotateVirtualKeysAction(bulkRotateEligibleIds);
      setIsBulkRotatePending(false);
      const localizedMessage = getLocalizedActionMessage(
        tr,
        formatInteger,
        result.message,
        result.message === "actions.bulkRotate.partial"
          ? {
              count: formatInteger(result.rotated.length),
              failed: formatInteger(result.failedIds.length),
            }
          : result.message === "actions.bulkRotate.success"
            ? {
                count: formatInteger(result.rotated.length),
              }
            : undefined,
      );
      setBulkRotateState({
        ...result,
        message: localizedMessage ?? result.message,
      });
      setRevokeMessage(result.rotated.length ? null : localizedMessage);

      if (!result.rotated.length) {
        return;
      }

      const rotatedIds = new Set(result.rotated.map((entry) => entry.previousId));
      const createdRecords = result.rotated.map((entry) => {
        const { token: _, ...createdVirtualKey } = entry.created;
        return createdVirtualKey;
      });

      setVirtualKeys((currentKeys) => {
        const revokedKeys = currentKeys.map((virtualKey) =>
          rotatedIds.has(virtualKey.id) ? { ...virtualKey, status: "revoked" as const } : virtualKey,
        );

        return [...createdRecords, ...revokedKeys.filter((virtualKey) => !createdRecords.some((created) => created.id === virtualKey.id))];
      });
      setInventorySummary((currentSummary) => ({
        total: currentSummary.total + createdRecords.length,
        active: currentSummary.active,
        revoked: currentSummary.revoked + createdRecords.length,
        expired: currentSummary.expired,
        neverUsed: currentSummary.neverUsed + createdRecords.length,
        environmentBound:
          currentSummary.environmentBound + createdRecords.filter((virtualKey) => Boolean(virtualKey.environmentId)).length,
      }));
      setSelectedVirtualKeyIds(result.failedIds);
    });
  }

  function handleDismissTokenReveal() {
    setCreateState(initialCreateState);
    setBulkRotateState(null);
  }

  function handleIssueAnother() {
    setCreateFlowState(initialCreateState);
    setBulkRotateState(null);
    setRevokeMessage(null);
    resetCreateForm({ preserveSticky: true });
  }

  const selectedProvider = activeProviderConnections.find((provider) => provider.id === providerConnectionId) ?? null;
  const selectedProject = activeProjects.find((project) => project.id === projectId) ?? null;
  const selectedEnvironment = environmentId ? environmentsById[environmentId] ?? null : null;
  const presetSummaryLabel = tr(selectedIssuancePreset.titleKey);
  const presetSummaryDetail = tr(selectedIssuancePreset.summaryKey);
  const labelPlaceholder = getVirtualKeyLabelPlaceholder(selectedPresetId, workloadType);
  const accessLaneHref = buildContextualHref(
    `/access?workspaceId=${encodeURIComponent(workspaceId)}`,
    currentPageHref,
  );
  const membersLaneHref = buildContextualHref(
    `/members?workspaceId=${encodeURIComponent(workspaceId)}`,
    currentPageHref,
  );
  const expiresSummaryLabel = expiresAtInput
    ? formatDateTime(new Date(expiresAtInput).toISOString())
    : tr("No expiry");
  const bindingSummaryLabel = selectedEnvironment
    ? formatEnvironmentOptionLabel(selectedEnvironment, locale)
    : selectedProject
      ? formatProjectOptionLabel(selectedProject, locale)
      : tr("Workspace-wide access");
  const targetSummaryLabel =
    owner ||
    [team, service].filter(Boolean).join(" / ") ||
    tr("Unassigned owner");

  const createFlowReveal =
    createFlowState.status === "success" ? (
      <ResourceInlineNotice
        tone="success"
        message={createFlowState.message}
        detail={
          <div className="mt-4 space-y-4 rounded-xl border border-success-border/30 bg-success-soft/10 p-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <span className="text-[10px] font-bold uppercase tracking-widest text-success-strong/70">{tr("Token")}</span>
                <div className="flex items-center gap-2">
                  <code className="relative rounded bg-success-soft/20 px-[0.3rem] py-[0.2rem] font-mono text-sm font-semibold text-success-strong break-all">
                    {createFlowState.created.token}
                  </code>
                  <CopyButton className="h-8 text-success-strong" label={tr("Copy token")} value={createFlowState.created.token} />
                </div>
              </div>
              <div className="space-y-1.5">
                <span className="text-[10px] font-bold uppercase tracking-widest text-success-strong/70">{tr("Prefix")}</span>
                <div className="flex items-center gap-2">
                  <code className="relative rounded bg-success-soft/20 px-[0.3rem] py-[0.2rem] font-mono text-sm font-semibold text-success-strong">
                    {getLocalizedKeyPrefixLabel(locale, tr, createFlowState.created.keyPrefix)}
                  </code>
                  <CopyButton className="h-8 text-success-strong" label={tr("Copy prefix")} value={createFlowState.created.keyPrefix} />
                </div>
              </div>
            </div>
          </div>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={handleIssueAnother} size="sm" variant="secondary">
              {tr("Issue another")}
            </Button>
            <Button onClick={() => handleCreateDialogOpenChange(false)} size="sm" variant="ghost" className="text-success-strong hover:bg-success-soft/20">
              {tr("Done")}
            </Button>
          </div>
        }
      />
    ) : null;

  const issuancePanelBody = createFlowReveal ?? (
    <div className="flex flex-col gap-6">
      {!activeProviderConnections.length && (
        <div className="notice notice--error">
          <p>{tr("issuance.noProviders")}</p>
          <a
            className="button button--ghost"
            href={buildContextualHref(
              `/providers?workspaceId=${encodeURIComponent(workspaceId)}`,
              currentPageHref,
            )}
          >
            {tr("Open provider connections")}
          </a>
        </div>
      )}

      {createFlowState.status === "error" && createFlowState.message && (
        <div className="notice notice--error">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <p className="min-w-0 flex-1">{createFlowState.message}</p>
            <Button onClick={() => handleCreateDialogOpenChange(false)} size="sm" type="button" variant="ghost">
              {tr("Close")}
            </Button>
          </div>
        </div>
      )}

      <form className="flex flex-col gap-6" id="virtual-key-create-form" onSubmit={handleCreateSubmit}>
        <div className="rounded-xl border border-border/50 bg-muted/20 p-4">
          <div className="flex flex-col gap-4">
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">
                {locale === "zh" ? "主体类型" : "Credential subject"}
              </p>
              <p className="text-xs text-muted-foreground">
                {locale === "zh"
                  ? "本轮管理员发放只面向服务或共享工作负载，不作为个人开发密钥入口。"
                  : "Admin issuance in this flow is for service or shared workloads, not personal developer keys."}
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                {
                  value: "service" as const,
                  title: locale === "zh" ? "服务凭据" : "Service credential",
                  summary: locale === "zh" ? "用于 bot、CI、自动化、后台服务。" : "For bots, CI, automation, and backend services.",
                },
                {
                  value: "shared" as const,
                  title: locale === "zh" ? "共享凭据" : "Shared credential",
                  summary: locale === "zh" ? "用于团队共用工具或共享运行位。" : "For shared tools or team-wide runtime lanes.",
                },
              ].map((option) => {
                const selected = workloadType === option.value;

                return (
                  <button
                    key={option.value}
                    onClick={() => handleWorkloadTypeChange(option.value)}
                    type="button"
                    className={cn(
                      "rounded-xl border px-4 py-3 text-left transition-all",
                      selected
                        ? "border-foreground bg-background shadow-sm"
                        : "border-border/60 bg-background/60 hover:border-foreground/30",
                    )}
                  >
                    <p className="text-sm font-semibold text-foreground">{option.title}</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{option.summary}</p>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between rounded-xl border bg-muted/20 p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-amber-500/10 p-2 text-amber-600">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-medium">{locale === "zh" ? "工作负载预设" : "Workload presets"}</p>
              <p className="text-xs text-muted-foreground">
                {locale === "zh" ? "快速带入服务或共享凭据的常见配置。" : "Quickly apply standard configurations for service or shared credentials."}
              </p>
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2 bg-background">
                {tr("Apply preset")}
                <ChevronDown className="h-3.5 w-3.5 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              {issuancePresets.map((preset) => (
                <DropdownMenuItem
                  key={preset.id}
                  onClick={() => applyIssuancePreset(preset)}
                  className="flex flex-col items-start gap-1 py-2"
                >
                  <span className="font-medium text-sm">{tr(preset.titleKey)}</span>
                  <span className="text-xs text-muted-foreground">{tr(preset.summaryKey)}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="space-y-6">
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium leading-none" htmlFor="vk-provider">
                {locale === "zh" ? "路由偏好（可选）" : "Routing preference (optional)"}
              </label>
              <Select
                onValueChange={(value) => setProviderConnectionId(value === emptySelectValue ? "" : value)}
                value={providerConnectionId || emptySelectValue}
              >
                <SelectTrigger id="vk-provider" className="h-11">
                  <SelectValue placeholder={locale === "zh" ? "工作区统一路由" : "Workspace unified routing"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={emptySelectValue}>
                    {locale === "zh" ? "工作区统一路由" : "Workspace unified routing"}
                  </SelectItem>
                  {activeProviderConnections.map((provider) => (
                    <SelectItem key={provider.id} value={provider.id}>
                      <span className="font-medium">{provider.label}</span>
                      <span className="ml-2 text-xs text-muted-foreground opacity-70">({provider.provider})</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <label className="text-sm font-medium leading-none" htmlFor="vk-service-core">
                  {workloadType === "service"
                    ? tr("Service")
                    : locale === "zh"
                      ? "共享标识"
                      : "Shared label"}
                </label>
                <Select onValueChange={(v) => setService(v === emptySelectValue ? "" : v)} value={service || emptySelectValue}>
                  <SelectTrigger id="vk-service-core" className="h-11 bg-background">
                    <SelectValue placeholder={workloadType === "service" ? tr("Service") : locale === "zh" ? "共享标识" : "Shared label"} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={emptySelectValue}>
                      {workloadType === "service"
                        ? locale === "zh" ? "未设置服务" : "No service"
                        : locale === "zh" ? "未设置共享标识" : "No shared label"}
                    </SelectItem>
                    {serviceOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  {locale === "zh"
                    ? "把它当作这把凭据的主工作负载标识。"
                    : "Use this as the primary workload label for the issued credential."}
                </p>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium leading-none" htmlFor="vk-project">
                  {tr("Project")}
                </label>
                <Select
                  onValueChange={(value) => handleProjectChange(value === emptySelectValue ? "" : value)}
                  value={projectId || emptySelectValue}
                >
                  <SelectTrigger id="vk-project" className="h-11">
                    <SelectValue placeholder={tr("Workspace-wide access")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={emptySelectValue}>{tr("Workspace-wide access")}</SelectItem>
                    {activeProjects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {formatProjectOptionLabel(project, locale)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium leading-none" htmlFor="vk-environment">
                  {tr("Environment")}
                </label>
                <Select
                  onValueChange={(value) => handleEnvironmentChange(value === emptySelectValue ? "" : value)}
                  value={environmentId || emptySelectValue}
                >
                  <SelectTrigger id="vk-environment" className="h-11">
                    <SelectValue placeholder={tr("No environment binding")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={emptySelectValue}>{tr("No environment binding")}</SelectItem>
                    {availableEnvironments.map((environment) => (
                      <SelectItem key={environment.id} value={environment.id}>
                        {formatEnvironmentOptionLabel(environment, locale)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium leading-none" htmlFor="vk-label">
                {tr("Label")}
              </label>
              <Input
                id="vk-label"
                name="label"
                onChange={handleLabelChange}
                placeholder={labelPlaceholder}
                required
                value={label}
                className="h-11"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium leading-none" htmlFor="vk-expires">
                {tr("Expires at")}
              </label>
              <div className="relative">
                <Input
                  id="vk-expires"
                  name="expiresAt"
                  onChange={handleExpiresAtChange}
                  type="datetime-local"
                  value={expiresAtInput}
                  className="h-11"
                />
                <p className="mt-1.5 text-[11px] text-muted-foreground">{expiresSummaryLabel}</p>
              </div>
            </div>
          </div>
        </div>

        <Collapsible className="rounded-xl border border-border/50 bg-muted/30 transition-all">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="group flex w-full items-center justify-between px-4 py-6 hover:bg-transparent">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-blue-500/10 p-2 text-blue-600">
                  <Users className="h-4 w-4" />
                </div>
                <div className="text-left">
                  <p className="text-sm font-semibold">{locale === "zh" ? "责任归属" : "Responsibility & ownership"}</p>
                  <p className="text-xs text-muted-foreground">
                    {locale === "zh" ? "负责人和团队标签只用于审计、检索与分摊，不表示个人领取主体。" : "Owner and team labels are for audit, search, and chargeback, not the personal recipient."}
                  </p>
                </div>
              </div>
              <ChevronDown className="h-4 w-4 opacity-50 transition-transform duration-200 group-data-[state=open]:rotate-180" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="px-4 pb-6 pt-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/70" htmlFor="vk-owner">
                  {locale === "zh" ? "负责人标签" : "Owner label"}
                </label>
                <Select onValueChange={(v) => setOwner(v === emptySelectValue ? "" : v)} value={owner || emptySelectValue}>
                  <SelectTrigger id="vk-owner" className="h-10 bg-background"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={emptySelectValue}>{tr("Unassigned owner")}</SelectItem>
                    {ownerOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/70" htmlFor="vk-team">
                  {tr("Team")}
                </label>
                <Select onValueChange={(v) => setTeam(v === emptySelectValue ? "" : v)} value={team || emptySelectValue}>
                  <SelectTrigger id="vk-team" className="h-10 bg-background"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={emptySelectValue}>{locale === "zh" ? "未设置团队" : "No team"}</SelectItem>
                    {teamOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Advanced (Collapsible) */}
        <Collapsible className="rounded-xl border border-border/50 bg-muted/30 transition-all">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="group flex w-full items-center justify-between px-4 py-6 hover:bg-transparent">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-indigo-500/10 p-2 text-indigo-600">
                  <Settings2 className="h-4 w-4" />
                </div>
                <div className="text-left">
                  <p className="text-sm font-semibold">
                    {locale === "zh" ? "高级配置" : "Advanced configuration"}
                  </p>
                  <p className="text-xs text-muted-foreground">{locale === "zh" ? "配置网关权限限制与运行时" : "Gateway scopes and runtime."}</p>
                </div>
              </div>
              <ChevronDown className="h-4 w-4 opacity-50 transition-transform duration-200 group-data-[state=open]:rotate-180" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="px-4 pb-6 pt-2 space-y-6">
            <div className="space-y-2">
              <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/70">
                {tr("Runtime")}
              </label>
              <Select
                disabled={Boolean(environmentId)}
                onValueChange={(v) => setEnvironmentRuntime(v as "development" | "staging" | "production")}
                value={environmentRuntime}
              >
                <SelectTrigger className="h-10 bg-background"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="development">{getLocalizedRuntimeLabel(tr, "development")}</SelectItem>
                  <SelectItem value="staging">{getLocalizedRuntimeLabel(tr, "staging")}</SelectItem>
                  <SelectItem value="production">{getLocalizedRuntimeLabel(tr, "production")}</SelectItem>
                </SelectContent>
              </Select>
              {environmentId && <p className="text-[11px] text-muted-foreground/70">{tr("Runtime follows the selected environment.")}</p>}
            </div>

            <div className="space-y-3">
              <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/70">
                {tr("Scopes")}
              </label>
              <Input
                onChange={handleScopesChange}
                placeholder={tr("scopeInputPlaceholder")}
                value={scopesInput}
                className="h-10 bg-background"
              />
              <div className="flex flex-wrap gap-2 pt-1">
                {VirtualKeyGatewayScopeValues.map((scope) => {
                  const isSelected = parseScopes(scopesInput).includes(scope);
                  return (
                    <button
                      key={scope}
                      onClick={() => handleScopeSuggestionToggle(scope)}
                      title={scope}
                      type="button"
                      className={cn(
                        "px-3 py-1 rounded-full text-[11px] border transition-all",
                        isSelected 
                          ? "bg-primary border-primary text-primary-foreground shadow-sm" 
                          : "bg-background border-border text-muted-foreground hover:border-muted-foreground/40 hover:bg-muted/50"
                      )}
                    >
                      {getLocalizedScopeLabel(locale, scope)}
                    </button>
                  );
                })}
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

      </form>

      {Boolean(hiddenArchivedProjectCount || hiddenArchivedEnvironmentCount) && (
        <div className="notice text-center py-2 bg-transparent border-none shadow-none">
          <p className="text-[11px] text-muted-foreground">
            {tr("issuance.hiddenArchived", {
              projects: formatInteger(hiddenArchivedProjectCount),
              environments: formatInteger(hiddenArchivedEnvironmentCount),
            })}
          </p>
        </div>
      )}
    </div>
  );

  const tokenRevealContent = !isCreateOpen ? (
    <div className="space-y-4 mb-6">
      {createState.message && (
        <ResourceInlineNotice
          tone={createState.status === "error" ? "error" : "success"}
          message={createState.message}
          detail={
            createState.status === "success" && (
              <div className="mt-4 grid gap-4 sm:grid-cols-2 rounded-xl border border-success-border/30 bg-success-soft/10 p-4 text-success-strong">
                <div className="space-y-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-widest opacity-70">{tr("Token")}</span>
                  <div className="flex items-center gap-2">
                    <code className="relative rounded bg-success-soft/20 px-1.5 py-0.5 font-mono text-sm font-semibold break-all">
                      {createState.created.token}
                    </code>
                    <CopyButton className="h-8 text-current" label={tr("Copy token")} value={createState.created.token} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-widest opacity-70">{tr("Prefix")}</span>
                  <div className="flex items-center gap-2">
                    <code className="relative rounded bg-success-soft/20 px-1.5 py-0.5 font-mono text-sm font-semibold">
                      {getLocalizedKeyPrefixLabel(locale, tr, createState.created.keyPrefix)}
                    </code>
                    <CopyButton className="h-8 text-current" label={tr("Copy prefix")} value={createState.created.keyPrefix} />
                  </div>
                </div>
              </div>
            )
          }
          actions={
            <Button onClick={handleDismissTokenReveal} size="sm" variant="ghost" className={createState.status === "error" ? "text-destructive" : "text-success-strong"}>
              {tr("Dismiss")}
            </Button>
          }
        />
      )}

      {bulkRotateState?.rotated.length ? (
        <ResourceInlineNotice
          tone={bulkRotateState.status === "error" ? "error" : "success"}
          message={bulkRotateState.message}
          detail={
            <div className="mt-4 grid gap-3 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
              {bulkRotateState.rotated.map((entry) => (
                <div key={`bulk-rotate-${entry.previousId}`} className="flex flex-col gap-3 rounded-xl border border-border/50 bg-muted/20 p-4">
                  <div className="flex flex-col gap-2">
                    <span className="text-[11px] font-bold text-muted-foreground/80 tracking-tight">
                      {tr("issuance.newTokenFor", { label: entry.created.label })}
                    </span>
                    <div className="flex items-center gap-3">
                      <code className="flex-1 rounded bg-muted/50 px-2 py-1 font-mono text-sm break-all">
                        {entry.created.token}
                      </code>
                      <div className="flex items-center gap-1 shrink-0">
                        <CopyButton className="h-8" label={tr("Copy token")} value={entry.created.token} />
                        <CopyButton className="h-8" label={tr("Copy prefix")} value={entry.created.keyPrefix} />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          }
          actions={
            <Button onClick={handleDismissTokenReveal} size="sm" variant="ghost" className="text-success-strong">
              {tr("Dismiss")}
            </Button>
          }
        />
      ) : null}
    </div>
  ) : null;

  return (
    <>
      {tokenRevealContent}

      <section className="space-y-6" id="virtual-key-inventory">
        <CompactToolbar
          query={searchQuery}
          onQueryChange={(val) => handleSearchChange({ currentTarget: { value: val } } as any)}
          filterCount={[statusFilter !== "all", bindingFilter !== "all", riskFilter !== "all", issuanceFilter !== "all"].filter(Boolean).length}
          onResetFilters={resetInventoryFilters}
          placeholder={locale === "zh" ? "标签、负责人、团队、服务、前缀、发放模式" : "Label, owner, team, service, prefix, mode"}
          actions={
            <div className="flex items-center gap-2">
              <Button
                onClick={openCreateDialog}
                size="sm"
                type="button"
                className="rounded-full px-4 font-medium shadow-none"
              >
                <Plus className="mr-1.5 size-4" />
                {locale === "zh" ? "发放工作负载密钥" : "Issue workload key"}
              </Button>
              {capabilities.canSelfServeVirtualKeys ? (
                <Button asChild size="sm" variant="ghost" className="rounded-full">
                  <a href={accessLaneHref}>
                    <SquareTerminal className="mr-1.5 size-4" />
                    Access
                  </a>
                </Button>
              ) : null}
              {capabilities.canManageMembers ? (
                <Button asChild size="sm" variant="ghost" className="rounded-full">
                  <a href={membersLaneHref}>
                    {locale === "zh" ? "成员范围" : "Member scope"}
                  </a>
                </Button>
              ) : null}
            </div>
          }
        >
          <FilterField label={tr("Status")}>
            <select
              value={statusFilter}
              onChange={(e) => handleStatusFilterChange(e as any)}
              className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm"
            >
              <option value="all">{tr("All statuses")}</option>
              <option value="active">{tr("Active and usable")}</option>
              <option value="expired">{tr("Expired")}</option>
              <option value="revoked">{tr("Revoked")}</option>
              <option value="unused">{tr("Never used")}</option>
              <option value="expiring_soon">{tr("Expiring soon")}</option>
            </select>
          </FilterField>
          <FilterField label={tr("Binding")}>
            <select
              value={bindingFilter}
              onChange={(e) => handleBindingFilterChange(e as any)}
              className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm"
            >
              <option value="all">{tr("Any binding")}</option>
              <option value="workspace">{tr("Workspace default")}</option>
              <option value="project">{tr("Project scoped")}</option>
              <option value="environment">{tr("Environment bound")}</option>
            </select>
          </FilterField>
          <FilterField label={tr("Risk")}>
            <select
              value={riskFilter}
              onChange={(e) => handleRiskFilterChange(e as any)}
              className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm"
            >
              <option value="all">{tr("All keys")}</option>
              <option value="expiring_soon">{tr("Expiring soon")}</option>
              <option value="never_used">{tr("Never used")}</option>
              <option value="dormant_wide_access">{tr("Dormant wide access")}</option>
              <option value="workspace_wide_active">{tr("Workspace-wide active")}</option>
            </select>
          </FilterField>
          <FilterField label={locale === "zh" ? "发放模式" : "Issuance"}>
            <select
              value={issuanceFilter}
              onChange={(e) => handleIssuanceFilterChange(e as any)}
              className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm"
            >
              <option value="all">{locale === "zh" ? "全部模式" : "All modes"}</option>
              <option value="admin">{locale === "zh" ? "admin-issued" : "admin-issued"}</option>
              <option value="self_serve">{locale === "zh" ? "self-serve" : "self-serve"}</option>
            </select>
          </FilterField>
        </CompactToolbar>

        {revokeMessage ? (
          <div className="rounded-lg border border-border/45 bg-[color:color-mix(in_srgb,var(--surface-1)_96%,var(--surface-canvas)_4%)] px-3 py-2 text-sm text-muted-foreground">
            {revokeMessage}
          </div>
        ) : null}

        {hasSelectedVirtualKeys ? (
          <section
            aria-label={tr("Selection and bulk actions")}
            className="resource-table-selection-bar resource-table-selection-bar--active rounded-lg border px-4 py-2.5"
          >
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="space-y-1">
                <p className="resource-table-selection-bar__title text-sm font-medium text-foreground">{bulkActionTitle}</p>
                <p className="resource-table-selection-bar__detail text-sm text-muted-foreground">{bulkActionDetail}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  className="button button--ghost button--micro resource-table-selection-bar__quiet-action"
                  onClick={handleSelectVisibleVirtualKeys}
                  type="button"
                >
                  {tr("Select visible")}
                </button>
                <button
                  className="button button--ghost button--micro resource-table-selection-bar__quiet-action"
                  onClick={handleClearSelectedVirtualKeys}
                  type="button"
                >
                  {tr("Clear selection")}
                </button>
                <button
                  className={`button resource-table-selection-bar__bulk-action${isBulkRotatePending || !bulkRotateEligibleIds.length ? " button--disabled" : ""}`}
                  disabled={isBulkRotatePending || !bulkRotateEligibleIds.length}
                  onClick={handleBulkRotate}
                  type="button"
                >
                  {isBulkRotatePending ? tr("Rotating...") : tr("Bulk rotate")}
                </button>
                <ConfirmActionButton
                  className={`button button--danger${isBulkRevokePending || !bulkRevokeEligibleIds.length ? " button--disabled" : ""}`}
                  confirmDescription={tr("confirm.bulkRevoke.description")}
                  confirmLabel={tr("Bulk revoke")}
                  confirmTitle={tr("confirm.bulkRevoke.title", { count: formatInteger(bulkRevokeEligibleIds.length) })}
                  disabled={isBulkRevokePending || !bulkRevokeEligibleIds.length}
                  onConfirm={handleBulkRevoke}
                  pending={isBulkRevokePending}
                  pendingLabel={tr("Revoking...")}
                >
                  {tr("Bulk revoke")}
                </ConfirmActionButton>
              </div>
            </div>
          </section>
        ) : null}

          {hasEmptyInventory ? (
            <div className="rounded-lg border border-dashed border-border/60 bg-[color:color-mix(in_srgb,var(--surface-1)_96%,var(--surface-canvas)_4%)] px-4 py-5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-foreground">
                    {tr("No virtual keys in this scope")}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {activeProviderConnections.length ? tr("emptyState.issueFirstScoped") : tr("emptyState.connectProviderFirst")}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={openCreateDialog} type="button">
                    {activeProviderConnections.length ? tr("emptyState.issueKey") : tr("emptyState.openIssuance")}
                  </Button>
                  {!activeProviderConnections.length ? (
                    <a
                      className="button button--ghost"
                      href={buildContextualHref(`/providers?workspaceId=${encodeURIComponent(workspaceId)}`, currentPageHref)}
                    >
                      {tr("Providers")}
                    </a>
                  ) : null}
                </div>
              </div>
            </div>
          ) : filteredVirtualKeys.length ? (
            <>
              <div className="space-y-3 lg:hidden">
                {presentedVirtualKeys.map((rowModel) => {
                  const {
                    bindingDisplay,
                    bindingMeta,
                    daysUntilExpiry,
                    expired,
                    expiringSoon,
                    riskState,
                    trailHref: mobileViewHref,
                    trailLabel: mobileViewLabel,
                    virtualKey,
                  } = rowModel;

                  return (
                    <article
                      className="rounded-lg border border-border/45 bg-[color:color-mix(in_srgb,var(--surface-1)_92%,var(--surface-canvas)_8%)] p-3"
                      key={`mobile-${virtualKey.id}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <strong className="text-[14px] font-semibold tracking-tight text-foreground">
                              {virtualKey.label}
                            </strong>
                            <span className={getIssuanceModeTagClass(virtualKey.issuanceMode)}>
                              {getLocalizedIssuanceModeLabel(locale, virtualKey.issuanceMode)}
                            </span>
                            <span className={riskState.className}>{riskState.label}</span>
                            <span className={getStatusTagClass(virtualKey.status)}>
                              {getLocalizedStatusLabel(tr, virtualKey.status)}
                            </span>
                          </div>
                        </div>
                        {virtualKey.status !== "revoked" ? (
                          <input
                            checked={selectedVirtualKeyIdSet.has(virtualKey.id)}
                            onChange={() => handleSelectedVirtualKeyToggle(virtualKey.id)}
                            type="checkbox"
                          />
                        ) : null}
                      </div>

                      <div className="mt-3 grid gap-2 text-[12px] text-muted-foreground">
                        <p>
                          <span className="font-medium text-foreground">{locale === "zh" ? "负责人标签" : "Owner label"}：</span>{" "}
                          {virtualKey.owner ?? tr("Unassigned owner")}
                        </p>
                        <p>
                          <span className="font-medium text-foreground">{tr("Binding")}：</span>{" "}
                          {bindingDisplay}
                        </p>
                        {bindingMeta ? (
                          <p>
                            <span className="font-medium text-foreground">
                              {locale === "zh" ? "治理状态" : "Governance"}：
                            </span>{" "}
                            {bindingMeta}
                          </p>
                        ) : null}
                        <p>
                          <span className="font-medium text-foreground">{tr("Expires")}：</span>{" "}
                          {virtualKey.expiresAt
                            ? expiringSoon && daysUntilExpiry !== null
                              ? formatDaysLeftLabel(tr, daysUntilExpiry)
                              : new Intl.DateTimeFormat(getIntlLocale(locale), {
                                  dateStyle: "medium",
                                  timeStyle: "short",
                                }).format(new Date(virtualKey.expiresAt))
                            : tr("No expiry")}
                        </p>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        <a className="button button--ghost button--micro" href={mobileViewHref}>
                          {mobileViewLabel}
                        </a>
                        {virtualKey.status === "active" && !expired ? (
                          <button
                            className={`button button--ghost button--micro${rotatePendingId === virtualKey.id ? " button--disabled" : ""}`}
                            disabled={rotatePendingId === virtualKey.id}
                            onClick={() => handleRotate(virtualKey.id)}
                            type="button"
                          >
                            {rotatePendingId === virtualKey.id ? tr("Rotating...") : tr("Rotate")}
                          </button>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>

              <div className="table-wrap legacy-resource-table-wrap hidden lg:block">
                <table className="table legacy-resource-table">
                  <thead>
                    <tr>
                      <th className="w-[44px]">{tr("Select")}</th>
                      <th className="min-w-[220px]">{tr("Label")}</th>
                      <th className="min-w-[150px]">{locale === "zh" ? "责任归属" : "Ownership"}</th>
                      <th className="min-w-[140px]">{tr("Binding")}</th>
                      <th className="w-[110px]">{tr("Status")}</th>
                      <th className="min-w-[130px]">{tr("Expires")}</th>
                      <th className="min-w-[130px]">{tr("Last used")}</th>
                      <th className="min-w-[160px]">{tr("Actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {presentedVirtualKeys.map((rowModel) => {
                      const {
                        bindingDisplay,
                        bindingMeta,
                        daysUntilExpiry,
                        expired,
                        expiringSoon,
                        riskState,
                        trailHref,
                        trailLabel,
                        virtualKey,
                      } = rowModel;
                      const selected = selectedVirtualKeyIdSet.has(virtualKey.id);

                      return (
                        <tr className={selected ? "table-row-selected" : undefined} key={virtualKey.id}>
                          <td>
                            {virtualKey.status !== "revoked" ? (
                              <input
                                checked={selected}
                                onChange={() => handleSelectedVirtualKeyToggle(virtualKey.id)}
                                type="checkbox"
                              />
                            ) : null}
                          </td>
                          <td>
                            <div className="cell-stack">
                              <span>{virtualKey.label}</span>
                              <div className="badge-row">
                                <span className={getIssuanceModeTagClass(virtualKey.issuanceMode)}>
                                  {getLocalizedIssuanceModeLabel(locale, virtualKey.issuanceMode)}
                                </span>
                                <span className={riskState.className}>{riskState.label}</span>
                              </div>
                            </div>
                          </td>
                          <td>
                            <div className="cell-stack">
                              {virtualKey.owner ? (
                                <button className="inline-filter-link" onClick={() => handleInlinePivot(virtualKey.owner)} type="button">
                                  {virtualKey.owner}
                                </button>
                              ) : (
                                <span>{tr("Unassigned owner")}</span>
                              )}
                              <span className="meta">
                                {[virtualKey.team, virtualKey.service].filter(Boolean).join(" · ") || tr("No team or service")}
                              </span>
                            </div>
                          </td>
                          <td>
                            <div className="cell-stack">
                              {bindingDisplay !== tr("Workspace default") ? (
                                <button className="inline-filter-link" onClick={() => handleInlinePivot(bindingDisplay)} type="button">
                                  {bindingDisplay}
                                </button>
                              ) : (
                                <span>{bindingDisplay}</span>
                              )}
                              {bindingMeta ? <span className="meta">{bindingMeta}</span> : null}
                            </div>
                          </td>
                          <td>
                            <span className={getStatusTagClass(virtualKey.status)}>{getLocalizedStatusLabel(tr, virtualKey.status)}</span>
                            {expired ? <div className="meta">{tr("Expired")}</div> : null}
                          </td>
                          <td>
                            {virtualKey.expiresAt ? (
                              <div className="cell-stack">
                                <span>{formatDateTime(virtualKey.expiresAt)}</span>
                                <span className={`meta mono${expiringSoon ? " legacy-resource-table__meta--warning" : ""}`}>
                                  {expiringSoon && daysUntilExpiry !== null
                                    ? formatDaysLeftLabel(tr, daysUntilExpiry)
                                    : formatDateTimeInputValue(virtualKey.expiresAt)}
                                </span>
                              </div>
                            ) : (
                              <span className="meta">{tr("No expiry")}</span>
                            )}
                          </td>
                          <td>{formatDateTime(virtualKey.lastUsedAt)}</td>
                          <td>
                            <div className="button-row">
                              <a className="button button--ghost" href={trailHref}>
                                {trailLabel}
                              </a>
                              {virtualKey.status === "active" && !expired ? (
                                <button
                                  className={`button button--ghost${rotatePendingId === virtualKey.id ? " button--disabled" : ""}`}
                                  disabled={rotatePendingId === virtualKey.id}
                                  onClick={() => handleRotate(virtualKey.id)}
                                  type="button"
                                >
                                  {rotatePendingId === virtualKey.id ? tr("Rotating...") : tr("Rotate")}
                                </button>
                              ) : null}
                              {virtualKey.status === "active" ? (
                                <ConfirmActionButton
                                  className={`button button--danger${revokePendingId === virtualKey.id ? " button--disabled" : ""}`}
                                  confirmDescription={tr("confirm.revoke.description")}
                                  confirmLabel={tr("confirm.revoke.label")}
                                  confirmTitle={tr("confirm.revoke.title", { label: virtualKey.label })}
                                  disabled={revokePendingId === virtualKey.id}
                                  onConfirm={() => handleRevoke(virtualKey.id)}
                                  pending={revokePendingId === virtualKey.id}
                                  pendingLabel={tr("Revoking...")}
                                >
                                  {tr("Revoke")}
                                </ConfirmActionButton>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="rounded-lg border border-dashed border-border/60 bg-[color:color-mix(in_srgb,var(--surface-1)_96%,var(--surface-canvas)_4%)] px-4 py-5 text-sm text-muted-foreground">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <p>{tr("No virtual keys match the current filters.")}</p>
                {hasInventoryFilters ? (
                  <button className="button button--ghost button--micro" onClick={resetInventoryFilters} type="button">
                    {tr("Show all keys")}
                  </button>
                ) : null}
              </div>
            </div>
          )}

          {!hasEmptyInventory ? (
            <div className="flex flex-col gap-3 border-t border-border/45 pt-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
                <p>{pageWindowLabel}</p>
                <a className="hover:text-foreground" href={keyAuditTrailHref}>
                  {tr("Audit trail")}
                </a>
                <a className="hover:text-foreground" href={keyExportTrailHref}>
                  {tr("Export logs")}
                </a>
              </div>
              <div className="flex flex-wrap gap-2">
                {hasPreviousPage ? (
                  <a
                    className="button button--ghost"
                    href={buildVirtualKeysPageHref({
                      workspaceId,
                      offset: Math.max(pageOffset - pageSize, 0),
                      q: searchQuery.trim(),
                      statusFilter,
                      bindingFilter,
                      riskFilter,
                      issuanceFilter,
                      returnTo,
                    })}
                  >
                    {tr("Previous page")}
                  </a>
                ) : null}
                {hasNextPage ? (
                  <a
                    className="button button--ghost"
                    href={buildVirtualKeysPageHref({
                      workspaceId,
                      offset: pageOffset + pageSize,
                      q: searchQuery.trim(),
                      statusFilter,
                      bindingFilter,
                      riskFilter,
                      issuanceFilter,
                      returnTo,
                    })}
                  >
                    {tr("Next page")}
                  </a>
                ) : null}
              </div>
            </div>
          ) : null}
      </section>

      <ResourceCreateDialog
        bodyClassName="pb-8"
        description={
          locale === "zh"
            ? "配置服务、共享或运行时凭据的路由、范围和到期时间。"
            : "Configure routing, scope, and expiry for a service, shared, or runtime credential."
        }
        footer={createFlowReveal ? null : (
          <div className="flex items-center justify-end gap-3">
            <Button onClick={() => handleCreateDialogOpenChange(false)} type="button" variant="ghost">
              {tr("Cancel")}
            </Button>
            <Button disabled={!canSubmitVirtualKey} form="virtual-key-create-form" type="submit" className="min-w-[140px] shadow-none">
              {isCreatePending
                ? tr("Creating...")
                : locale === "zh"
                  ? "发放工作负载密钥"
                  : "Issue workload key"}
            </Button>
          </div>
        )}
        onOpenChange={handleCreateDialogOpenChange}
        open={isCreateOpen}
        size="md"
        title={hasEmptyInventory
          ? locale === "zh" ? "发放第一把工作负载密钥" : "Issue the first workload key"
          : locale === "zh" ? "发放工作负载密钥" : "Issue workload key"}
      >
        {issuancePanelBody}
      </ResourceCreateDialog>
    </>
  );
}
