"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";

import {
  ProviderPricingConfigSchema,
  cloneProviderPricingRules,
  getBuiltinPricingCatalogEntry,
  getBuiltinProviderPricingConfig,
  type ProviderConnection,
  type ProviderModelConfigItem,
  type ProviderPricingConfig,
  type ProviderPricingRule,
} from "@teamops/contracts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  buildExactPricingRulesFromSelectedModels,
  getSelectedModelPricingCoverage,
  isPricingRuleLinkedToSelectedModels,
} from "../provider-pricing-coverage";

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

export function ProviderPricingEditor({
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
