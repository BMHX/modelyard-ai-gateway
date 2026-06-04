"use client";

import { Check, Eye, EyeOff, ExternalLink } from "lucide-react";
import { useMemo, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import type {
  ProviderConnectionModelCatalog,
  ProviderModelConfig,
} from "@teamops/contracts";

import { useT } from "@/app/lib/i18n-client";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { ResourceInlineNotice } from "../../components/resource-inline-notice";
import { ProviderAvatar, type ProviderVisualMeta } from "../provider-visuals";
import { ProviderModelManager } from "./provider-model-manager";

export type ProviderCreateStep =
  | "scheme"
  | "connection"
  | "routing"
  | "pricing_review";

export const providerCreateStepOrder: ProviderCreateStep[] = [
  "scheme",
  "connection",
  "routing",
  "pricing_review",
];

export type ProviderCreateWorkbenchTemplate = {
  id: string;
  title: string;
  summary: string;
  helperText?: string | null;
  docsUrl?: string;
  visualMeta: ProviderVisualMeta;
  schemeGroup: string;
  technicalKindLabel: string;
  baseUrlRequirementLabel?: string | null;
  sampleModels: string[];
};

export type ProviderCreateWorkbenchGroup = {
  id: string;
  title: string;
  description: string;
  templates: ProviderCreateWorkbenchTemplate[];
};

type ProviderCreateWorkbenchProps = {
  currentStep: ProviderCreateStep;
  completedSteps: ProviderCreateStep[];
  groupedTemplates: ProviderCreateWorkbenchGroup[];
  onStepChange: (step: ProviderCreateStep) => void;
  formId: string;
  selectedTemplateId: string;
  templateSearchQuery: string;
  onTemplateSearchQueryChange: (value: string) => void;
  onTemplateSelect: (templateId: string) => void;
  title: string;
  summary: string;
  helperText?: string | null;
  docsUrl?: string;
  visualMeta: ProviderVisualMeta;
  technicalKindLabel: string;
  schemeGroupTitle: string;
  label: string;
  labelPlaceholder: string;
  onLabelChange: (value: string) => void;
  labelInputRef?: RefObject<HTMLInputElement | null>;
  apiKey: string;
  apiKeyPlaceholder: string;
  onApiKeyChange: (value: string) => void;
  baseUrl: string;
  baseUrlRequired: boolean;
  baseUrlRequirementLabel: string;
  baseUrlPlaceholder: string;
  onBaseUrlChange: (value: string) => void;
  baseUrlPreview: string | null;
  baseUrlHelp: string;
  showAnthropicVersion: boolean;
  anthropicVersion: string;
  onAnthropicVersionChange: (value: string) => void;
  modelConfig: ProviderModelConfig;
  onModelConfigChange: (value: ProviderModelConfig) => void;
  presetModels: Array<{ id: string; label: string }>;
  catalog: ProviderConnectionModelCatalog | null;
  isCatalogLoading: boolean;
  onLoadCatalog: () => void;
  canLoadCatalog: boolean;
  catalogDisabledReason?: string | null;
  pricingEditor: ReactNode;
  createNotice?: ReactNode;
  draftTestNotice?: ReactNode;
  draftTestStatus: "idle" | "success" | "error";
  draftTestMessage?: string | null;
  draftTestDetail?: string | null;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

function StepRail({
  currentStep,
  completedSteps,
  onStepChange,
}: {
  currentStep: ProviderCreateStep;
  completedSteps: ProviderCreateStep[];
  onStepChange: (step: ProviderCreateStep) => void;
}) {
  const tr = useT("providers");
  const currentStepIndex = providerCreateStepOrder.indexOf(currentStep);

  return (
    <nav aria-label={tr("createFlow.stepperLabel")} className="flex flex-wrap gap-2">
      {providerCreateStepOrder.map((step, index) => {
        const isCurrent = step === currentStep;
        const isComplete = completedSteps.includes(step);
        const isAccessible = isCurrent || isComplete || index < currentStepIndex;

        return (
          <button
            aria-current={isCurrent ? "step" : undefined}
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-left text-xs transition-colors",
              isCurrent
                ? "border-foreground/20 bg-foreground text-background"
                : isAccessible
                  ? "border-border/60 bg-background text-foreground hover:bg-muted/45"
                  : "border-border/40 bg-background text-muted-foreground/70",
            )}
            disabled={!isAccessible}
            key={step}
            onClick={() => onStepChange(step)}
            type="button"
          >
            <span
              className={cn(
                "flex size-5 items-center justify-center rounded-full text-[11px] font-semibold",
                isCurrent
                  ? "bg-background/16 text-background"
                  : isComplete
                    ? "bg-success/10 text-[color:var(--success-strong)]"
                    : "bg-muted text-muted-foreground",
              )}
            >
              {isComplete && !isCurrent ? <Check className="size-3" /> : index + 1}
            </span>
            <span>{tr(`createFlow.steps.${step}.label`)}</span>
          </button>
        );
      })}
    </nav>
  );
}

