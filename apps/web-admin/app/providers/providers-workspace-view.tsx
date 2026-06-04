"use client";

import { Link } from "@/i18n/navigation";
import dynamic from "next/dynamic";
import { AnimatePresence } from "framer-motion";
import { Plus, Sparkles, X } from "lucide-react";
import {
  Fragment,
  startTransition,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";

import {
  ProviderConnectionModelCatalogSchema,
  ProviderPricingConfigSchema,
  cloneProviderPricingRules,
  getBuiltinPricingCatalogEntry,
  getBuiltinProviderPricingConfig,
  getProviderRoutingTargetSet,
  type ProviderConnection,
  type ProviderConnectionModelCatalog,
  type ProviderModelConfig,
  type ProviderModelConfigItem,
  type ProviderPricingConfig,
  type ProviderPricingRule,
} from "@teamops/contracts";

import {
  createProviderConnectionAction,
  revokeProviderConnectionAction,
  resolveProviderProtocolDefaultConflictAction,
  testProviderConnectionAction,
  testProviderConnectionDraftAction,
  type CreateProviderConnectionActionResult,
  type ProviderConnectionFormInput,
  type RevokeProviderConnectionActionResult,
  type ResolveProviderDefaultConflictActionResult,
  type TestProviderConnectionActionResult,
  type UpdateProviderConnectionActionResult,
  updateProviderConnectionAction,
} from "./actions";
import { EmptyState } from "@/components/shared/empty-state";
import { DisclosureSummary } from "../components/disclosure-summary";
import { LazyDisclosureSection } from "../components/lazy-disclosure-section";
import { ResourceCreateDialog } from "../components/resource-create-dialog";
import { ResourceInlineNotice } from "../components/resource-inline-notice";
import { CompactToolbar, FilterField } from "../components/resource-compact-toolbar";
import { ResourceTableSection } from "../components/resource-table-section";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useLocalePreference, useT } from "@/app/lib/i18n-client";
import { fetchProviderConnectionModelCatalogPreview } from "@/app/lib/console-api-client";
import { cn } from "@/lib/utils";
import {
  ProviderAvatar,
  type ProviderVisualMeta,
  getProviderVisualMetaByTemplateKey,
  getProviderVisualMetaForConnection,
  type ProviderTemplateVisualKey,
} from "./provider-visuals";
import { buildContextualHref, getSafeReturnTo } from "../lib/navigation";
import {
  buildWorkspaceRoutingDefaultsSummary,
  buildWorkspaceRoutingDiagnostics,
  type AdvancedRoutingRecommendation,
} from "./providers-routing-analysis";
import { ProviderDetailPanel } from "./_components/provider-detail-panel";
import {
  ProviderCreateWorkbench,
  providerCreateStepOrder,
  type ProviderCreateStep,
  type ProviderCreateWorkbenchGroup,
  type ProviderCreateWorkbenchTemplate,
} from "./_components/provider-create-workbench";
import { ProviderEditDialog } from "./_components/provider-edit-dialog";
import {
  buildProviderModelConfigJson,
  createProviderModelConfig,
} from "./provider-model-config";
import {
  buildExactPricingRulesFromSelectedModels,
  getSelectedModelPricingCoverage,
  isPricingRuleLinkedToSelectedModels,
} from "./provider-pricing-coverage";
import { getPresetModelsForTemplate } from "./provider-model-registry";

const ProvidersAdvancedDiagnostics = dynamic(
  () =>
    import("./providers-advanced-diagnostics").then(
      (module) => module.ProvidersAdvancedDiagnostics,
    ),
);

type ProvidersWorkspaceViewProps = {
  workspaceId: string;
  workspaceLabel?: string | null;
  pageHref: string;
  initialProviderConnections: ProviderConnection[];
  initialConnectionSearchQuery?: string;
  initialConnectionViewFilter?: ProviderConnectionViewFilter;
  initialProviderKindFilter?: ProviderKindFilter;
};

type ProviderConnectionViewFilter = "all" | "ready" | "attention" | "revoked";
type ProviderKindFilter = ProviderConnection["provider"] | "all";
type ProviderOperationsMode = "basic" | "advanced";
type ProviderTranslator = (
  key: string,
  values?: Record<string, string | number>,
) => string;
type ProviderTemplateId =
  | "anthropic-public"
  | "openai-public"
  | "private-model-cluster"
  | "qwen-cluster"
  | "deepseek-cluster"
  | "internal-endpoint"
  | "new-api-gateway"
  | "customer-gateway";
type ProviderTemplateSchemeGroup =
  | "public-provider"
  | "private-model-cluster"
  | "customer-gateway"
  | "internal-endpoint";
type ProviderTemplate = {
  id: ProviderTemplateId;
  title: string;
  provider: ProviderConnectionFormInput["provider"];
  schemeGroup: ProviderTemplateSchemeGroup;
  technicalKindLabelKey: string;
  groupDescriptionKey: string;
  visualKey: ProviderTemplateVisualKey;
  docsUrl?: string;
  summaryKey: string;
  helperTextKey?: string;
  labelSuggestionKey: string;
  defaultRouting: ProviderConnectionFormInput["defaultForProtocol"];
  modelPrefixes?: string;
  requiresBaseUrl?: boolean;
  sampleModels: string[];
  baseUrlRequirement?: "required" | "optional";
};

type InlineMessage = {
  key: string;
  label: string;
  status: "success" | "error";
  message: string;
  detail?: string | null;
};

type ProviderConnectionRowModel = {
  connection: ProviderConnection;
  connectionAuditHref: string;
  connectionUsageHref: string;
  endpoint: string;
  healthState: ReturnType<typeof getConnectionHealthState>;
  routeSummary: ReturnType<typeof getConnectionRouteSummary>;
  supportsManagedAdmin: boolean;
  ambiguousConflictCount: number;
  visualMeta: ReturnType<typeof getProviderVisualMetaForConnection>;
};

const initialCreateState: CreateProviderConnectionActionResult = {
  status: "idle",
  message: null,
  connection: null,
};

const initialTestState: TestProviderConnectionActionResult = {
  status: "idle",
  message: null,
  result: null,
  connection: null,
};

const providerTemplateCatalog: ProviderTemplate[] = [
  {
    id: "anthropic-public",
    title: "Anthropic",
    provider: "anthropic",
    schemeGroup: "public-provider",
    technicalKindLabelKey: "providerKinds.anthropic",
    groupDescriptionKey: "createFlow.schemeGroups.publicProvider.description",
    visualKey: "anthropic",
    docsUrl: "https://docs.anthropic.com/",
    summaryKey: "templates.anthropicPublic.summary",
    helperTextKey: "templates.anthropicPublic.helper",
    labelSuggestionKey: "templates.anthropicPublic.labelSuggestion",
    defaultRouting: "none",
    sampleModels: ["claude-sonnet", "claude-opus"],
    baseUrlRequirement: "optional",
  },
  {
    id: "openai-public",
    title: "OpenAI",
    provider: "openai",
    schemeGroup: "public-provider",
    technicalKindLabelKey: "providerKinds.openai",
    groupDescriptionKey: "createFlow.schemeGroups.publicProvider.description",
    visualKey: "openai",
    docsUrl: "https://platform.openai.com/docs/overview",
    summaryKey: "templates.openaiPublic.summary",
    helperTextKey: "templates.openaiPublic.helper",
    labelSuggestionKey: "templates.openaiPublic.labelSuggestion",
    defaultRouting: "none",
    sampleModels: ["gpt-4.1", "o4-mini"],
    baseUrlRequirement: "optional",
  },
  {
    id: "private-model-cluster",
    title: "Private cluster",
    provider: "openai-compatible",
    schemeGroup: "private-model-cluster",
    technicalKindLabelKey: "providerKinds.openaiCompatible",
    groupDescriptionKey: "createFlow.schemeGroups.privateModelCluster.description",
    visualKey: "private-cluster",
    docsUrl: "https://platform.openai.com/docs/api-reference/introduction",
    summaryKey: "templates.privateCluster.summary",
    helperTextKey: "templates.privateCluster.helper",
    labelSuggestionKey: "templates.privateCluster.labelSuggestion",
    defaultRouting: "none",
    requiresBaseUrl: true,
    sampleModels: ["qwen-coder", "deepseek-reasoner", "llama-3"],
    baseUrlRequirement: "required",
  },
  {
    id: "qwen-cluster",
    title: "Qwen",
    provider: "openai-compatible",
    schemeGroup: "private-model-cluster",
    technicalKindLabelKey: "providerKinds.openaiCompatible",
    groupDescriptionKey: "createFlow.schemeGroups.privateModelCluster.description",
    visualKey: "qwen",
    docsUrl: "https://help.aliyun.com/zh/model-studio/",
    summaryKey: "templates.qwenCluster.summary",
    helperTextKey: "templates.qwenCluster.helper",
    labelSuggestionKey: "templates.qwenCluster.labelSuggestion",
    defaultRouting: "none",
    modelPrefixes: "qwen-",
    requiresBaseUrl: true,
    sampleModels: ["qwen-max", "qwen-coder"],
    baseUrlRequirement: "required",
  },
  {
    id: "deepseek-cluster",
    title: "DeepSeek",
    provider: "openai-compatible",
    schemeGroup: "private-model-cluster",
    technicalKindLabelKey: "providerKinds.openaiCompatible",
    groupDescriptionKey: "createFlow.schemeGroups.privateModelCluster.description",
    visualKey: "deepseek",
    docsUrl: "https://api-docs.deepseek.com/",
    summaryKey: "templates.deepseekCluster.summary",
    helperTextKey: "templates.deepseekCluster.helper",
    labelSuggestionKey: "templates.deepseekCluster.labelSuggestion",
    defaultRouting: "none",
    modelPrefixes: "deepseek-",
    requiresBaseUrl: true,
    sampleModels: ["deepseek-chat", "deepseek-reasoner"],
    baseUrlRequirement: "required",
  },
  {
    id: "internal-endpoint",
    title: "Internal endpoint",
    provider: "openai-compatible",
    schemeGroup: "internal-endpoint",
    technicalKindLabelKey: "providerKinds.openaiCompatible",
    groupDescriptionKey: "createFlow.schemeGroups.internalEndpoint.description",
    visualKey: "internal",
    docsUrl: "https://platform.openai.com/docs/api-reference/introduction",
    summaryKey: "templates.internalEndpoint.summary",
    helperTextKey: "templates.internalEndpoint.helper",
    labelSuggestionKey: "templates.internalEndpoint.labelSuggestion",
    defaultRouting: "none",
    requiresBaseUrl: true,
    sampleModels: ["internal-coder", "internal-reasoner"],
    baseUrlRequirement: "required",
  },
  {
    id: "new-api-gateway",
    title: "New API",
    provider: "openai-compatible",
    schemeGroup: "customer-gateway",
    technicalKindLabelKey: "providerKinds.openaiCompatible",
    groupDescriptionKey: "createFlow.schemeGroups.customerGateway.description",
    visualKey: "customer-gateway",
    docsUrl: undefined,
    summaryKey: "templates.newApiGateway.summary",
    helperTextKey: "templates.newApiGateway.helper",
    labelSuggestionKey: "templates.newApiGateway.labelSuggestion",
    defaultRouting: "none",
    requiresBaseUrl: true,
    sampleModels: ["gpt-4.1", "claude-sonnet-4", "deepseek-chat"],
    baseUrlRequirement: "required",
  },
  {
    id: "customer-gateway",
    title: "Customer gateway",
    provider: "openai",
    schemeGroup: "customer-gateway",
    technicalKindLabelKey: "providerKinds.openai",
    groupDescriptionKey: "createFlow.schemeGroups.customerGateway.description",
    visualKey: "customer-gateway",
    docsUrl: "https://platform.openai.com/docs/overview",
    summaryKey: "templates.customerGateway.summary",
    helperTextKey: "templates.customerGateway.helper",
    labelSuggestionKey: "templates.customerGateway.labelSuggestion",
    defaultRouting: "none",
    requiresBaseUrl: true,
    sampleModels: ["gpt-4.1", "customer-gpt"],
    baseUrlRequirement: "required",
  },
];

function getProviderPricingCopy(locale: string, zh: string, en: string) {
  return locale === "zh" ? zh : en;
}

function supportsBuiltinPricingCatalog(provider: ProviderConnection["provider"]) {
  return provider === "anthropic" || provider === "openai";
}

function getDefaultPricingConfig(
  provider: ProviderConnection["provider"],
  pricingConfig?: ProviderPricingConfig | null,
) {
  if (pricingConfig) {
    return pricingConfig;
  }

  if (supportsBuiltinPricingCatalog(provider)) {
    return getBuiltinProviderPricingConfig(provider);
  }

  return ProviderPricingConfigSchema.parse({
    mode: "manual",
    rules: [],
  });
}

function createEmptyPricingRule(
  provider: ProviderConnection["provider"],
  matchType: ProviderPricingRule["matchType"],
): ProviderPricingRule {
  return {
    matchType,
    model: matchType === "fallback" ? null : "",
    rates: {
      inputUsdPerMillion: 0,
      outputUsdPerMillion: 0,
      cachedInputUsdPerMillion: provider === "openai" ? 0 : null,
      cacheReadInputUsdPerMillion: provider === "anthropic" ? 0 : null,
      cacheWrite5mInputUsdPerMillion: provider === "anthropic" ? 0 : null,
      cacheWrite1hInputUsdPerMillion: provider === "anthropic" ? 0 : null,
      longContextThresholdInputTokens: null,
      longContextInputUsdPerMillion: null,
      longContextOutputUsdPerMillion: null,
      longContextCacheReadInputUsdPerMillion: null,
      longContextCacheWrite5mInputUsdPerMillion: null,
      longContextCacheWrite1hInputUsdPerMillion: null,
    },
  };
}

function parsePricingConfigJson(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return ProviderPricingConfigSchema.parse({
      mode: "manual",
      rules: [],
    });
  }

  return ProviderPricingConfigSchema.parse(JSON.parse(value));
}

function parsePricingNumber(value: string, allowNull = false) {
  if (!value.trim()) {
    return allowNull ? null : 0;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return allowNull ? null : 0;
  }

  return parsed;
}

function parsePricingInteger(value: string, allowNull = false) {
  if (!value.trim()) {
    return allowNull ? null : 0;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return allowNull ? null : 0;
  }

  return Math.trunc(parsed);
}

function formatPricingInputValue(value: number | null | undefined) {
  return value === null || value === undefined ? "" : String(value);
}

function shouldShowLongContextInputs(rule: { model: string | null }) {
  return rule.model === "claude-sonnet-4" || rule.model === "claude-sonnet-4-5" || rule.model === "claude-sonnet-4-6";
}

type ProviderPricingEditorProps = {
  provider: ProviderConnection["provider"];
  metadata?: Record<string, string>;
  locale: string;
  initialValue?: ProviderPricingConfig | null;
  inputName?: string;
  onValueChange?: (value: ProviderPricingConfig) => void;
  onValidationChange?: (message: string | null) => void;
  selectedModels?: ProviderModelConfigItem[];
};