function StepIntro({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="space-y-1">
      <h2 className="text-lg font-semibold tracking-tight text-foreground">{title}</h2>
      {description ? (
        <p className="text-sm leading-6 text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}

function FormField({
  label,
  helper,
  htmlFor,
  children,
}: {
  label: string;
  helper?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-3">
        <label
          className="text-[13px] font-medium tracking-tight text-foreground"
          htmlFor={htmlFor}
        >
          {label}
        </label>
        {helper ? (
          <span className="text-[11px] text-muted-foreground">{helper}</span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function ReviewField({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-[color:color-mix(in_srgb,var(--surface-1)_92%,white_8%)] px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-sm font-medium text-foreground">{value}</div>
    </div>
  );
}

function SchemeCard({
  template,
  selected,
  onSelect,
}: {
  template: ProviderCreateWorkbenchTemplate;
  selected: boolean;
  onSelect: () => void;
}) {
  const tr = useT("providers");

  return (
    <div
      className={cn(
        "group relative flex rounded-2xl border px-4 py-3 text-left transition-colors",
        selected
          ? "border-foreground/18 bg-[color:color-mix(in_srgb,var(--surface-selected)_18%,var(--surface-1)_82%)] shadow-[inset_0_0_0_1px_rgba(17,24,39,0.06)]"
          : "border-border/60 bg-background hover:bg-muted/30",
      )}
    >
      <button
        aria-pressed={selected}
        className="absolute inset-0 z-0 rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
        onClick={onSelect}
        type="button"
      >
        <span className="sr-only">{tr("createFlow.selectTemplate")} {template.title}</span>
      </button>

      <div className="pointer-events-none z-10 flex min-w-0 flex-1 items-start gap-3">
        <ProviderAvatar className="mt-0.5 shrink-0" meta={template.visualMeta} size="md" />
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold tracking-tight text-foreground">
              {template.title}
            </span>
            <Badge variant="outline" className="shrink-0">{template.technicalKindLabel}</Badge>
            {template.baseUrlRequirementLabel ? (
              <Badge variant="secondary" className="shrink-0">{template.baseUrlRequirementLabel}</Badge>
            ) : null}
          </div>
        </div>
      </div>

      <div className="pointer-events-auto z-10 ml-3 flex shrink-0 flex-col items-end justify-between">
        <span
          className={cn(
            "flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors",
            selected
              ? "border-foreground/18 bg-foreground text-background"
              : "border-border/60 bg-background text-transparent",
          )}
        >
          <Check className="size-3" />
        </span>
        
        {template.docsUrl ? (
          <a
            aria-label={tr("createFlow.viewDocs")}
            className="mt-2 text-muted-foreground/60 transition-colors hover:text-foreground"
            href={template.docsUrl}
            rel="noreferrer"
            target="_blank"
            title={tr("createFlow.viewDocs")}
          >
            <ExternalLink className="size-4" />
          </a>
        ) : null}
      </div>
    </div>
  );
}

export function ProviderCreateWorkbench({
  currentStep,
  completedSteps,
  groupedTemplates,
  onStepChange,
  formId,
  selectedTemplateId,
  templateSearchQuery,
  onTemplateSearchQueryChange,
  onTemplateSelect,
  title,
  summary,
  helperText,
  docsUrl,
  visualMeta,
  technicalKindLabel,
  schemeGroupTitle,
  label,
  labelPlaceholder,
  onLabelChange,
  labelInputRef,
  apiKey,
  apiKeyPlaceholder,
  onApiKeyChange,
  baseUrl,
  baseUrlRequired,
  baseUrlRequirementLabel,
  baseUrlPlaceholder,
  onBaseUrlChange,
  baseUrlPreview,
  baseUrlHelp,
  showAnthropicVersion,
  anthropicVersion,
  onAnthropicVersionChange,
  modelConfig,
  onModelConfigChange,
  presetModels,
  catalog,
  isCatalogLoading,
  onLoadCatalog,
  canLoadCatalog,
  catalogDisabledReason,
  pricingEditor,
  createNotice,
  draftTestNotice,
  draftTestStatus,
  draftTestMessage,
  draftTestDetail,
  onSubmit,
}: ProviderCreateWorkbenchProps) {
  const tr = useT("providers");
  const [isApiKeyVisible, setIsApiKeyVisible] = useState(false);
  const filteredGroups = useMemo(() => {
    const query = templateSearchQuery.trim().toLowerCase();
    if (!query) {
      return groupedTemplates;
    }

    return groupedTemplates
      .map((group) => ({
        ...group,
        templates: group.templates.filter((template) =>
          [
            template.title,
            template.summary,
            template.helperText,
            template.technicalKindLabel,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(query),
        ),
      }))
      .filter((group) => group.templates.length > 0);
  }, [groupedTemplates, templateSearchQuery]);

  const selectedModelCount = modelConfig.items.length;
  const resolvedEndpoint = baseUrlPreview ?? baseUrlHelp;

  const reviewNotice =
    draftTestStatus === "success" && draftTestMessage ? (
      <ResourceInlineNotice
        detail={draftTestDetail}
        label={tr("create.noticeDraftTest")}
        message={tr(draftTestMessage)}
        tone="success"
      />
    ) : draftTestStatus === "error" && draftTestMessage ? (
      <ResourceInlineNotice
        detail={draftTestDetail}
        label={tr("createFlow.reviewDraftFailedLabel")}
        message={tr(draftTestMessage)}
        tone="warning"
      />
    ) : (
      <ResourceInlineNotice
        label={tr("createFlow.reviewDraftIdleLabel")}
        message={tr("createFlow.reviewDraftIdleMessage")}
        tone="warning"
      />
    );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <form className="flex h-full min-h-0 flex-col" id={formId} onSubmit={onSubmit}>
        <div className="shrink-0 border-b border-border/50 px-6 py-5">
          <StepRail
            completedSteps={completedSteps}
            currentStep={currentStep}
            onStepChange={onStepChange}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
          <div className="space-y-6">
            {createNotice}

            {currentStep === "scheme" ? (
              <div className="space-y-6">
                <StepIntro title={tr("createFlow.steps.scheme.title")} />

                <div className="rounded-3xl border border-border/60 bg-[color:color-mix(in_srgb,var(--surface-1)_95%,white_5%)] px-4 py-4">
                  <div className="relative min-w-0">
                    <Input
                      className="rounded-full border-border/60"
                      onChange={(event) => onTemplateSearchQueryChange(event.currentTarget.value)}
                      placeholder={tr("modelManager.platformSearchPlaceholder")}
                      value={templateSearchQuery}
                    />
                  </div>
                </div>

                {filteredGroups.map((group) => (
                  <section className="space-y-3" key={group.id}>
                    <h3 className="text-sm font-semibold tracking-tight text-foreground">
                      {group.title}
                    </h3>

                    <div className="grid gap-4 md:grid-cols-2">
                      {group.templates.map((template) => (
                        <SchemeCard
                          key={template.id}
                          onSelect={() => onTemplateSelect(template.id)}
                          selected={template.id === selectedTemplateId}
                          template={template}
                        />
                      ))}
                    </div>
                  </section>
                ))}

                {filteredGroups.length === 0 ? (
                  <div className="rounded-3xl border border-dashed border-border/60 px-5 py-8 text-center text-sm text-muted-foreground">
                    {tr("createWorkbench.noTemplateResults")}
                  </div>
                ) : null}
              </div>
            ) : null}

            {currentStep === "connection" ? (
              <div className="space-y-6">
                <StepIntro
                  description={tr("createFlow.steps.connection.description")}
                  title={tr("createFlow.steps.connection.title")}
                />

                <div className="rounded-3xl border border-border/60 bg-[color:color-mix(in_srgb,var(--surface-1)_95%,white_5%)] px-5 py-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex min-w-0 items-start gap-3">
                      <ProviderAvatar className="mt-0.5" meta={visualMeta} size="md" />
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold tracking-tight text-foreground">
                            {title}
                          </p>
                          <Badge variant="outline">{schemeGroupTitle}</Badge>
                          <Badge variant="secondary">{technicalKindLabel}</Badge>
                        </div>
                        <p className="text-sm leading-6 text-muted-foreground">{summary}</p>
                        {helperText ? (
                          <p className="text-[13px] leading-5 text-muted-foreground">
                            {helperText}
                          </p>
                        ) : null}
                      </div>
                    </div>

                    {docsUrl ? (
                      <a
                        className="inline-flex items-center gap-1 text-sm font-medium text-foreground/80 transition-colors hover:text-foreground"
                        href={docsUrl}
                        rel="noreferrer"
                        target="_blank"
                      >
                        {tr("createFlow.viewDocs")}
                        <ExternalLink className="size-3.5" />
                      </a>
                    ) : null}
                  </div>
                </div>

                <div className="grid gap-5 xl:grid-cols-2">
                  <FormField htmlFor="provider-create-label" label={tr("Label")}>
                    <Input
                      className="rounded-2xl border-border/60"
                      id="provider-create-label"
                      onChange={(event) => onLabelChange(event.currentTarget.value)}
                      placeholder={labelPlaceholder}
                      ref={labelInputRef}
                      value={label}
                    />
                  </FormField>

                  <FormField htmlFor="provider-create-api-key" label={tr("API key")}>
                    <div className="relative">
                      <Input
                        className="rounded-2xl border-border/60 pr-20"
                        id="provider-create-api-key"
                        onChange={(event) => onApiKeyChange(event.currentTarget.value)}
                        placeholder={apiKeyPlaceholder}
                        type={isApiKeyVisible ? "text" : "password"}
                        value={apiKey}
                      />
                      <button
                        aria-label={tr(
                          isApiKeyVisible
                            ? "createFlow.hideApiKey"
                            : "createFlow.showApiKey",
                        )}
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground"
                        onClick={() => setIsApiKeyVisible((current) => !current)}
                        type="button"
                      >
                        {isApiKeyVisible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                      </button>
                    </div>
                  </FormField>
                </div>

                <div className="grid gap-5 xl:grid-cols-2">
                  <FormField
                    helper={baseUrlRequirementLabel}
                    htmlFor="provider-create-base-url"
                    label={tr("Base URL")}
                  >
                    <Input
                      className="rounded-2xl border-border/60"
                      id="provider-create-base-url"
                      onChange={(event) => onBaseUrlChange(event.currentTarget.value)}
                      placeholder={baseUrlPlaceholder}
                      value={baseUrl}
                    />
                    <p className="text-[12px] leading-5 text-muted-foreground">
                      {resolvedEndpoint}
                    </p>
                  </FormField>

                  {showAnthropicVersion ? (
                    <FormField
                      htmlFor="provider-create-anthropic-version"
                      label={tr("details.anthropicVersion")}
                    >
                      <Input
                        className="rounded-2xl border-border/60"
                        id="provider-create-anthropic-version"
                        onChange={(event) => onAnthropicVersionChange(event.currentTarget.value)}
                        placeholder="2023-06-01"
                        value={anthropicVersion}
                      />
                    </FormField>
                  ) : null}
                </div>

                {draftTestNotice}
              </div>
            ) : null}

            {currentStep === "routing" ? (
              <div className="space-y-6">
                <StepIntro
                  description={tr("createFlow.steps.routing.description")}
                  title={tr("createFlow.steps.routing.title")}
                />

                <ProviderModelManager
                  canLoadCatalog={canLoadCatalog}
                  catalog={catalog}
                  catalogDisabledReason={catalogDisabledReason}
                  isCatalogLoading={isCatalogLoading}
                  onChange={onModelConfigChange}
                  onLoadCatalog={onLoadCatalog}
                  presetModels={presetModels}
                  value={modelConfig}
                />
              </div>
            ) : null}

            {currentStep === "pricing_review" ? (
              <div className="space-y-6">
                <StepIntro
                  description={tr("createFlow.steps.pricing_review.description")}
                  title={tr("createFlow.steps.pricing_review.title")}
                />

                {reviewNotice}

                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  <ReviewField
                    label={tr("createFlow.review.scheme")}
                    value={schemeGroupTitle}
                  />
                  <ReviewField
                    label={tr("createFlow.review.template")}
                    value={title}
                  />
                  <ReviewField
                    label={tr("createFlow.review.technicalKind")}
                    value={technicalKindLabel}
                  />
                  <ReviewField
                    label={tr("createFlow.review.endpoint")}
                    value={resolvedEndpoint}
                  />
                  <ReviewField
                    label={tr("createFlow.review.models")}
                    value={
                      selectedModelCount
                        ? tr("createFlow.review.modelCount", {
                            count: selectedModelCount,
                          })
                        : tr("createFlow.review.noModels")
                    }
                  />
                </div>

                <div className="rounded-3xl border border-border/60 bg-[color:color-mix(in_srgb,var(--surface-1)_95%,white_5%)] px-5 py-5">
                  <div className="mb-4 flex items-start gap-3">
                    <ProviderAvatar meta={visualMeta} size="md" />
                    <div className="space-y-1">
                      <p className="text-sm font-semibold tracking-tight text-foreground">
                        {title}
                      </p>
                      <p className="text-sm leading-6 text-muted-foreground">{summary}</p>
                    </div>
                  </div>
                  {pricingEditor}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </form>
    </div>
  );
}