type ProviderPricingRuleDraft = Omit<ProviderPricingRule, "model"> & {
  model: string | null;
};

type ProviderPricingConfigDraft = {
  mode: ProviderPricingConfig["mode"];
  rules: ProviderPricingRuleDraft[];
};

function toPricingConfigDraft(
  config: ProviderPricingConfig,
): ProviderPricingConfigDraft {
  return {
    mode: config.mode,
    rules: cloneProviderPricingRules(config.rules).map((rule) => ({
      ...rule,
      model: rule.model,
    })),
  };
}

function arePricingConfigDraftsEqual(
  left: ProviderPricingConfigDraft,
  right: ProviderPricingConfigDraft,
) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function getLocalizedPricingValidationMessage(locale: string, message: string) {
  if (locale !== "zh") {
    return message;
  }

  const duplicateMatch = message.match(/^Duplicate pricing rule for model (.+)$/i);
  if (duplicateMatch) {
    return `模型 ${duplicateMatch[1]} 已存在定价规则。`;
  }

  if (
    /^String must contain at least 1 character\(s\)$/i.test(message) ||
    /^Canonical pricing rules require a model$/i.test(message)
  ) {
    return "模型名称不能为空。";
  }

  if (/^Fallback pricing rules cannot define a model$/i.test(message)) {
    return "回退价格规则不需要填写模型名称。";
  }

  if (/^Long context pricing requires a threshold$/i.test(message)) {
    return "填写长上下文价格时，必须设置长上下文阈值。";
  }

  if (/^Only one fallback pricing rule is allowed$/i.test(message)) {
    return "最多只能添加一条回退价格规则。";
  }

  if (/^Number must be greater than or equal to 1$/i.test(message)) {
    return "长上下文阈值必须大于或等于 1。";
  }

  if (/^Number must be greater than or equal to 0$/i.test(message)) {
    return "价格必须大于或等于 0。";
  }

  return "定价配置有误，请检查后重试。";
}

function getPricingConfigDraftValidationMessage(
  locale: string,
  draft: ProviderPricingConfigDraft,
) {
  const parsed = ProviderPricingConfigSchema.safeParse(draft);
  if (parsed.success) {
    return null;
  }

  return getLocalizedPricingValidationMessage(
    locale,
    parsed.error.issues[0]?.message ?? "Invalid pricing config",
  );
}

function ProviderPricingEditor({
  provider,
  metadata = {},
  locale,
  initialValue,
  inputName,
  onValueChange,
  onValidationChange,
  selectedModels = [],
}: ProviderPricingEditorProps) {
  const resolvedInitialValue = useMemo(
    () => getDefaultPricingConfig(provider, initialValue),
    [initialValue, provider],
  );
  const [draftConfig, setDraftConfig] = useState<ProviderPricingConfigDraft>(
    () => toPricingConfigDraft(resolvedInitialValue),
  );
  const builtinEntry = supportsBuiltinPricingCatalog(provider)
    ? getBuiltinPricingCatalogEntry(provider)
    : null;
  const builtinConfig = supportsBuiltinPricingCatalog(provider)
    ? getBuiltinProviderPricingConfig(provider)
    : null;
  const displayedConfig =
    draftConfig.mode === "builtin" && builtinConfig
      ? toPricingConfigDraft(builtinConfig)
      : draftConfig;
  const hasFallbackRule = displayedConfig.rules.some(
    (rule) => rule.matchType === "fallback",
  );
  const selectedModelCoverage = useMemo(
    () =>
      getSelectedModelPricingCoverage({
        provider,
        selectedModels,
        pricingConfig: ProviderPricingConfigSchema.parse(displayedConfig),
        metadata,
      }),
    [displayedConfig, metadata, provider, selectedModels],
  );
  const uncoveredSelectedModels = selectedModelCoverage.filter(
    (item) => item.status === "uncovered",
  );
  const fallbackCoveredSelectedModels = selectedModelCoverage.filter(
    (item) => item.status === "fallback",
  );
  const draftValidationMessage = getPricingConfigDraftValidationMessage(
    locale,
    draftConfig,
  );

  useEffect(() => {
    const nextDraftConfig = toPricingConfigDraft(resolvedInitialValue);
    setDraftConfig((currentDraftConfig) =>
      arePricingConfigDraftsEqual(currentDraftConfig, nextDraftConfig)
        ? currentDraftConfig
        : nextDraftConfig,
    );
  }, [resolvedInitialValue]);

  useEffect(() => {
    const parsed = ProviderPricingConfigSchema.safeParse(draftConfig);
    if (parsed.success) {
      onValueChange?.(parsed.data);
      onValidationChange?.(null);
      return;
    }

    onValidationChange?.(
      getLocalizedPricingValidationMessage(
        locale,
        parsed.error.issues[0]?.message ?? "Invalid pricing config",
      ),
    );
  }, [draftConfig, locale, onValidationChange, onValueChange]);

  function updateDraftConfig(nextConfig: ProviderPricingConfigDraft) {
    setDraftConfig(nextConfig);
  }

  function customizePricing() {
    if (!builtinConfig) {
      return;
    }

    updateDraftConfig({
      mode: "manual",
      rules: cloneProviderPricingRules(builtinConfig.rules),
    });
  }

  function resetToBuiltinPricing() {
    if (!builtinConfig) {
      return;
    }

    updateDraftConfig(toPricingConfigDraft(builtinConfig));
  }

  function addRule(matchType: ProviderPricingRule["matchType"]) {
    updateDraftConfig({
      mode: "manual",
      rules: [
        ...displayedConfig.rules,
        createEmptyPricingRule(provider, matchType),
      ],
    });
  }

  function removeRule(index: number) {
    updateDraftConfig({
      mode: "manual",
      rules: displayedConfig.rules.filter((_, ruleIndex) => ruleIndex !== index),
    });
  }

  function updateRule(
    index: number,
    updater: (rule: ProviderPricingRuleDraft) => ProviderPricingRuleDraft,
  ) {
    updateDraftConfig({
      mode: draftConfig.mode === "builtin" ? "manual" : draftConfig.mode,
      rules: displayedConfig.rules.map((rule, ruleIndex) =>
        ruleIndex === index ? updater(rule) : rule,
      ),
    });
  }

  function generateRulesFromSelectedModels() {
    updateDraftConfig({
      mode: "manual",
      rules: buildExactPricingRulesFromSelectedModels({
        provider,
        selectedModels,
        existingRules: displayedConfig.rules,
      }),
    });
  }

  return (
    <div className="space-y-3 rounded-lg border border-border/60 bg-[color:color-mix(in_srgb,var(--surface-1)_94%,var(--surface-canvas)_6%)] px-3.5 py-3">
      {inputName ? (
        <input
          name={inputName}
          type="hidden"
          value={JSON.stringify(draftConfig)}
        />
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <p className="text-[13px] font-medium text-foreground">
            {getProviderPricingCopy(locale, "定价", "Pricing")}
          </p>
          <p className="text-[12px] text-muted-foreground">
            {supportsBuiltinPricingCatalog(provider)
              ? draftConfig.mode === "builtin"
                ? getProviderPricingCopy(
                    locale,
                    "当前使用内置官方价格。可切换到自定义后覆盖。",
                    "Using builtin official pricing. Switch to custom pricing to override it.",
                  )
                : getProviderPricingCopy(
                    locale,
                    "当前使用连接级自定义价格。",
                    "Using connection-level custom pricing.",
                  )
              : getProviderPricingCopy(
                  locale,
                  "该连接没有内置官方价格，需要手动录入。",
                  "This connection has no builtin official pricing. Add manual rates.",
                )}
          </p>
          {builtinEntry ? (
            <p className="text-[11px] text-muted-foreground">
              {getProviderPricingCopy(locale, "已核对日期", "Verified")}{" "}
              {builtinEntry.reference.verifiedAt}
              {" · "}
              <a
                className="underline underline-offset-2"
                href={builtinEntry.reference.pricingPageUrl}
                rel="noreferrer"
                target="_blank"
              >
                {getProviderPricingCopy(locale, "价格文档", "Pricing docs")}
              </a>
              {" · "}
              <a
                className="underline underline-offset-2"
                href={builtinEntry.reference.usagePageUrl}
                rel="noreferrer"
                target="_blank"
              >
                {getProviderPricingCopy(locale, "用量字段", "Usage fields")}
              </a>
              {builtinEntry.reference.promptCachingUrl ? (
                <>
                  {" · "}
                  <a
                    className="underline underline-offset-2"
                    href={builtinEntry.reference.promptCachingUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {getProviderPricingCopy(locale, "缓存计费", "Prompt caching")}
                  </a>
                </>
              ) : null}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {supportsBuiltinPricingCatalog(provider) && draftConfig.mode === "builtin" ? (
            <Button onClick={customizePricing} size="sm" type="button" variant="outline">
              {getProviderPricingCopy(locale, "自定义价格", "Customize pricing")}
            </Button>
          ) : null}
          {supportsBuiltinPricingCatalog(provider) && draftConfig.mode === "manual" ? (
            <Button onClick={resetToBuiltinPricing} size="sm" type="button" variant="ghost">
              {getProviderPricingCopy(locale, "恢复官方价格", "Reset to official")}
            </Button>
          ) : null}
          {draftConfig.mode === "manual" ? (
            <>
              {selectedModels.length > 0 ? (
                <Button
                  onClick={generateRulesFromSelectedModels}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {getProviderPricingCopy(locale, "从已选模型生成价格规则", "Generate from selected models")}
                </Button>
              ) : null}
              <Button
                onClick={() => addRule("canonical")}
                size="sm"
                type="button"
                variant="outline"
              >
                {getProviderPricingCopy(locale, "添加精确模型", "Add exact model")}
              </Button>
              <Button
                disabled={hasFallbackRule}
                onClick={() => addRule("fallback")}
                size="sm"
                type="button"
                variant="outline"
              >
                {getProviderPricingCopy(locale, "添加回退价格", "Add fallback")}
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {draftValidationMessage ? (
        <div className="rounded-md border border-[color:var(--destructive-border)] bg-[color:color-mix(in_srgb,var(--destructive-soft)_72%,var(--surface-1)_28%)] px-3 py-2 text-[12px] text-[color:var(--destructive)]">
          {draftValidationMessage}
        </div>
      ) : null}

      {selectedModels.length > 0 ? (
        <div className="rounded-md border border-border/60 bg-background/80 px-3 py-3 text-[12px] text-muted-foreground">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-foreground">
              {getProviderPricingCopy(locale, "已选模型定价覆盖", "Selected model pricing coverage")}
            </span>
            {selectedModelCoverage.map((item) => (
              <Badge
                key={item.canonicalModel}
                variant={
                  item.status === "exact"
                    ? "outline"
                    : item.status === "fallback"
                      ? "secondary"
                      : "warning"
                }
              >
                {item.label}
                {" · "}
                {item.status === "exact"
                  ? getProviderPricingCopy(locale, "精确定价", "Exact")
                  : item.status === "fallback"
                    ? getProviderPricingCopy(locale, "回退定价", "Fallback")
                    : getProviderPricingCopy(locale, "未覆盖", "Uncovered")}
              </Badge>
            ))}
          </div>
          <p className="mt-2 leading-5">
            {getProviderPricingCopy(
              locale,
              "精确价格按规范模型 ID 匹配。`glm` 与 `glm-4` 是不同模型，除非你使用回退价格。",
              "Exact pricing matches canonical model IDs. `glm` and `glm-4` are different models unless you use fallback pricing.",
            )}
          </p>
          {uncoveredSelectedModels.length > 0 ? (
            <p className="mt-2 text-[color:var(--destructive)]">
              {getProviderPricingCopy(
                locale,
                `仍有未覆盖模型：${uncoveredSelectedModels.map((item) => item.canonicalModel).join(", ")}`,
                `Still uncovered: ${uncoveredSelectedModels.map((item) => item.canonicalModel).join(", ")}`,
              )}
            </p>
          ) : null}
          {fallbackCoveredSelectedModels.length > 0 ? (
            <p className="mt-1">
              {getProviderPricingCopy(
                locale,
                `以下模型当前只会命中回退价格：${fallbackCoveredSelectedModels.map((item) => item.canonicalModel).join(", ")}`,
                `These models currently rely on fallback pricing: ${fallbackCoveredSelectedModels.map((item) => item.canonicalModel).join(", ")}`,
              )}
            </p>
          ) : null}
        </div>
      ) : null}

      {!displayedConfig.rules.length ? (
        <div className="rounded-md border border-dashed border-border/60 px-3 py-3 text-[12px] text-muted-foreground">
          {getProviderPricingCopy(
            locale,
            "当前还没有价格规则。预算启用时，未命中的模型会因为缺少价格而被拦截。",
            "No pricing rules yet. When budgets are enabled, unmatched models will be blocked because pricing is missing.",
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table className="w-full text-[12px]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[130px]">
                  {getProviderPricingCopy(locale, "类型", "Type")}
                </TableHead>
                <TableHead className="min-w-[180px]">
                  {getProviderPricingCopy(locale, "模型", "Model")}
                </TableHead>
                <TableHead className="min-w-[110px]">
                  {getProviderPricingCopy(locale, "输入", "Input")}
                </TableHead>
                {provider === "openai" ? (
                  <TableHead className="min-w-[120px]">
                    {getProviderPricingCopy(locale, "缓存输入", "Cached input")}
                  </TableHead>
                ) : null}
                {provider === "anthropic" ? (
                  <>
                    <TableHead className="min-w-[120px]">
                      {getProviderPricingCopy(locale, "缓存读取", "Cache read")}
                    </TableHead>
                    <TableHead className="min-w-[140px]">
                      {getProviderPricingCopy(locale, "缓存写入 5 分钟", "Cache write 5m")}
                    </TableHead>
                    <TableHead className="min-w-[140px]">
                      {getProviderPricingCopy(locale, "缓存写入 1 小时", "Cache write 1h")}
                    </TableHead>
                  </>
                ) : null}
                <TableHead className="min-w-[110px]">
                  {getProviderPricingCopy(locale, "输出", "Output")}
                </TableHead>
                {draftConfig.mode === "manual" ? (
                  <TableHead className="w-[88px] text-right">
                    {getProviderPricingCopy(locale, "操作", "Action")}
                  </TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayedConfig.rules.map((rule, index) => (
                <Fragment key={`${rule.matchType}:${rule.model ?? "fallback"}:${index}`}>
                  <TableRow className="align-top">
                    <TableCell className="py-3">
                      <Badge variant={rule.matchType === "fallback" ? "secondary" : "outline"}>
                        {rule.matchType === "fallback"
                          ? getProviderPricingCopy(locale, "回退", "Fallback")
                          : getProviderPricingCopy(locale, "精确模型", "Exact")}
                      </Badge>
                    </TableCell>
                    <TableCell className="py-3">
                      {draftConfig.mode === "manual" && rule.matchType === "canonical" ? (
                        <div className="space-y-2">
                          <Input
                            onChange={(event) =>
                              updateRule(index, (currentRule) => ({
                                ...currentRule,
                                model: event.currentTarget.value.trim().toLowerCase(),
                              }))
                            }
                            value={rule.model ?? ""}
                          />
                          {selectedModels.length > 0 &&
                          !isPricingRuleLinkedToSelectedModels(rule, selectedModels) ? (
                            <Badge variant="warning">
                              {getProviderPricingCopy(locale, "未关联到已选模型", "Unlinked")}
                            </Badge>
                          ) : null}
                        </div>
                      ) : (
                        <div className="text-muted-foreground">
                          {rule.matchType === "fallback"
                            ? getProviderPricingCopy(locale, "未命中模型", "Unmatched models")
                            : rule.model}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="py-3">
                      {draftConfig.mode === "manual" ? (
                        <Input
                          onChange={(event) =>
                            updateRule(index, (currentRule) => ({
                              ...currentRule,
                              rates: {
                                ...currentRule.rates,
                                inputUsdPerMillion: Number(parsePricingNumber(event.currentTarget.value)),
                              },
                            }))
                          }
                          step="0.000001"
                          type="number"
                          value={formatPricingInputValue(rule.rates.inputUsdPerMillion)}
                        />
                      ) : (
                        formatPricingInputValue(rule.rates.inputUsdPerMillion)
                      )}
                    </TableCell>
                    {provider === "openai" ? (
                      <TableCell className="py-3">
                        {draftConfig.mode === "manual" ? (
                          <Input
                            onChange={(event) =>
                              updateRule(index, (currentRule) => ({
                                ...currentRule,
                                rates: {
                                  ...currentRule.rates,
                                  cachedInputUsdPerMillion: parsePricingNumber(
                                    event.currentTarget.value,
                                    true,
                                  ),
                                },
                              }))
                            }
                            step="0.000001"
                            type="number"
                            value={formatPricingInputValue(rule.rates.cachedInputUsdPerMillion)}
                          />
                        ) : (
                          formatPricingInputValue(rule.rates.cachedInputUsdPerMillion)
                        )}
                      </TableCell>
                    ) : null}
                    {provider === "anthropic" ? (
                      <>
                        <TableCell className="py-3">
                          {draftConfig.mode === "manual" ? (
                            <Input
                              onChange={(event) =>
                                updateRule(index, (currentRule) => ({
                                  ...currentRule,
                                  rates: {
                                    ...currentRule.rates,
                                    cacheReadInputUsdPerMillion: parsePricingNumber(
                                      event.currentTarget.value,
                                      true,
                                    ),
                                  },
                                }))
                              }
                              step="0.000001"
                              type="number"
                              value={formatPricingInputValue(rule.rates.cacheReadInputUsdPerMillion)}
                            />
                          ) : (
                            formatPricingInputValue(rule.rates.cacheReadInputUsdPerMillion)
                          )}
                        </TableCell>
                        <TableCell className="py-3">
                          {draftConfig.mode === "manual" ? (
                            <Input
                              onChange={(event) =>
                                updateRule(index, (currentRule) => ({
                                  ...currentRule,
                                  rates: {
                                    ...currentRule.rates,
                                    cacheWrite5mInputUsdPerMillion: parsePricingNumber(
                                      event.currentTarget.value,
                                      true,
                                    ),
                                  },
                                }))
                              }
                              step="0.000001"
                              type="number"
                              value={formatPricingInputValue(rule.rates.cacheWrite5mInputUsdPerMillion)}
                            />
                          ) : (
                            formatPricingInputValue(rule.rates.cacheWrite5mInputUsdPerMillion)
                          )}
                        </TableCell>
                        <TableCell className="py-3">
                          {draftConfig.mode === "manual" ? (
                            <Input
                              onChange={(event) =>
                                updateRule(index, (currentRule) => ({
                                  ...currentRule,
                                  rates: {
                                    ...currentRule.rates,
                                    cacheWrite1hInputUsdPerMillion: parsePricingNumber(
                                      event.currentTarget.value,
                                      true,
                                    ),
                                  },
                                }))
                              }
                              step="0.000001"
                              type="number"
                              value={formatPricingInputValue(rule.rates.cacheWrite1hInputUsdPerMillion)}
                            />
                          ) : (
                            formatPricingInputValue(rule.rates.cacheWrite1hInputUsdPerMillion)
                          )}
                        </TableCell>
                      </>
                    ) : null}
                    <TableCell className="py-3">
                      {draftConfig.mode === "manual" ? (
                        <Input
                          onChange={(event) =>
                            updateRule(index, (currentRule) => ({
                              ...currentRule,
                              rates: {
                                ...currentRule.rates,
                                outputUsdPerMillion: Number(parsePricingNumber(event.currentTarget.value)),
                              },
                            }))
                          }
                          step="0.000001"
                          type="number"
                          value={formatPricingInputValue(rule.rates.outputUsdPerMillion)}
                        />
                      ) : (
                        formatPricingInputValue(rule.rates.outputUsdPerMillion)
                      )}
                    </TableCell>
                    {draftConfig.mode === "manual" ? (
                      <TableCell className="py-3 text-right">
                        <Button
                          onClick={() => removeRule(index)}
                          size="sm"
                          type="button"
                          variant="ghost"
                        >
                          <X className="size-4" />
                        </Button>
                      </TableCell>
                    ) : null}
                  </TableRow>
                  {provider === "anthropic" && shouldShowLongContextInputs(rule) ? (
                    <TableRow className="hover:bg-transparent">
                      <TableCell
                        className="border-t-0 py-0"
                        colSpan={draftConfig.mode === "manual" ? 8 : 7}
                      >
                        <div className="grid gap-3 border-t border-border/45 px-1 py-3 md:grid-cols-5">
                          <div className="space-y-1">
                            <p className="text-[11px] font-medium text-muted-foreground">
                              {getProviderPricingCopy(locale, "长上下文阈值", "Long context threshold")}
                            </p>
                            {draftConfig.mode === "manual" ? (
                              <Input
                                onChange={(event) =>
                                  updateRule(index, (currentRule) => ({
                                    ...currentRule,
                                    rates: {
                                      ...currentRule.rates,
                                      longContextThresholdInputTokens: parsePricingInteger(
                                        event.currentTarget.value,
                                        true,
                                      ),
                                    },
                                  }))
                                }
                                type="number"
                                value={formatPricingInputValue(rule.rates.longContextThresholdInputTokens)}
                              />
                            ) : (
                              <div className="text-[12px] text-muted-foreground">
                                {formatPricingInputValue(rule.rates.longContextThresholdInputTokens)}
                              </div>
                            )}
                          </div>
                          <div className="space-y-1">
                            <p className="text-[11px] font-medium text-muted-foreground">
                              {getProviderPricingCopy(locale, "长上下文输入", "Long input")}
                            </p>
                            {draftConfig.mode === "manual" ? (
                              <Input
                                onChange={(event) =>
                                  updateRule(index, (currentRule) => ({
                                    ...currentRule,
                                    rates: {
                                      ...currentRule.rates,
                                      longContextInputUsdPerMillion: parsePricingNumber(
                                        event.currentTarget.value,
                                        true,
                                      ),
                                    },
                                  }))
                                }
                                step="0.000001"
                                type="number"
                                value={formatPricingInputValue(rule.rates.longContextInputUsdPerMillion)}
                              />
                            ) : (
                              <div className="text-[12px] text-muted-foreground">
                                {formatPricingInputValue(rule.rates.longContextInputUsdPerMillion)}
                              </div>
                            )}
                          </div>
                          <div className="space-y-1">
                            <p className="text-[11px] font-medium text-muted-foreground">
                              {getProviderPricingCopy(locale, "长上下文输出", "Long output")}
                            </p>
                            {draftConfig.mode === "manual" ? (
                              <Input
                                onChange={(event) =>
                                  updateRule(index, (currentRule) => ({
                                    ...currentRule,
                                    rates: {
                                      ...currentRule.rates,
                                      longContextOutputUsdPerMillion: parsePricingNumber(
                                        event.currentTarget.value,
                                        true,
                                      ),
                                    },
                                  }))
                                }
                                step="0.000001"
                                type="number"
                                value={formatPricingInputValue(rule.rates.longContextOutputUsdPerMillion)}
                              />
                            ) : (
                              <div className="text-[12px] text-muted-foreground">
                                {formatPricingInputValue(rule.rates.longContextOutputUsdPerMillion)}
                              </div>
                            )}
                          </div>
                          <div className="space-y-1">
                            <p className="text-[11px] font-medium text-muted-foreground">
                              {getProviderPricingCopy(locale, "长上下文缓存读取", "Long cache read")}
                            </p>
                            {draftConfig.mode === "manual" ? (
                              <Input
                                onChange={(event) =>
                                  updateRule(index, (currentRule) => ({
                                    ...currentRule,
                                    rates: {
                                      ...currentRule.rates,
                                      longContextCacheReadInputUsdPerMillion: parsePricingNumber(
                                        event.currentTarget.value,
                                        true,
                                      ),
                                    },
                                  }))
                                }
                                step="0.000001"
                                type="number"
                                value={formatPricingInputValue(rule.rates.longContextCacheReadInputUsdPerMillion)}
                              />
                            ) : (
                              <div className="text-[12px] text-muted-foreground">
                                {formatPricingInputValue(rule.rates.longContextCacheReadInputUsdPerMillion)}
                              </div>
                            )}
                          </div>
                          <div className="space-y-1">
                            <p className="text-[11px] font-medium text-muted-foreground">
                              {getProviderPricingCopy(locale, "长上下文缓存写入", "Long cache write")}
                            </p>
                            <div className="grid gap-2 sm:grid-cols-2">
                              {draftConfig.mode === "manual" ? (
                                <>
                                  <Input
                                    onChange={(event) =>
                                      updateRule(index, (currentRule) => ({
                                        ...currentRule,
                                        rates: {
                                          ...currentRule.rates,
                                          longContextCacheWrite5mInputUsdPerMillion: parsePricingNumber(
                                            event.currentTarget.value,
                                            true,
                                          ),
                                        },
                                      }))
                                    }
                                    placeholder="5m"
                                    step="0.000001"
                                    type="number"
                                    value={formatPricingInputValue(rule.rates.longContextCacheWrite5mInputUsdPerMillion)}
                                  />
                                  <Input
                                    onChange={(event) =>
                                      updateRule(index, (currentRule) => ({
                                        ...currentRule,
                                        rates: {
                                          ...currentRule.rates,
                                          longContextCacheWrite1hInputUsdPerMillion: parsePricingNumber(
                                            event.currentTarget.value,
                                            true,
                                          ),
                                        },
                                      }))
                                    }
                                    placeholder="1h"
                                    step="0.000001"
                                    type="number"
                                    value={formatPricingInputValue(rule.rates.longContextCacheWrite1hInputUsdPerMillion)}
                                  />
                                </>
                              ) : (
                                <>
                                  <div className="text-[12px] text-muted-foreground">
                                    5m: {formatPricingInputValue(rule.rates.longContextCacheWrite5mInputUsdPerMillion)}
                                  </div>
                                  <div className="text-[12px] text-muted-foreground">
                                    1h: {formatPricingInputValue(rule.rates.longContextCacheWrite1hInputUsdPerMillion)}
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : null}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function formatLocalizedDateTime(
  value: string | null,
  locale: ReturnType<typeof useLocalePreference>["locale"],
) {
  if (!value) {
    return null;
  }

  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function getDaysSince(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.max(0, Math.floor((Date.now() - parsed) / (24 * 60 * 60 * 1000)));
}

function connectionNeedsAttention(connection: ProviderConnection) {
  if (connection.status !== "active") {
    return false;
  }

  if (connection.lastTestStatus === "failed" || !connection.lastTestedAt) {
    return true;
  }

  const daysSince = getDaysSince(connection.lastTestedAt);
  return daysSince !== null && daysSince >= 14;
}

function getProviderKindLabelKey(provider: ProviderConnection["provider"]) {
  if (provider === "anthropic") {
    return "providerKinds.anthropic";
  }

  if (provider === "openai") {
    return "providerKinds.openai";
  }

  if (provider === "bedrock") {
    return "providerKinds.bedrock";
  }

  if (provider === "vertex") {
    return "providerKinds.vertex";
  }

  return "providerKinds.openaiCompatible";
}

function getProviderKindLabel(
  provider: ProviderConnection["provider"],
  tr: ProviderTranslator,
) {
  return tr(getProviderKindLabelKey(provider));
}

function getConnectionViewFilterLabelKey(filter: ProviderConnectionViewFilter) {
  if (filter === "ready") {
    return "viewFilters.ready";
  }

  if (filter === "attention") {
    return "viewFilters.attention";
  }

  if (filter === "revoked") {
    return "viewFilters.revoked";
  }

  return "viewFilters.all";
}

function getConnectionStatusLabelKey(status: ProviderConnection["status"]) {
  return status === "revoked"
    ? "providerStatus.revoked"
    : "providerStatus.active";
}

function getProviderTemplateTitle(
  template: ProviderTemplate,
  tr: ProviderTranslator,
) {
  switch (template.id) {
    case "anthropic-public":
      return tr("providerKinds.anthropic");
    case "openai-public":
      return tr("providerKinds.openai");
    case "private-model-cluster":
      return tr("templateTitles.privateCluster");
    case "qwen-cluster":
      return "Qwen";
    case "deepseek-cluster":
      return "DeepSeek";
    case "internal-endpoint":
      return tr("templateTitles.internalEndpoint");
    case "customer-gateway":
      return tr("templateTitles.customerGateway");
    case "new-api-gateway":
      return tr("templateTitles.newApiGateway");
    default:
      return template.title;
  }
}

function getProviderVisualLabel(
  visualMeta: ReturnType<typeof getProviderVisualMetaForConnection>,
  tr: ProviderTranslator,
) {
  if (visualMeta.providerKey === "anthropic") {
    return tr("providerKinds.anthropic");
  }

  if (visualMeta.providerKey === "openai") {
    return tr("providerKinds.openai");
  }

  if (visualMeta.providerKey === "private-cluster") {
    return tr("templateTitles.privateCluster");
  }

  if (visualMeta.providerKey === "internal") {
    return tr("templateTitles.internalEndpoint");
  }

  if (visualMeta.providerKey === "customer-gateway") {
    return tr("templateTitles.customerGateway");
  }

  return visualMeta.label;
}

function getRoutingDefaultsSummaryLabel(
  label: string,
  tr: ProviderTranslator,
) {
  if (label === "No active routes") {
    return tr("advancedTools.summary.noActiveRoutes");
  }

  if (label === "Routing review needed") {
    return tr("advancedTools.summary.routingReviewNeeded");
  }

  if (label === "Routing clear") {
    return tr("advancedTools.summary.defaultsClear");
  }

  return label;
}

function describeProviderEndpoint(
  connection: ProviderConnection,
  tr: ProviderTranslator,
) {
  if (connection.baseUrl) {
    return connection.baseUrl;
  }

  if (connection.provider === "anthropic") {
    return "https://api.anthropic.com";
  }

  if (connection.provider === "openai") {
    return "https://api.openai.com";
  }

  return tr("endpoint.baseUrlRequired");
}

function getFormDefaults(provider: ProviderConnectionFormInput["provider"]) {
  if (provider === "anthropic") {
    return {
      apiKeyPlaceholder: "sk-ant-...",
      baseUrlPlaceholder: "Optional Anthropic base URL",
      baseUrlHelp: "Leave blank for public Anthropic API.",
    };
  }

  if (provider === "openai") {
    return {
      apiKeyPlaceholder: "sk-proj-...",
      baseUrlPlaceholder:
        "Optional override, defaults to https://api.openai.com",
      baseUrlHelp: "Set a base URL for gateway routes.",
    };
  }

  return {
    apiKeyPlaceholder: "sk-...",
    baseUrlPlaceholder: "Required, for example https://api.example.com/v1",
    baseUrlHelp: "Trailing /v1 is normalized.",
  };
}

function getDraftCatalogDisabledReason(args: {
  tr: ProviderTranslator;
  apiKey: string;
  baseUrl: string;
  baseUrlRequired: boolean;
}) {
  const hasApiKey = args.apiKey.trim().length > 0;
  const hasBaseUrl = args.baseUrl.trim().length > 0;

  if (!hasApiKey && args.baseUrlRequired && !hasBaseUrl) {
    return args.tr("modelManager.catalogDisabledApiKeyAndBaseUrl");
  }

  if (!hasApiKey) {
    return args.tr("modelManager.catalogDisabledApiKeyOnly");
  }

  if (args.baseUrlRequired && !hasBaseUrl) {
    return args.tr("modelManager.catalogDisabledBaseUrlOnly");
  }

  return args.tr("modelManager.catalogDisabled");
}

function getPreferredMetadataValue(
  metadata: Record<string, string>,
  keys: string[],
) {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return "";
}

function getConnectionRoutingTargetSet(connection: ProviderConnection) {
  return getProviderRoutingTargetSet(connection.metadata);
}

function supportsManagedProviderAdmin(
  provider: ProviderConnection["provider"],
) {
  return true;
}

function buildProvidersDeskHref(args: {
  workspaceId: string;
  q?: string | null;
  view?: ProviderConnectionViewFilter;
  kind?: ProviderKindFilter;
  returnTo?: string | null;
}) {
  const params = new URLSearchParams({
    workspaceId: args.workspaceId,
  });

  if (args.q?.trim()) {
    params.set("q", args.q.trim());
  }

  if (args.view && args.view !== "all") {
    params.set("view", args.view);
  }

  if (args.kind && args.kind !== "all") {
    params.set("kind", args.kind);
  }

  const href = `/providers?${params.toString()}`;
  return buildContextualHref(href, args.returnTo);
}

function getConnectionRouteSummary(
  connection: ProviderConnection,
  tr: ProviderTranslator,
) {
  const targets = getConnectionRoutingTargetSet(connection);
  const exactModels = targets.exactModels;
  const modelPrefixes = targets.modelPrefixes;

  if (exactModels.length || modelPrefixes.length) {
    return {
      label: tr("routeSummary.modelRoutedLabel"),
      detail: [
        exactModels.length
          ? tr("routeSummary.exactModels", { count: exactModels.length })
          : null,
        modelPrefixes.length ? modelPrefixes.join(", ") : null,
      ]
        .filter(Boolean)
        .join(" · "),
    };
  }

  return {
    label:
      connection.status === "revoked"
        ? tr("routeSummary.revokedLabel")
        : tr("routeSummary.fallbackOnlyLabel"),
    detail:
      connection.status === "revoked"
        ? tr("routeSummary.revokedDetail")
        : tr("routeSummary.providerDefaultDetail", {
            provider: getProviderKindLabel(connection.provider, tr),
          }),
  };
}

function getConnectionHealthState(
  connection: ProviderConnection,
  ambiguousConflictCount: number,
  tr: ProviderTranslator,
  locale: ReturnType<typeof useLocalePreference>["locale"],
) {
  if (connection.status === "revoked") {
    return {
      status: "paused" as const,
      label: tr("health.revokedLabel"),
      detail:
        formatLocalizedDateTime(connection.revokedAt, locale)
          ? tr("health.revokedDetail", {
              date: formatLocalizedDateTime(connection.revokedAt, locale) ?? "",
            })
          : tr("health.revokedDetailFallback"),
    };
  }

  if (ambiguousConflictCount > 0) {
    return {
      status: "critical" as const,
      label: tr("health.routingConflictLabel"),
      detail: tr("health.routingConflictDetail", {
        count: ambiguousConflictCount,
      }),
    };
  }

  if (connection.lastTestStatus === "failed") {
    return {
      status: "error" as const,
      label: tr("health.testFailedLabel"),
      detail: connection.lastTestError ?? tr("health.testFailedFallback"),
    };
  }

  if (!connection.lastTestedAt) {
    return {
      status: "warning" as const,
      label: tr("health.notTestedLabel"),
      detail: tr("health.notTestedDetail"),
    };
  }

  const daysSince = getDaysSince(connection.lastTestedAt);
  if (daysSince !== null && daysSince >= 14) {
    return {
      status: "warning" as const,
      label: tr("health.staleCheckLabel"),
      detail: tr("health.staleCheckDetail", { count: daysSince }),
    };
  }

  if (connection.lastTestStatus === "passed") {
    return {
      status: "healthy" as const,
      label: tr("health.healthyLabel"),
      detail: tr("health.healthyDetail", {
        latency:
          connection.lastTestLatencyMs !== null
            ? `${connection.lastTestLatencyMs} ms`
            : tr("health.noLatency"),
        date:
          formatLocalizedDateTime(connection.lastTestedAt, locale) ??
          tr("date.notYet"),
      }),
    };
  }

  return {
    status: "default" as const,
    label: tr("health.unknownLabel"),
    detail:
      formatLocalizedDateTime(connection.lastTestedAt, locale) ??
      tr("date.notYet"),
  };
}

function buildProviderConnectionRowModels(args: {
  connections: ProviderConnection[];
  ambiguousConflictCountByConnectionId: Map<string, number>;
  currentPageHref: string;
  locale: ReturnType<typeof useLocalePreference>["locale"];
  tr: ProviderTranslator;
  workspaceId: string;
}): ProviderConnectionRowModel[] {
  return args.connections.map((connection) => {
    const routeSummary = getConnectionRouteSummary(connection, args.tr);
    const ambiguousConflictCount =
      args.ambiguousConflictCountByConnectionId.get(connection.id) ?? 0;
    const healthState = getConnectionHealthState(
      connection,
      ambiguousConflictCount,
      args.tr,
      args.locale,
    );
    const visualMeta = getProviderVisualMetaForConnection(connection);

    return {
      connection,
      connectionUsageHref: buildContextualHref(
        `/usage-events?workspaceId=${encodeURIComponent(args.workspaceId)}&providerConnectionId=${encodeURIComponent(connection.id)}`,
        args.currentPageHref,
      ),
      connectionAuditHref: buildContextualHref(
        `/audit-logs?workspaceId=${encodeURIComponent(args.workspaceId)}&subjectType=provider-connection&subjectId=${encodeURIComponent(connection.id)}`,
        args.currentPageHref,
      ),
      endpoint: describeProviderEndpoint(connection, args.tr),
      healthState,
      routeSummary,
      supportsManagedAdmin: supportsManagedProviderAdmin(connection.provider),
      ambiguousConflictCount,
      visualMeta,
    };
  });
}

type SelectFieldOption = {
  label: string;
  value: string;
};

function FormField({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid content-start gap-1.5">
      <label
        className="ml-0.5 text-[13px] font-bold tracking-tight text-foreground/80"
        htmlFor={htmlFor}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

function SelectField({
  label,
  htmlFor,
  name,
  value,
  defaultValue,
  onValueChange,
  options,
  placeholder,
}: {
  label: string;
  htmlFor: string;
  name?: string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  options: SelectFieldOption[];
  placeholder?: string;
}) {
  return (
    <FormField htmlFor={htmlFor} label={label}>
      <Select
        defaultValue={defaultValue}
        name={name}
        onValueChange={onValueChange}
        value={value}
      >
        <SelectTrigger id={htmlFor}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FormField>
  );
}

export function ProvidersWorkspaceView({
  workspaceId,
  workspaceLabel,
  pageHref,
  initialProviderConnections,
  initialConnectionSearchQuery = "",
  initialConnectionViewFilter = "all",
  initialProviderKindFilter = "all",
}: ProvidersWorkspaceViewProps) {
  const tr = useT("providers");
  const { locale } = useLocalePreference();
  const initialSelectedTemplateId = "anthropic-public";
  const initialTemplate =
    providerTemplateCatalog.find(
      (template) => template.id === initialSelectedTemplateId,
    ) ?? providerTemplateCatalog[0];
  const [providerConnections, setProviderConnections] = useState(
    initialProviderConnections,
  );
  const [selectedTemplateId, setSelectedTemplateId] =
    useState<ProviderTemplateId>(initialTemplate.id);
  const [provider, setProvider] = useState<
    ProviderConnectionFormInput["provider"]
  >(initialTemplate.provider);
  const [label, setLabel] = useState(tr(initialTemplate.labelSuggestionKey));
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [anthropicVersion, setAnthropicVersion] = useState("2023-06-01");
  const [createState, setCreateState] =
    useState<CreateProviderConnectionActionResult>(initialCreateState);
  const [draftTestState, setDraftTestState] =
    useState<TestProviderConnectionActionResult>(initialTestState);
  const [savedTestState, setSavedTestState] =
    useState<TestProviderConnectionActionResult>(initialTestState);
  const [revokeState, setRevokeState] =
    useState<RevokeProviderConnectionActionResult | null>(null);
  const [conflictResolutionState, setConflictResolutionState] =
    useState<ResolveProviderDefaultConflictActionResult | null>(null);
  const [updateState, setUpdateState] =
    useState<UpdateProviderConnectionActionResult | null>(null);
  const [workspaceRemediationState, setWorkspaceRemediationState] = useState<{
    status: "success" | "error";
    message: string;
  } | null>(null);
  const [bulkActionState, setBulkActionState] = useState<{
    status: "success" | "error";
    message: string;
  } | null>(null);
  const createLabelInputRef = useRef<HTMLInputElement>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isCreatePending, setIsCreatePending] = useState(false);
  const [isDraftTestPending, setIsDraftTestPending] = useState(false);
  const [currentCreateStep, setCurrentCreateStep] =
    useState<ProviderCreateStep>("scheme");
  const [completedCreateSteps, setCompletedCreateSteps] = useState<
    ProviderCreateStep[]
  >([]);
  const [testPendingId, setTestPendingId] = useState<string | null>(null);
  const [revokePendingId, setRevokePendingId] = useState<string | null>(null);
  const [updatePendingId, setUpdatePendingId] = useState<string | null>(null);
  const [isWorkspaceRemediationPending, setIsWorkspaceRemediationPending] =
    useState(false);
  const [selectedConnectionIds, setSelectedConnectionIds] = useState<string[]>(
    [],
  );
  const [isBulkTestPending, setIsBulkTestPending] = useState(false);
  const [templateSearchQuery, setTemplateSearchQuery] = useState("");
  const [modelConfig, setModelConfig] = useState<ProviderModelConfig>(
    createProviderModelConfig([]),
  );
  const [draftModelCatalog, setDraftModelCatalog] =
    useState<ProviderConnectionModelCatalog | null>(null);
  const [isDraftModelCatalogPending, setIsDraftModelCatalogPending] =
    useState(false);
  const lastDraftModelCatalogRequestSignatureRef = useRef<string | null>(null);
  const createErrorNoticeRef = useRef<HTMLDivElement | null>(null);
  const [pricingConfig, setPricingConfig] = useState<ProviderPricingConfig>(
    getDefaultPricingConfig(initialTemplate.provider),
  );
  const [pricingConfigValidationMessage, setPricingConfigValidationMessage] =
    useState<string | null>(null);
  const [expandedConnectionId, setExpandedConnectionId] = useState<
    string | null
  >(null);
  const [editingConnectionId, setEditingConnectionId] = useState<string | null>(
    null,
  );
  const [editCatalogRefreshNonce, setEditCatalogRefreshNonce] = useState(0);
  const [connectionSearchQuery, setConnectionSearchQuery] = useState(
    initialConnectionSearchQuery,
  );
  const [connectionViewFilter, setConnectionViewFilter] =
    useState<ProviderConnectionViewFilter>(initialConnectionViewFilter);
  const [providerKindFilter, setProviderKindFilter] =
    useState<ProviderKindFilter>(initialProviderKindFilter);
  const [operationsMode, setOperationsMode] = useState<ProviderOperationsMode>(
    "basic",
  );
  const [isAdvancedDiagnosticsOpen, setIsAdvancedDiagnosticsOpen] =
    useState(false);
  const [isFilterPending, startFilterTransition] = useTransition();
  const normalizedConnectionSearchQuery = connectionSearchQuery.trim().toLowerCase();
  const deferredConnectionSearchQuery = useDeferredValue(
    normalizedConnectionSearchQuery,
  );
  const selectedProviderTemplate = useMemo(
    () =>
      providerTemplateCatalog.find(
        (template) => template.id === selectedTemplateId,
      ) ?? providerTemplateCatalog[0],
    [selectedTemplateId],
  );
  const selectedTemplateVisual = useMemo(
    () => getProviderVisualMetaByTemplateKey(selectedProviderTemplate.visualKey),
    [selectedProviderTemplate.visualKey],
  );
  const selectedPresetModels = useMemo(
    () => getPresetModelsForTemplate(selectedTemplateId),
    [selectedTemplateId],
  );
  const workbenchTemplates = useMemo<ProviderCreateWorkbenchTemplate[]>(
    () =>
      providerTemplateCatalog.map((template) => ({
        id: template.id,
        title: getProviderTemplateTitle(template, tr),
        summary: tr(template.summaryKey),
        helperText: template.helperTextKey ? tr(template.helperTextKey) : null,
        docsUrl: template.docsUrl,
        schemeGroup: template.schemeGroup,
        technicalKindLabel: tr(template.technicalKindLabelKey),
        baseUrlRequirementLabel: template.baseUrlRequirement
          ? tr(
              template.baseUrlRequirement === "required"
                ? "templateMeta.baseUrlRequired"
                : "templateMeta.baseUrlOptional",
            )
          : null,
        sampleModels: template.sampleModels,
        visualMeta: getProviderVisualMetaByTemplateKey(template.visualKey),
      })),
    [tr],
  );
  const groupedWorkbenchTemplates = useMemo<ProviderCreateWorkbenchGroup[]>(
    () =>
      [
        {
          id: "public-provider",
          title: tr("createFlow.schemeGroups.publicProvider.title"),
        },
        {
          id: "private-model-cluster",
          title: tr("createFlow.schemeGroups.privateModelCluster.title"),
        },
        {
          id: "customer-gateway",
          title: tr("createFlow.schemeGroups.customerGateway.title"),
        },
        {
          id: "internal-endpoint",
          title: tr("createFlow.schemeGroups.internalEndpoint.title"),
        },
      ].map((group) => ({
        id: group.id,
        title: group.title,
        description:
          tr(
            providerTemplateCatalog.find(
              (template) => template.schemeGroup === group.id,
            )?.groupDescriptionKey ?? "create.description",
          ) || "",
        templates: workbenchTemplates.filter(
          (template) => template.schemeGroup === group.id,
        ),
      })),
    [tr, workbenchTemplates],
  );
  const selectedTemplateTechnicalKind = useMemo(
    () => tr(selectedProviderTemplate.technicalKindLabelKey),
    [selectedProviderTemplate.technicalKindLabelKey, tr],
  );
  const selectedSchemeGroupTitle = useMemo(() => {
    switch (selectedProviderTemplate.schemeGroup) {
      case "public-provider":
        return tr("createFlow.schemeGroups.publicProvider.title");
      case "private-model-cluster":
        return tr("createFlow.schemeGroups.privateModelCluster.title");
      case "customer-gateway":
        return tr("createFlow.schemeGroups.customerGateway.title");
      case "internal-endpoint":
        return tr("createFlow.schemeGroups.internalEndpoint.title");
      default:
        return tr("create.templateTitle");
    }
  }, [selectedProviderTemplate.schemeGroup, tr]);
  const formDefaults = useMemo(() => getFormDefaults(provider), [provider]);
  const baseUrlRequired =
    provider === "openai-compatible" ||
    Boolean(selectedProviderTemplate.requiresBaseUrl);
  const baseUrlPreview = useMemo(() => {
    const fallbackBaseUrl =
      provider === "anthropic"
        ? "https://api.anthropic.com"
        : provider === "openai"
          ? "https://api.openai.com"
          : "";
    const resolvedBaseUrl = (baseUrl.trim() || fallbackBaseUrl).replace(/\/$/, "");
    if (!resolvedBaseUrl) {
      return null;
    }

    if (provider === "anthropic") {
      return `${resolvedBaseUrl}/v1/messages`;
    }

    return `${resolvedBaseUrl}/chat/completions`;
  }, [baseUrl, provider]);
  const pageReturnTo = useMemo(() => {
    try {
      return getSafeReturnTo(
        new URL(pageHref, "http://localhost").searchParams.get("returnTo"),
      );
    } catch {
      return null;
    }
  }, [pageHref]);
  const currentPageHref = useMemo(
    () =>
      buildProvidersDeskHref({
        workspaceId,
        q: connectionSearchQuery.trim(),
        view: connectionViewFilter,
        kind: providerKindFilter,
        returnTo: pageReturnTo,
      }),
    [
      connectionSearchQuery,
      connectionViewFilter,
      pageReturnTo,
      providerKindFilter,
      workspaceId,
    ],
  );

  useEffect(() => {
    const template =
      providerTemplateCatalog.find(
        (item) => item.id === initialSelectedTemplateId,
      ) ?? providerTemplateCatalog[0];

    setProviderConnections(initialProviderConnections);
    setSelectedTemplateId(template.id);
    setProvider(template.provider);
    setConnectionSearchQuery(initialConnectionSearchQuery);
    setConnectionViewFilter(initialConnectionViewFilter);
    setProviderKindFilter(initialProviderKindFilter);
    setOperationsMode("basic");
    setTemplateSearchQuery("");
    setModelConfig(createProviderModelConfig([]));
    setDraftModelCatalog(null);
    setPricingConfig(getDefaultPricingConfig(template.provider));
    setLabel(tr(template.labelSuggestionKey));
    setApiKey("");
    setBaseUrl("");
    setAnthropicVersion("2023-06-01");
    setCreateState(initialCreateState);
    setDraftTestState(initialTestState);
    setSavedTestState(initialTestState);
    setRevokeState(null);
    setConflictResolutionState(null);
    setUpdateState(null);
    setWorkspaceRemediationState(null);
    setBulkActionState(null);
    setSelectedConnectionIds([]);
    setExpandedConnectionId(null);
    setEditingConnectionId(null);
    setIsCreateOpen(false);
    setCurrentCreateStep("scheme");
    setCompletedCreateSteps([]);
  }, [
    initialConnectionSearchQuery,
    initialConnectionViewFilter,
    initialProviderConnections,
    initialProviderKindFilter,
    tr,
    workspaceId,
  ]);

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

    if (window.location.hash === "#provider-create-panel") {
      setIsCreateOpen(true);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (!isCreateOpen || currentCreateStep !== "connection") {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      createLabelInputRef.current?.focus();
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [currentCreateStep, isCreateOpen]);

  useEffect(() => {
    setDraftModelCatalog(null);
    setDraftTestState(initialTestState);
    lastDraftModelCatalogRequestSignatureRef.current = null;
  }, [provider, apiKey, baseUrl, anthropicVersion]);

  useEffect(() => {
    if (createState.status !== "error") {
      return;
    }

    setCreateState(initialCreateState);
  }, [
    anthropicVersion,
    apiKey,
    baseUrl,
    createState.status,
    label,
    modelConfig,
    pricingConfigValidationMessage,
    provider,
  ]);

  useLayoutEffect(() => {
    if (
      !isCreateOpen ||
      currentCreateStep !== "pricing_review" ||
      createState.status !== "error" ||
      !createState.message
    ) {
      return;
    }

    const errorNotice = createErrorNoticeRef.current;
    if (!errorNotice) {
      return;
    }

    errorNotice.scrollIntoView({
      block: "start",
      behavior: "smooth",
    });

    const focusTimer = window.setTimeout(() => {
      errorNotice.focus();
    }, 80);

    return () => {
      window.clearTimeout(focusTimer);
    };
  }, [createState.message, createState.status, currentCreateStep, isCreateOpen]);

  useEffect(() => {
    setSelectedConnectionIds((currentIds) =>
      currentIds.filter((id) =>
        providerConnections.some(
          (connection) =>
            connection.id === id &&
            connection.status === "active" &&
            supportsManagedProviderAdmin(connection.provider),
        ),
      ),
    );
    setExpandedConnectionId((currentId) =>
      currentId &&
      providerConnections.some((connection) => connection.id === currentId)
        ? currentId
        : null,
    );
    setEditingConnectionId((currentId) =>
      currentId &&
      providerConnections.some((connection) => connection.id === currentId)
        ? currentId
        : null,
    );
  }, [providerConnections]);

  useEffect(() => {
    if (operationsMode !== "advanced") {
      setSelectedConnectionIds([]);
      setIsAdvancedDiagnosticsOpen(false);
    }
  }, [operationsMode]);

  useEffect(() => {
    setEditingConnectionId((currentId) =>
      currentId && currentId === expandedConnectionId ? currentId : null,
    );
  }, [expandedConnectionId]);

  function toggleExpandedConnection(connectionId: string) {
    setExpandedConnectionId((currentId) =>
      currentId === connectionId ? null : connectionId,
    );
  }

  function handleConnectionRowKeyDown(
    event: KeyboardEvent<HTMLTableRowElement>,
    connectionId: string,
  ) {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    toggleExpandedConnection(connectionId);
  }

  function stopRowToggle(event: MouseEvent<HTMLElement>) {
    event.stopPropagation();
  }

  const keysHref = useMemo(
    () =>
      buildContextualHref(
        `/virtual-keys?workspaceId=${encodeURIComponent(workspaceId)}`,
        currentPageHref,
      ),
    [currentPageHref, workspaceId],
  );

  const routingDefaultsSummary = useMemo(
    () => buildWorkspaceRoutingDefaultsSummary(providerConnections),
    [providerConnections],
  );
  const routingDiagnostics = useMemo(
    () => buildWorkspaceRoutingDiagnostics(providerConnections),
    [providerConnections],
  );
  const ambiguousConflictCountByConnectionId = useMemo(() => {
    const counts = new Map<string, number>();

    for (const conflict of routingDiagnostics.ambiguousRoutingConflicts) {
      for (const match of conflict.candidates) {
        counts.set(
          match.id,
          (counts.get(match.id) ?? 0) + 1,
        );
      }
    }

    return counts;
  }, [routingDiagnostics]);
  const selectedConnectionIdSet = useMemo(
    () => new Set(selectedConnectionIds),
    [selectedConnectionIds],
  );
  const {
    filteredActiveProviderConnections,
    filteredRevokedProviderConnections,
    hiddenSelectedConnectionCount,
    prioritizedActiveProviderConnections,
    prioritizedRevokedProviderConnections,
    readyConnectionCount,
    revokedConnectionCount,
    selectableVisibleConnectionIds,
    selectedVisibleConnectionIds,
    attentionConnectionCount,
  } = useMemo(() => {
    const needsAttention = (connection: ProviderConnection) =>
      connectionNeedsAttention(connection) ||
      (ambiguousConflictCountByConnectionId.get(connection.id) ?? 0) > 0;

    const matchesConnectionSearch = (connection: ProviderConnection) => {
      if (!deferredConnectionSearchQuery) {
        return true;
      }

      const routingTargets = getConnectionRoutingTargetSet(connection);
      const searchIndex = [
        connection.label,
        connection.provider,
        getProviderKindLabel(connection.provider, tr),
        connection.status,
        connection.lastTestStatus ?? "",
        describeProviderEndpoint(connection, tr),
        routingTargets.exactModels.join(" "),
        routingTargets.modelPrefixes.join(" "),
        getPreferredMetadataValue(connection.metadata, ["defaultForProtocol"]),
      ]
        .join(" ")
        .toLowerCase();

      return searchIndex.includes(deferredConnectionSearchQuery);
    };

    const nextSearchScopedConnections = providerConnections.filter(
      (connection) =>
        (providerKindFilter === "all" ||
          connection.provider === providerKindFilter) &&
        matchesConnectionSearch(connection),
    );
    const nextSearchScopedActiveConnections = nextSearchScopedConnections.filter(
      (connection) => connection.status !== "revoked",
    );
    const nextSearchScopedRevokedConnections = nextSearchScopedConnections.filter(
      (connection) => connection.status === "revoked",
    );
    const nextFilteredActiveProviderConnections = nextSearchScopedActiveConnections.filter(
      (connection) => {
        if (connectionViewFilter === "ready") {
          return (
            connection.status === "active" &&
            connection.lastTestStatus === "passed" &&
            !needsAttention(connection)
          );
        }

        if (connectionViewFilter === "attention") {
          return needsAttention(connection);
        }

        if (connectionViewFilter === "revoked") {
          return false;
        }

        return true;
      },
    );
    const nextPrioritizedActiveProviderConnections = [
      ...nextFilteredActiveProviderConnections,
    ].sort((left, right) => {
      const leftConflictCount = ambiguousConflictCountByConnectionId.get(left.id) ?? 0;
      const rightConflictCount = ambiguousConflictCountByConnectionId.get(right.id) ?? 0;
      if (leftConflictCount !== rightConflictCount) {
        return rightConflictCount - leftConflictCount;
      }

      const leftAttention = needsAttention(left) ? 1 : 0;
      const rightAttention = needsAttention(right) ? 1 : 0;
      if (leftAttention !== rightAttention) {
        return rightAttention - leftAttention;
      }

      const leftActive = left.status === "active" ? 1 : 0;
      const rightActive = right.status === "active" ? 1 : 0;
      if (leftActive !== rightActive) {
        return rightActive - leftActive;
      }

      return (
        new Date(right.updatedAt).getTime() -
        new Date(left.updatedAt).getTime()
      );
    });
    const nextPrioritizedRevokedProviderConnections = [
      ...nextSearchScopedRevokedConnections,
    ].sort((left, right) => {
      const leftRevokedAt = left.revokedAt ? new Date(left.revokedAt).getTime() : 0;
      const rightRevokedAt = right.revokedAt ? new Date(right.revokedAt).getTime() : 0;
      if (leftRevokedAt !== rightRevokedAt) {
        return rightRevokedAt - leftRevokedAt;
      }

      return (
        new Date(right.updatedAt).getTime() -
        new Date(left.updatedAt).getTime()
      );
    });
    const nextSelectableVisibleConnectionIds =
      nextPrioritizedActiveProviderConnections
        .filter(
          (connection) =>
            connection.status === "active" &&
            supportsManagedProviderAdmin(connection.provider),
        )
        .map((connection) => connection.id);
    const nextSelectedVisibleConnectionIds =
      nextSelectableVisibleConnectionIds.filter((id) =>
        selectedConnectionIdSet.has(id),
      );

    return {
      filteredActiveProviderConnections: nextFilteredActiveProviderConnections,
      filteredRevokedProviderConnections: nextSearchScopedRevokedConnections,
      prioritizedActiveProviderConnections: nextPrioritizedActiveProviderConnections,
      prioritizedRevokedProviderConnections: nextPrioritizedRevokedProviderConnections,
      selectableVisibleConnectionIds: nextSelectableVisibleConnectionIds,
      selectedVisibleConnectionIds: nextSelectedVisibleConnectionIds,
      hiddenSelectedConnectionCount: Math.max(
        0,
        selectedConnectionIds.length - nextSelectedVisibleConnectionIds.length,
      ),
      readyConnectionCount: providerConnections.filter(
        (connection) =>
          connection.status === "active" &&
          connection.lastTestStatus === "passed" &&
          !needsAttention(connection),
      ).length,
      attentionConnectionCount: providerConnections.filter((connection) =>
        needsAttention(connection),
      ).length,
      revokedConnectionCount: providerConnections.filter(
        (connection) => connection.status === "revoked",
      ).length,
    };
  }, [
    ambiguousConflictCountByConnectionId,
    connectionViewFilter,
    deferredConnectionSearchQuery,
    providerConnections,
    providerKindFilter,
    selectedConnectionIdSet,
    selectedConnectionIds.length,
  ]);
  const hasActiveFilters =
    Boolean(connectionSearchQuery.trim()) ||
    providerKindFilter !== "all" ||
    connectionViewFilter !== "all";
  const isFiltersBusy =
    isFilterPending ||
    normalizedConnectionSearchQuery !== deferredConnectionSearchQuery;
  const filterSignature = `${deferredConnectionSearchQuery}|${providerKindFilter}|${connectionViewFilter}`;
  const activeFilterCount =
    Number(Boolean(connectionSearchQuery.trim())) +
    Number(providerKindFilter !== "all") +
    Number(connectionViewFilter !== "all");
  const providerCountByKind = useMemo(
    () => ({
      all: providerConnections.length,
      anthropic: providerConnections.filter((connection) => connection.provider === "anthropic").length,
      openai: providerConnections.filter((connection) => connection.provider === "openai").length,
      "openai-compatible": providerConnections.filter((connection) => connection.provider === "openai-compatible").length,
    }),
    [providerConnections],
  );
  const showBulkControls = operationsMode === "advanced";
  const selectedConnectionCount = selectedConnectionIds.length;
  const presentedActiveProviderConnections = useMemo<ProviderConnectionRowModel[]>(
    () =>
      buildProviderConnectionRowModels({
        connections: prioritizedActiveProviderConnections,
        ambiguousConflictCountByConnectionId,
        currentPageHref,
        locale,
        tr,
        workspaceId,
      }),
    [
      ambiguousConflictCountByConnectionId,
      currentPageHref,
      locale,
      prioritizedActiveProviderConnections,
      tr,
      workspaceId,
    ],
  );
  const presentedRevokedProviderConnections = useMemo<ProviderConnectionRowModel[]>(
    () =>
      buildProviderConnectionRowModels({
        connections: prioritizedRevokedProviderConnections,
        ambiguousConflictCountByConnectionId,
        currentPageHref,
        locale,
        tr,
        workspaceId,
      }),
    [
      ambiguousConflictCountByConnectionId,
      currentPageHref,
      locale,
      prioritizedRevokedProviderConnections,
      tr,
      workspaceId,
    ],
  );
  const globalMessages = useMemo(
    () =>
      [
        !isCreateOpen && createState.status !== "idle"
          ? {
              key: "provider-create",
              label: tr("create.noticeCreate"),
              status: createState.status,
              message: createState.message ?? "",
            }
          : null,
        workspaceRemediationState
          ? {
              key: "workspace-remediation",
              label: tr("Workspace"),
              status: workspaceRemediationState.status,
              message: workspaceRemediationState.message,
            }
          : null,
        bulkActionState
          ? {
              key: "bulk-action",
              label: tr("Bulk action"),
              status: bulkActionState.status,
              message: bulkActionState.message,
            }
          : null,
      ].filter((message): message is InlineMessage => Boolean(message)),
    [bulkActionState, createState, isCreateOpen, tr, workspaceRemediationState],
  );
  const editingConnection = useMemo(
    () =>
      editingConnectionId
        ? providerConnections.find((connection) => connection.id === editingConnectionId) ?? null
        : null,
    [editingConnectionId, providerConnections],
  );

  function handleEditDialogOpenChange(open: boolean) {
    if (!open) {
      setUpdateState(null);
      setEditingConnectionId(null);
      setEditCatalogRefreshNonce(0);
    }
  }

  function getConnectionInlineMessage(connectionId: string): InlineMessage | null {
    if (savedTestState.connection?.id === connectionId && savedTestState.status !== "idle") {
      return {
        key: `saved-test-${connectionId}`,
        label: tr("table.actions.retest"),
        status: savedTestState.status === "success" ? "success" : "error",
        message: savedTestState.message,
        detail: savedTestState.result
          ? `HTTP ${savedTestState.result.statusCode ?? tr("common.na")} · ${savedTestState.result.latencyMs ?? tr("common.na")} ms`
          : null,
      };
    }

    if (revokeState?.connection?.id === connectionId) {
      return {
        key: `revoke-${connectionId}`,
        label: tr("table.actions.revoke"),
        status: revokeState.status,
        message: revokeState.message,
      };
    }

    if (updateState?.connection?.id === connectionId) {
      return {
        key: `update-${connectionId}`,
        label: tr("Update"),
        status: updateState.status,
        message: updateState.message,
      };
    }

    if (conflictResolutionState?.connections?.some((item) => item.id === connectionId)) {
      return {
        key: `routing-${connectionId}`,
        label: tr("Routing"),
        status: conflictResolutionState.status,
        message: conflictResolutionState.message,
      };
    }

    return null;
  }

  function clearCreateFeedback() {
    setCreateState(initialCreateState);
    setDraftTestState(initialTestState);
  }

  function clearGlobalFeedback() {
    setSavedTestState(initialTestState);
    setRevokeState(null);
    setConflictResolutionState(null);
    setUpdateState(null);
    setWorkspaceRemediationState(null);
    setBulkActionState(null);
  }

  function resetCreateForm() {
    setSelectedTemplateId(initialTemplate.id);
    setProvider(initialTemplate.provider);
    setTemplateSearchQuery("");
    setLabel(tr(initialTemplate.labelSuggestionKey));
    setApiKey("");
    setBaseUrl("");
    setAnthropicVersion("2023-06-01");
    setModelConfig(createProviderModelConfig([]));
    setDraftModelCatalog(null);
    setPricingConfig(getDefaultPricingConfig(initialTemplate.provider));
    setPricingConfigValidationMessage(null);
    setCurrentCreateStep("scheme");
    setCompletedCreateSteps([]);
  }

  function markCreateStepCompleted(step: ProviderCreateStep) {
    setCompletedCreateSteps((currentSteps) =>
      currentSteps.includes(step) ? currentSteps : [...currentSteps, step],
    );
  }

  function getCreateStepIndex(step: ProviderCreateStep) {
    return providerCreateStepOrder.indexOf(step);
  }

  function handleCreateStepChange(step: ProviderCreateStep) {
    if (step === currentCreateStep) {
      return;
    }

    if (getCreateStepIndex(step) < getCreateStepIndex(currentCreateStep)) {
      setCurrentCreateStep(step);
      return;
    }

    if (completedCreateSteps.includes(step)) {
      setCurrentCreateStep(step);
    }
  }

  function handleCreateStepBack() {
    const currentStepIndex = getCreateStepIndex(currentCreateStep);
    if (currentStepIndex <= 0) {
      return;
    }

    setCurrentCreateStep(providerCreateStepOrder[currentStepIndex - 1]!);
  }

  function handleCreateStepNext() {
    if (currentCreateStep === "scheme") {
      markCreateStepCompleted("scheme");
      setCurrentCreateStep("connection");
      return;
    }

    if (currentCreateStep === "connection") {
      const validationMessage = getCreateValidationMessage();
      if (validationMessage) {
        setCreateState({
          status: "error",
          message: validationMessage,
          connection: null,
        });
        return;
      }

      markCreateStepCompleted("connection");
      setCurrentCreateStep("routing");
      return;
    }

    if (currentCreateStep === "routing") {
      markCreateStepCompleted("routing");
      setCurrentCreateStep("pricing_review");
    }
  }

  function buildFormInput(): ProviderConnectionFormInput {
    return {
      workspaceId,
      provider,
      label,
      apiKey,
      baseUrl,
      anthropicVersion,
      defaultForProtocol: "none",
      modelConfigJson: buildProviderModelConfigJson(modelConfig),
      pricingConfig,
    };
  }

  function getCreateValidationMessage() {
    if (!label.trim()) {
      return tr("validation.labelRequired");
    }

    if (!apiKey.trim()) {
      return tr("validation.apiKeyRequired");
    }

    if (baseUrlRequired && !baseUrl.trim()) {
      return tr("validation.baseUrlRequired");
    }

    if (pricingConfigValidationMessage) {
      return pricingConfigValidationMessage;
    }

    return null;
  }

  function handleTemplateSelect(templateId: ProviderTemplateId) {
    const nextTemplate = providerTemplateCatalog.find(
      (template) => template.id === templateId,
    );
    if (!nextTemplate) {
      return;
    }

    const currentDefaultLabel = tr(selectedProviderTemplate.labelSuggestionKey);
    setSelectedTemplateId(templateId);
    setProvider(nextTemplate.provider);
    if (!label.trim() || label.trim() === currentDefaultLabel) {
      setLabel(tr(nextTemplate.labelSuggestionKey));
    }
    setModelConfig(createProviderModelConfig([]));
    setDraftModelCatalog(null);
    setPricingConfig(getDefaultPricingConfig(nextTemplate.provider));
    setPricingConfigValidationMessage(null);
    clearCreateFeedback();
    clearGlobalFeedback();
  }

  function handleCreateSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (currentCreateStep !== "pricing_review") {
      return;
    }

    const validationMessage = getCreateValidationMessage();
    if (validationMessage) {
      setCreateState({
        status: "error",
        message: validationMessage,
        connection: null,
      });
      return;
    }

    setIsCreatePending(true);
    clearCreateFeedback();
    clearGlobalFeedback();

    startTransition(async () => {
      const result = await createProviderConnectionAction(buildFormInput());
      setCreateState(result);
      setIsCreatePending(false);

      if (result.status !== "success") {
        return;
      }

      setProviderConnections((currentConnections) => [
        result.connection,
        ...currentConnections.filter(
          (connection) => connection.id !== result.connection.id,
        ),
      ]);
      setExpandedConnectionId(result.connection.id);
      setIsCreateOpen(false);
      resetCreateForm();
    });
  }

  function handleDraftTest() {
    const validationMessage = getCreateValidationMessage();
    if (validationMessage) {
      setDraftTestState({
        status: "error",
        message: validationMessage,
        result: null,
        connection: null,
      });
      return;
    }

    setIsDraftTestPending(true);
    clearCreateFeedback();
    clearGlobalFeedback();

    startTransition(async () => {
      const result = await testProviderConnectionDraftAction(buildFormInput());
      setDraftTestState(result);
      setIsDraftTestPending(false);
    });
  }

  async function handleDraftModelCatalogLoad() {
    if (
      provider !== "anthropic" &&
      provider !== "openai" &&
      provider !== "openai-compatible"
    ) {
      return;
    }

    if (!apiKey.trim()) {
      setCreateState({
        status: "error",
        message: tr("validation.apiKeyRequired"),
        connection: null,
      });
      return;
    }

    if (baseUrlRequired && !baseUrl.trim()) {
      setCreateState({
        status: "error",
        message: tr("validation.baseUrlRequired"),
        connection: null,
      });
      return;
    }

    setIsDraftModelCatalogPending(true);
    clearCreateFeedback();
    clearGlobalFeedback();

    try {
      const result = await fetchProviderConnectionModelCatalogPreview({
        workspaceId,
        provider,
        label,
        apiKey,
        baseUrl,
        anthropicVersion,
      });
      setDraftModelCatalog(
        ProviderConnectionModelCatalogSchema.parse(result),
      );
    } catch (error) {
      const message =
        error instanceof Error &&
        error.message === "OpenAI-compatible provider connections require a base URL"
          ? tr("modelManager.catalogBaseUrlRequiredError")
          : error instanceof Error
            ? error.message
            : tr("modelManager.catalogError");
      setDraftModelCatalog({
        providerConnectionId: null,
        fetchedAt: new Date().toISOString(),
        status: "error",
        errorCode: null,
        message,
        items: [],
      });
    } finally {
      setIsDraftModelCatalogPending(false);
    }
  }

  useEffect(() => {
    if (!isCreateOpen || currentCreateStep !== "routing") {
      return;
    }

    if (
      provider !== "anthropic" &&
      provider !== "openai" &&
      provider !== "openai-compatible"
    ) {
      return;
    }

    if (!apiKey.trim()) {
      return;
    }

    if (baseUrlRequired && !baseUrl.trim()) {
      return;
    }

    const requestSignature = [
      provider,
      apiKey.trim(),
      baseUrl.trim(),
      anthropicVersion.trim(),
    ].join("|");

    if (
      isDraftModelCatalogPending ||
      lastDraftModelCatalogRequestSignatureRef.current === requestSignature
    ) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      lastDraftModelCatalogRequestSignatureRef.current = requestSignature;
      void handleDraftModelCatalogLoad();
    }, 300);

    return () => window.clearTimeout(timeoutId);
  }, [
    anthropicVersion,
    apiKey,
    baseUrl,
    baseUrlRequired,
    currentCreateStep,
    isCreateOpen,
    isDraftModelCatalogPending,
    provider,
  ]);

  function handleSavedTest(providerConnectionId: string) {
    setTestPendingId(providerConnectionId);
    clearCreateFeedback();
    clearGlobalFeedback();
    setExpandedConnectionId(providerConnectionId);

    startTransition(async () => {
      const result = await testProviderConnectionAction(
        workspaceId,
        providerConnectionId,
      );
      setTestPendingId(null);
      setSavedTestState(result);

      if (!result.connection) {
        return;
      }

      setProviderConnections((currentConnections) =>
        currentConnections.map((connection) =>
          connection.id === result.connection?.id
            ? result.connection
            : connection,
        ),
      );
    });
  }

  function toggleConnectionSelection(connectionId: string) {
    setSelectedConnectionIds((currentIds) =>
      currentIds.includes(connectionId)
        ? currentIds.filter((id) => id !== connectionId)
        : [...currentIds, connectionId],
    );
  }

  function replaceSelectedConnections(connectionIds: string[]) {
    setSelectedConnectionIds(connectionIds);
  }

  function handleBulkRetestSelected() {
    if (!selectedConnectionIds.length) {
      return;
    }

    setIsBulkTestPending(true);
    clearCreateFeedback();
    clearGlobalFeedback();

    startTransition(async () => {
      const queuedConnections = providerConnections.filter(
        (connection) =>
          selectedConnectionIds.includes(connection.id) &&
          connection.status === "active" &&
          supportsManagedProviderAdmin(connection.provider),
      );

      const updatedConnections = new Map(
        providerConnections.map((connection) => [connection.id, connection]),
      );
      let successCount = 0;
      let failureCount = 0;
      const failedLabels: string[] = [];

      for (const connection of queuedConnections) {
        const result = await testProviderConnectionAction(
          workspaceId,
          connection.id,
        );
        if (result.connection) {
          updatedConnections.set(result.connection.id, result.connection);
        }

        if (result.status === "success") {
          successCount += 1;
          continue;
        }

        failureCount += 1;
        failedLabels.push(connection.label);
      }

      setProviderConnections((currentConnections) =>
        currentConnections.map(
          (connection) => updatedConnections.get(connection.id) ?? connection,
        ),
      );
      setIsBulkTestPending(false);
      setSelectedConnectionIds([]);
      setBulkActionState({
        status: failureCount ? "error" : "success",
        message: failureCount
          ? tr("bulk.retestedWithFailures", {
              count: successCount + failureCount,
              failureCount,
              labels: failedLabels.join(", "),
            })
          : tr("bulk.retestedSuccess", {
              count: successCount,
            }),
      });
    });
  }

  function handleRevoke(providerConnectionId: string) {
    setRevokePendingId(providerConnectionId);
    clearCreateFeedback();
    clearGlobalFeedback();
    setExpandedConnectionId(providerConnectionId);

    startTransition(async () => {
      const result = await revokeProviderConnectionAction(workspaceId, providerConnectionId);
      setRevokePendingId(null);
      setRevokeState(result);

      if (result.status !== "success") {
        return;
      }

      setProviderConnections((currentConnections) =>
        currentConnections.map((connection) =>
          connection.id === result.connection.id
            ? result.connection
            : connection,
        ),
      );
    });
  }

  function handleConnectionUpdate(
    event: FormEvent<HTMLFormElement>,
    connection: ProviderConnection,
  ) {
    event.preventDefault();
    setUpdatePendingId(connection.id);
    clearCreateFeedback();
    clearGlobalFeedback();
    setExpandedConnectionId(connection.id);

    const formData = new FormData(event.currentTarget);
    const nextLabel = String(formData.get("label") ?? "");
    const nextBaseUrl = String(formData.get("baseUrl") ?? "");
    const nextAnthropicVersion = String(formData.get("anthropicVersion") ?? "");
    const nextDefaultForProtocol = String(
      formData.get("defaultForProtocol") ?? "none",
    ) as ProviderConnectionFormInput["defaultForProtocol"];
    const nextModelPrefixes = String(formData.get("modelPrefixes") ?? "");
    const nextModelConfigJson = String(formData.get("modelConfigJson") ?? "");
    const nextApiKey = String(formData.get("newApiKey") ?? "");
    const credentialRecoveryRequired =
      String(formData.get("credentialRecoveryRequired") ?? "") === "true";
    let nextPricingConfig: ProviderPricingConfig;

    if (credentialRecoveryRequired && !nextApiKey.trim()) {
      setUpdatePendingId(null);
      setUpdateState({
        status: "error",
        message:
          locale.startsWith("zh")
            ? "请先重新填写 Provider API key，再保存这个连接。"
            : "Re-enter the provider API key before saving this connection.",
        connection: null,
      });
      return;
    }

    try {
      nextPricingConfig = parsePricingConfigJson(formData.get("pricingConfigJson"));
    } catch (error) {
      setUpdatePendingId(null);
      setUpdateState({
        status: "error",
        message:
          error instanceof Error ? error.message : "Invalid pricing config",
        connection: null,
      });
      return;
    }

    startTransition(async () => {
      const result = await updateProviderConnectionAction(workspaceId, connection.id, {
        workspaceId,
        provider: connection.provider,
        label: nextLabel,
        apiKey: "",
        baseUrl: nextBaseUrl,
        anthropicVersion: nextAnthropicVersion,
        defaultForProtocol: nextDefaultForProtocol,
        modelPrefixes: nextModelPrefixes,
        modelConfigJson: nextModelConfigJson,
        pricingConfig: nextPricingConfig,
        existingMetadata: connection.metadata,
        newApiKey: nextApiKey,
      });
      setUpdatePendingId(null);
      setUpdateState(result);

      if (result.status !== "success") {
        return;
      }

      setProviderConnections((currentConnections) =>
        currentConnections.map((item) =>
          item.id === result.connection.id ? result.connection : item,
        ),
      );
      if (nextApiKey.trim()) {
        setEditCatalogRefreshNonce((currentNonce) => currentNonce + 1);
        return;
      }

      setEditingConnectionId(null);
    });
  }

  function handleApplyRecommendedDefault(connection: ProviderConnection) {
    setUpdatePendingId(connection.id);
    clearCreateFeedback();
    clearGlobalFeedback();

    startTransition(async () => {
      const result = await updateProviderConnectionAction(workspaceId, connection.id, {
        workspaceId,
        provider: connection.provider,
        label: connection.label,
        apiKey: "",
        baseUrl: connection.baseUrl ?? "",
        anthropicVersion: connection.anthropicVersion ?? "",
        defaultForProtocol: "provider",
        modelPrefixes: getPreferredMetadataValue(connection.metadata, [
          "modelPrefixes",
          "defaultModelPrefixes",
          "routing.modelPrefixes",
        ]),
        modelConfigJson:
          connection.metadata["ui.modelConfig"] ?? "",
        models: getPreferredMetadataValue(connection.metadata, ["models", "defaultModels", "routing.models"]),
        existingMetadata: connection.metadata,
      });

      setUpdatePendingId(null);
      setUpdateState(result);

      if (result.status !== "success") {
        return;
      }

      setProviderConnections((currentConnections) =>
        currentConnections.map((item) =>
          item.id === result.connection.id ? result.connection : item,
        ),
      );
    });
  }

  function handleResolveDefaultConflict(
    protocol: "anthropic" | "openai-compatible",
    keepConnection: ProviderConnection,
  ) {
    setUpdatePendingId(keepConnection.id);
    clearCreateFeedback();
    clearGlobalFeedback();

    startTransition(async () => {
      const result = await resolveProviderProtocolDefaultConflictAction({
        workspaceId,
        protocol,
        keepConnectionId: keepConnection.id,
        connections: providerConnections,
      });

      setUpdatePendingId(null);
      setConflictResolutionState(result);

      if (result.status !== "success") {
        return;
      }

      const updatedById = new Map(
        result.connections.map((connection) => [connection.id, connection]),
      );
      setProviderConnections((currentConnections) =>
        currentConnections.map(
          (connection) => updatedById.get(connection.id) ?? connection,
        ),
      );
    });
  }

  function handleApplyWorkspaceRecommendations(
    recommendations: AdvancedRoutingRecommendation[],
  ) {
    if (!recommendations.length) {
      setWorkspaceRemediationState({
        status: "error",
        message: tr("advancedTools.noSuggestions"),
      });
      return;
    }

    setIsWorkspaceRemediationPending(true);
    clearCreateFeedback();
    clearGlobalFeedback();

    startTransition(async () => {
      let latestConnections = providerConnections;

      for (const recommendation of recommendations) {
        if (recommendation.kind === "resolve-conflict") {
          const result = await resolveProviderProtocolDefaultConflictAction({
            workspaceId,
            protocol: recommendation.protocol,
            keepConnectionId: recommendation.connection.id,
            connections: latestConnections,
          });

          if (result.status !== "success") {
            setIsWorkspaceRemediationPending(false);
            setWorkspaceRemediationState({
              status: "error",
              message: result.message,
            });
            return;
          }

          const updatedById = new Map(
            result.connections.map((connection) => [connection.id, connection]),
          );
          latestConnections = latestConnections.map(
            (connection) => updatedById.get(connection.id) ?? connection,
          );
          continue;
        }

        const result = await updateProviderConnectionAction(
          workspaceId,
          recommendation.connection.id,
          {
            workspaceId,
            provider: recommendation.connection.provider,
            label: recommendation.connection.label,
            apiKey: "",
            baseUrl: recommendation.connection.baseUrl ?? "",
            anthropicVersion: recommendation.connection.anthropicVersion ?? "",
            defaultForProtocol: "provider",
            modelPrefixes: getPreferredMetadataValue(
              recommendation.connection.metadata,
              [
                "modelPrefixes",
                "defaultModelPrefixes",
                "routing.modelPrefixes",
              ],
            ),
            modelConfigJson:
              recommendation.connection.metadata["ui.modelConfig"] ?? "",
            models: getPreferredMetadataValue(recommendation.connection.metadata, [
              "models",
              "defaultModels",
              "routing.models",
            ]),
            existingMetadata: recommendation.connection.metadata,
          },
        );

        if (result.status !== "success") {
          setIsWorkspaceRemediationPending(false);
          setWorkspaceRemediationState({
            status: "error",
            message: result.message,
          });
          return;
        }

        latestConnections = latestConnections.map((connection) =>
          connection.id === result.connection.id
            ? result.connection
            : connection,
        );
      }

      setIsWorkspaceRemediationPending(false);
      setProviderConnections(latestConnections);
      setWorkspaceRemediationState({
        status: "success",
        message: tr("advancedTools.appliedSuggestions", {
          count: recommendations.length,
        }),
      });
    });
  }

  function resetConnectionFilters() {
    startFilterTransition(() => {
      setConnectionSearchQuery("");
      setConnectionViewFilter("all");
      setProviderKindFilter("all");
    });
  }

  function openCreatePanel() {
    setIsCreateOpen(true);
  }

  function handleSetConnectionViewFilter(nextView: ProviderConnectionViewFilter) {
    startFilterTransition(() => {
      setConnectionViewFilter(nextView);
    });
  }

  function handleSetProviderKindFilter(nextKind: ProviderKindFilter) {
    startFilterTransition(() => {
      setProviderKindFilter(nextKind);
    });
  }

  function handleCreateDialogOpenChange(nextOpen: boolean) {
    setIsCreateOpen(nextOpen);

    if (nextOpen) {
      return;
    }

    clearCreateFeedback();
    resetCreateForm();
    setIsCreatePending(false);
    setIsDraftTestPending(false);
  }

  const draftTestDetail = draftTestState.result
    ? `HTTP ${draftTestState.result.statusCode ?? tr("common.na")} · ${draftTestState.result.latencyMs ?? tr("common.na")} ms`
    : null;

  const providerCreatePanelContent = (
    <ProviderCreateWorkbench
      anthropicVersion={anthropicVersion}
      apiKey={apiKey}
      apiKeyPlaceholder={formDefaults.apiKeyPlaceholder}
      baseUrl={baseUrl}
      baseUrlHelp={tr(formDefaults.baseUrlHelp)}
      baseUrlPlaceholder={tr(formDefaults.baseUrlPlaceholder)}
      baseUrlPreview={baseUrlPreview}
      baseUrlRequirementLabel={tr(
        baseUrlRequired
          ? "templateMeta.baseUrlRequired"
          : "templateMeta.baseUrlOptional",
      )}
      baseUrlRequired={baseUrlRequired}
      canLoadCatalog={Boolean(
        apiKey.trim() && (!baseUrlRequired || baseUrl.trim()),
      )}
      catalog={draftModelCatalog}
      catalogDisabledReason={getDraftCatalogDisabledReason({
        tr,
        apiKey,
        baseUrl,
        baseUrlRequired,
      })}
      completedSteps={completedCreateSteps}
      createNotice={
        createState.status === "error" && createState.message ? (
          <ResourceInlineNotice
            ref={createErrorNoticeRef}
            label={tr("create.noticeCreate")}
            message={tr(createState.message)}
            tone="error"
          />
        ) : null
      }
      currentStep={currentCreateStep}
      docsUrl={selectedProviderTemplate.docsUrl}
      draftTestNotice={
        draftTestState.message ? (
          <ResourceInlineNotice
            className="rounded-2xl border-border/45"
            detail={draftTestDetail}
            label={tr("create.noticeDraftTest")}
            message={tr(draftTestState.message)}
            tone={draftTestState.status === "error" ? "error" : "success"}
          />
        ) : null
      }
      draftTestDetail={draftTestDetail}
      draftTestMessage={draftTestState.message}
      draftTestStatus={draftTestState.status === "error" ? "error" : draftTestState.status === "success" ? "success" : "idle"}
      formId="provider-create-form"
      groupedTemplates={groupedWorkbenchTemplates}
      helperText={
        selectedProviderTemplate.helperTextKey
          ? tr(selectedProviderTemplate.helperTextKey)
          : null
      }
      isCatalogLoading={isDraftModelCatalogPending}
      label={label}
      labelInputRef={createLabelInputRef}
      labelPlaceholder={tr(selectedProviderTemplate.labelSuggestionKey)}
      modelConfig={modelConfig}
      onAnthropicVersionChange={setAnthropicVersion}
      onApiKeyChange={setApiKey}
      onBaseUrlChange={setBaseUrl}
      onLabelChange={setLabel}
      onLoadCatalog={handleDraftModelCatalogLoad}
      onModelConfigChange={setModelConfig}
      onStepChange={handleCreateStepChange}
      onSubmit={handleCreateSubmit}
      onTemplateSearchQueryChange={setTemplateSearchQuery}
      onTemplateSelect={(templateId) =>
        handleTemplateSelect(templateId as ProviderTemplateId)
      }
      presetModels={selectedPresetModels}
      pricingEditor={
        <ProviderPricingEditor
          key={`create-pricing-${selectedTemplateId}-${provider}`}
          locale={locale}
          metadata={{}}
          onValidationChange={setPricingConfigValidationMessage}
          onValueChange={setPricingConfig}
          provider={provider}
          selectedModels={modelConfig.items}
        />
      }
      selectedTemplateId={selectedTemplateId}
      schemeGroupTitle={selectedSchemeGroupTitle}
      showAnthropicVersion={provider === "anthropic"}
      summary={tr(selectedProviderTemplate.summaryKey)}
      technicalKindLabel={selectedTemplateTechnicalKind}
      templateSearchQuery={templateSearchQuery}
      title={getProviderTemplateTitle(selectedProviderTemplate, tr)}
      visualMeta={selectedTemplateVisual}
    />
  );
  const providerCreateDialogFooter =
    currentCreateStep === "scheme" ? (
      <div className="flex items-center justify-end gap-2">
        <Button onClick={() => handleCreateDialogOpenChange(false)} type="button" variant="ghost">
          {tr("create.close")}
        </Button>
        <Button onClick={handleCreateStepNext} type="button">
          {tr("createFlow.next")}
        </Button>
      </div>
    ) : currentCreateStep === "connection" ? (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button onClick={handleCreateStepBack} type="button" variant="ghost">
          {tr("createFlow.back")}
        </Button>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            disabled={isDraftTestPending}
            onClick={handleDraftTest}
            type="button"
            variant="outline"
          >
            {tr(isDraftTestPending ? "table.actions.testing" : "create.testDraft")}
          </Button>
          <Button onClick={handleCreateStepNext} type="button">
            {tr("createFlow.next")}
          </Button>
        </div>
      </div>
    ) : currentCreateStep === "routing" ? (
      <div className="flex items-center justify-between gap-2">
        <Button onClick={handleCreateStepBack} type="button" variant="ghost">
          {tr("createFlow.back")}
        </Button>
        <Button onClick={handleCreateStepNext} type="button">
          {tr("createFlow.next")}
        </Button>
      </div>
    ) : (
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div
          aria-live="polite"
          className="min-h-5 text-[12px] leading-5 text-[var(--destructive-strong)]"
        >
          {createState.status === "error" && createState.message
            ? tr(createState.message)
            : null}
        </div>
        <div className="flex items-center justify-between gap-2 sm:justify-end">
          <Button onClick={handleCreateStepBack} type="button" variant="ghost">
            {tr("createFlow.back")}
          </Button>
          <Button
            aria-busy={isCreatePending || undefined}
            disabled={isCreatePending}
            form="provider-create-form"
            type="submit"
          >
            {tr(isCreatePending ? "table.actions.saving" : "create.saveConnection")}
          </Button>
        </div>
      </div>
    );
  const showRevokedHistoryOnly = connectionViewFilter === "revoked";
  const shouldRenderActiveInventory =
    !showRevokedHistoryOnly || !providerConnections.length;
  const hasVisibleRevokedHistory =
    filteredRevokedProviderConnections.length > 0;

  const activeInventoryEmptyState = !providerConnections.length ? (
    <div className="px-4 py-10">
      <EmptyState
        action={
          <Button onClick={openCreatePanel} size="sm" type="button">
            {tr("filters.addProvider")}
          </Button>
        }
        description={tr("empty.noInventoryDescription")}
        title={tr("empty.noInventoryTitle")}
      />
    </div>
  ) : !filteredActiveProviderConnections.length ? (
    <div className="px-4 py-10">
      <EmptyState
        action={
          hasActiveFilters ? (
            <Button onClick={resetConnectionFilters} size="sm" type="button" variant="outline">
              {tr("empty.clearFilters")}
            </Button>
          ) : undefined
        }
        description={
          hasVisibleRevokedHistory && !hasActiveFilters
            ? tr("empty.noActiveDescription")
            : tr("empty.noMatchDescription")
        }
        title={
          hasVisibleRevokedHistory && !hasActiveFilters
            ? tr("empty.noActiveTitle")
            : tr("empty.noMatchTitle")
        }
      />
    </div>
  ) : null;

  function renderConnectionTable(
    rowModels: ProviderConnectionRowModel[],
    options: {
      tableKey: string;
      includeSelection?: boolean;
    },
  ) {
    const includeSelection = options.includeSelection ?? false;

    return (
      <div className="motion-enter motion-enter-fast overflow-hidden" key={options.tableKey}>
        <Table className="w-full text-[13px] leading-5">
          <TableHeader className="bg-[color:color-mix(in_srgb,var(--surface-2)_72%,var(--surface-1)_28%)]">
            <TableRow className="hover:bg-transparent">
              {includeSelection ? <TableHead className="w-14">{tr("table.headers.select")}</TableHead> : null}
              <TableHead className="w-[32%]">{tr("table.headers.provider")}</TableHead>
              <TableHead className="w-[20%]">{tr("table.headers.route")}</TableHead>
              <TableHead className="w-[20%]">{tr("table.headers.health")}</TableHead>
              <TableHead className="w-[28%]">{tr("table.headers.updated")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rowModels.map((rowModel) => {
              const {
                connection,
                connectionAuditHref,
                connectionUsageHref,
                endpoint,
                healthState,
                routeSummary,
                supportsManagedAdmin,
                ambiguousConflictCount,
                visualMeta,
              } = rowModel;
              const isSelected = selectedConnectionIds.includes(connection.id);
              const isExpanded = expandedConnectionId === connection.id;
              const isTestPending = testPendingId === connection.id;
              const isRevokePending = revokePendingId === connection.id;
              const inlineMessage = getConnectionInlineMessage(connection.id);

              return (
                <Fragment key={`${connection.id}:${connection.updatedAt}`}>
                  <TableRow
                    aria-expanded={isExpanded}
                    className={cn(
                      "cursor-pointer align-top focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset",
                      isSelected ? "bg-[color:color-mix(in_srgb,var(--surface-selected)_22%,var(--surface-1)_78%)]" : null,
                      isExpanded &&
                        !isSelected &&
                        "bg-[color:color-mix(in_srgb,var(--surface-selected)_18%,var(--surface-1)_82%)]",
                    )}
                    data-state={isSelected ? "selected" : undefined}
                    onClick={() => toggleExpandedConnection(connection.id)}
                    onKeyDown={(event) =>
                      handleConnectionRowKeyDown(event, connection.id)
                    }
                    tabIndex={0}
                  >
                    {includeSelection ? (
                      <TableCell className="py-3">
                        {connection.status === "active" && supportsManagedAdmin ? (
                          <input
                            aria-label={`${tr("table.headers.select")} ${connection.label}`}
                            checked={isSelected}
                            onClick={stopRowToggle}
                            onChange={() => toggleConnectionSelection(connection.id)}
                            type="checkbox"
                          />
                        ) : null}
                      </TableCell>
                    ) : null}
                    <TableCell className="py-3">
                      <div className="grid gap-2">
                        <div className="flex items-start gap-3">
                          <ProviderAvatar className="mt-0.5" meta={visualMeta} size="md" />
                          <div className="min-w-0 flex-1 space-y-1.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium text-foreground">{connection.label}</span>
                              <Badge variant="outline">
                                {tr(getConnectionStatusLabelKey(connection.status))}
                              </Badge>
                              <Badge variant="secondary">
                                {getProviderVisualLabel(visualMeta, tr)}
                              </Badge>
                              {ambiguousConflictCount > 0 ? (
                                <Badge variant="destructive">
                                  {tr("table.conflicts", {
                                    count: ambiguousConflictCount,
                                  })}
                                </Badge>
                              ) : null}
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="max-w-[32ch] truncate font-mono text-[11px] leading-5 text-muted-foreground">
                                {endpoint}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="py-3">
                        <div className="grid gap-1.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline">{routeSummary.label}</Badge>
                          </div>
                          <span className="text-[12px] text-muted-foreground">{routeSummary.detail}</span>
                        </div>
                    </TableCell>
                    <TableCell className="py-3">
                      <div className="grid gap-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge status={healthState.status}>{healthState.label}</StatusBadge>
                          {connection.lastTestStatusCode !== null ? (
                            <Badge variant="outline">HTTP {connection.lastTestStatusCode}</Badge>
                          ) : null}
                        </div>
                        <span className="text-[12px] text-muted-foreground">{healthState.detail}</span>
                      </div>
                    </TableCell>
                    <TableCell className="py-3">
                      <div className="grid gap-1">
                        <span className="font-medium text-foreground">
                          {formatLocalizedDateTime(connection.updatedAt, locale) ??
                            tr("date.notYet")}
                        </span>
                        <span className="text-[12px] text-muted-foreground">
                          {tr("table.createdLabel")}{" "}
                          {formatLocalizedDateTime(connection.createdAt, locale) ??
                            tr("date.notYet")}
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>

                  <TableRow
                    aria-hidden={!isExpanded}
                    className={cn(
                      "resource-detail-panel hover:bg-transparent",
                      isExpanded
                        ? "bg-[color:color-mix(in_srgb,var(--surface-2)_24%,var(--surface-1)_76%)]"
                        : "border-b-0 bg-transparent",
                    )}
                    data-state={isExpanded ? "open" : "closed"}
                  >
                    <TableCell className="py-0" colSpan={includeSelection ? 5 : 4}>
                      <div className="resource-expando" data-state={isExpanded ? "open" : "closed"}>
                        <div className="resource-expando__inner">
                          <ProviderDetailPanel
                            ambiguousConflictCount={ambiguousConflictCount}
                            connection={connection}
                            connectionAuditHref={connectionAuditHref}
                            connectionUsageHref={connectionUsageHref}
                            endpoint={endpoint}
                            formatLocalizedDateTime={formatLocalizedDateTime}
                            healthState={healthState}
                            inlineMessage={inlineMessage ? {
                              label: inlineMessage.label,
                              message: inlineMessage.message,
                              status: inlineMessage.status,
                              detail: inlineMessage.detail,
                            } : null}
                            isRevokePending={isRevokePending}
                            isTestPending={isTestPending}
                            keysHref={keysHref}
                            locale={locale}
                            onEdit={() => {
                              setUpdateState(null);
                              setEditingConnectionId(connection.id);
                            }}
                            onRetest={handleSavedTest}
                            onRevoke={handleRevoke}
                            routeSummary={routeSummary}
                            supportsManagedAdmin={supportsManagedAdmin}
                            visualMeta={visualMeta}
                          />
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>
    );
  }

  return (
    <section className="space-y-6">
      <CompactToolbar
        query={connectionSearchQuery}
        onQueryChange={setConnectionSearchQuery}
        filterCount={[connectionViewFilter !== "all", providerKindFilter !== "all"].filter(Boolean).length}
        onResetFilters={resetConnectionFilters}
        placeholder={tr("filters.searchPlaceholder")}
        actions={
          <div className="flex items-center gap-2">
            <Button
              onClick={openCreatePanel}
              size="sm"
              type="button"
              className="rounded-full px-4 font-medium shadow-none"
            >
              <Plus className="mr-1.5 size-4" />
              {tr("filters.addProvider")}
            </Button>
            <Button
              aria-expanded={isAdvancedDiagnosticsOpen}
              onClick={() => {
                setIsAdvancedDiagnosticsOpen((open) => {
                  const nextOpen = !open;
                  setOperationsMode(nextOpen ? "advanced" : "basic");
                  return nextOpen;
                });
              }}
              size="sm"
              type="button"
              variant={isAdvancedDiagnosticsOpen ? "secondary" : "ghost"}
              className="rounded-full gap-1.5"
            >
              <Sparkles className="size-4" />
              {tr(isAdvancedDiagnosticsOpen ? "filters.hideTools" : "filters.moreTools")}
            </Button>
          </div>
        }
      >
        <FilterField label={tr("filters.viewLabel")}>
          <SelectField
            htmlFor="provider-view-filter"
            label=""
            onValueChange={(value) => handleSetConnectionViewFilter(value as any)}
            options={[
              { label: tr("filters.viewOptions.all"), value: "all" },
              { label: tr("filters.viewOptions.ready"), value: "ready" },
              { label: tr("filters.viewOptions.attention"), value: "attention" },
              { label: tr("filters.viewOptions.revoked"), value: "revoked" },
            ]}
            value={connectionViewFilter}
          />
        </FilterField>
        <FilterField label={tr("filters.providerLabel")}>
          <SelectField
            htmlFor="provider-kind-filter"
            label=""
            onValueChange={(value) => handleSetProviderKindFilter(value as ProviderKindFilter)}
            options={[
              { label: tr("filters.allProviders"), value: "all" },
              { label: tr("providerKinds.anthropic"), value: "anthropic" },
              { label: tr("providerKinds.openai"), value: "openai" },
              { label: tr("providerKinds.openaiCompatible"), value: "openai-compatible" },
            ]}
            value={providerKindFilter}
          />
        </FilterField>
      </CompactToolbar>

      {globalMessages.length ? (
        <div className="space-y-3">
          {globalMessages.map((message) => (
            <ResourceInlineNotice
              detail={message.detail}
              key={message.key}
              label={message.label}
              message={tr(message.message)}
              tone={message.status === "error" ? "error" : "success"}
            />
          ))}
        </div>
      ) : null}

      {shouldRenderActiveInventory ? (
        <ResourceTableSection
          busy={isFiltersBusy}
          bulkBar={
            showBulkControls && selectedConnectionCount ? (
              <div className="resource-table-selection-bar resource-table-selection-bar--active flex flex-col gap-2.5 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
                <p className="resource-table-selection-bar__detail text-[13px] text-muted-foreground">
                  {tr("bulk.selectedPrefix")}{" "}
                  <span className="font-semibold text-foreground">
                    {selectedConnectionCount}
                  </span>{" "}
                  {tr(
                    selectedConnectionCount === 1
                      ? "bulk.connectionSingular"
                      : "bulk.connectionPlural",
                  )}
                  {hiddenSelectedConnectionCount
                    ? tr("bulk.hiddenByFilters", {
                        count: hiddenSelectedConnectionCount,
                      })
                    : "."}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => replaceSelectedConnections([])} size="sm" type="button" variant="ghost">
                    {tr("table.actions.clear")}
                  </Button>
                  <Button
                    aria-busy={isBulkTestPending || undefined}
                    disabled={isBulkTestPending || !selectedConnectionCount}
                    onClick={handleBulkRetestSelected}
                    size="sm"
                    type="button"
                    variant="secondary"
                  >
                    {tr(
                      isBulkTestPending
                        ? "bulk.retesting"
                        : "bulk.retestSelected",
                    )}
                  </Button>
                </div>
              </div>
            ) : null
          }
          emptyState={activeInventoryEmptyState}
        >
          {providerConnections.length && filteredActiveProviderConnections.length
            ? renderConnectionTable(presentedActiveProviderConnections, {
                includeSelection: showBulkControls,
                tableKey: `table-${filterSignature}`,
              })
            : null}
        </ResourceTableSection>
      ) : null}

      {providerConnections.length > 0 &&
      (revokedConnectionCount || showRevokedHistoryOnly) ? (
        <LazyDisclosureSection
          bodyClassName="border-t border-border/40 pt-4"
          className="rounded-2xl border border-border/60 bg-[color:color-mix(in_srgb,var(--surface-1)_94%,var(--surface-canvas)_6%)]"
          defaultOpen={showRevokedHistoryOnly}
          key={`revoked-history-${showRevokedHistoryOnly ? "open" : "closed"}`}
          summary={
            <DisclosureSummary
              badge={<Badge variant="secondary">{revokedConnectionCount}</Badge>}
              description={tr("revokedHistory.description")}
              meta={tr("revokedHistory.meta", { count: revokedConnectionCount })}
              title={tr("revokedHistory.title")}
              variant="section"
            />
          }
          variant="section"
        >
          <ResourceTableSection
            busy={isFiltersBusy}
            className="border-0 bg-transparent shadow-none"
            contentClassName="border-t-0"
            emptyState={
              <div className="px-4 py-10">
                <EmptyState
                  description={tr("revokedHistory.emptyDescription")}
                  title={tr("revokedHistory.emptyTitle")}
                />
              </div>
            }
          >
            {filteredRevokedProviderConnections.length
              ? renderConnectionTable(presentedRevokedProviderConnections, {
                  tableKey: `table-${filterSignature}-revoked`,
                })
              : null}
          </ResourceTableSection>
        </LazyDisclosureSection>
      ) : null}

      <ResourceCreateDialog
        bodyClassName="p-0"
        className="h-[min(88vh,58rem)] w-[min(92vw,72rem)] rounded-[1.75rem]"
        description={tr("create.description")}
        footer={providerCreateDialogFooter}
        footerClassName="border-t border-border/50 bg-background/95"
        onOpenChange={handleCreateDialogOpenChange}
        open={isCreateOpen}
        size="lg"
        title={tr("create.title")}
      >
        {providerCreatePanelContent}
      </ResourceCreateDialog>

      <ProviderEditDialog
        catalogRefreshNonce={editCatalogRefreshNonce}
        connection={editingConnection}
        getDefaultPricingConfig={getDefaultPricingConfig}
        getPreferredMetadataValue={getPreferredMetadataValue}
        getProviderKindLabel={getProviderKindLabel}
        isUpdatePending={editingConnection ? updatePendingId === editingConnection.id : false}
        locale={locale}
        onOpenChange={handleEditDialogOpenChange}
        onUpdate={handleConnectionUpdate}
        open={Boolean(editingConnection)}
        operationsMode={operationsMode}
        updateErrorMessage={updateState?.status === "error" ? updateState.message : null}
        workspaceId={workspaceId}
      />

      {providerConnections.length && isAdvancedDiagnosticsOpen ? (
        <section className="motion-enter motion-enter-fast rounded-xl border border-border/60 bg-[color:color-mix(in_srgb,var(--surface-1)_95%,var(--surface-canvas)_5%)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/45 pb-3">
            <div className="space-y-0.5">
              <p className="text-[13px] font-medium text-foreground">
                {tr("advancedTools.title")}
              </p>
              <p className="text-[12px] text-muted-foreground">
                {tr("advancedTools.description")}
              </p>
            </div>
            <Badge
              variant={
                routingDiagnostics.diagnosticsTone === "critical"
                  ? "destructive"
                  : "secondary"
              }
            >
              {getRoutingDefaultsSummaryLabel(routingDefaultsSummary.label, tr)}
            </Badge>
          </div>
          <div className="mt-3">
            <ProvidersAdvancedDiagnostics
              isWorkspaceRemediationPending={isWorkspaceRemediationPending}
              onApplyRecommendedDefault={handleApplyRecommendedDefault}
              onApplyWorkspaceRecommendations={handleApplyWorkspaceRecommendations}
              onResolveDefaultConflict={handleResolveDefaultConflict}
              providerConnections={providerConnections}
              updatePendingId={updatePendingId}
            />
          </div>
        </section>
      ) : null}
    </section>
  );
}
