import { z } from "zod";

export const HealthResponseSchema = z.object({
  service: z.string(),
  status: z.enum(["ok", "degraded"]),
  timestamp: z.string(),
});

export const CommonApiErrorCodeValues = [
  "ACCESS_DENIED",
  "AUTH_REQUIRED",
  "CONFLICT",
  "CROSS_ORIGIN_FORBIDDEN",
  "INVALID_REQUEST",
  "INVALID_REQUEST_BODY",
  "INVALID_REQUEST_PARAMETER",
  "INVALID_UUID",
  "LOGIN_DENIED",
  "REFERENCED_RESOURCE_MISSING",
  "RESOURCE_NOT_FOUND",
  "RESOURCE_SCOPE_FORBIDDEN",
  "SELF_SERVE_FORBIDDEN",
  "SELF_SERVE_MEMBERSHIP_REQUIRED",
  "SELF_SERVE_PROJECT_SCOPE_FORBIDDEN",
  "SERVICE_UNAVAILABLE",
  "SESSION_EXPIRED",
  "SESSION_REVOKED",
  "TEAMOPS_MISSING_TABLE",
  "UNEXPECTED_ERROR",
] as const;

export const CommonApiErrorCodeSchema = z.enum(CommonApiErrorCodeValues);
export const ApiErrorCodeSchema = z.string().trim().min(1).regex(/^[A-Z0-9_]+$/u);
export const ApiErrorDetailsSchema = z.record(z.string(), z.unknown());
export const ApiErrorSchema = z.object({
  code: ApiErrorCodeSchema,
  message: z.string(),
  resource: z.string().trim().min(1).optional(),
  details: ApiErrorDetailsSchema.optional(),
});
export const ApiErrorResponseSchema = z.object({
  error: ApiErrorSchema,
});

export const EnvironmentRuntimeSchema = z.enum(["development", "staging", "production"]);

export const ProviderKindSchema = z.enum([
  "anthropic",
  "openai",
  "bedrock",
  "vertex",
  "openai-compatible",
]);
export const ProviderRoutingProtocolSchema = z.enum(["anthropic", "openai-compatible"]);
export const PricingSourceSchema = z.enum(["builtin", "connection-metadata", "manual", "unknown"]);
export const ProviderPricingModeSchema = z.enum(["builtin", "manual"]);
export const ProviderPricingMatchTypeSchema = z.enum(["canonical", "fallback"]);
export const ExportJobKindSchema = z.enum(["usage-events", "audit-logs", "usage-ledger"]);
export const UsageEventStatusSchema = z.enum(["success", "error", "blocked"]);
export const VirtualKeyGatewayScopeValues = [
  "gateway:*",
  "gateway:messages",
  "gateway:chat-completions",
  "gateway:responses",
  "gateway:models",
] as const;
export const VirtualKeyGatewayScopeSchema = z.enum(VirtualKeyGatewayScopeValues);

export const MemberRoleSchema = z.enum([
  "organization_owner",
  "workspace_admin",
  "developer",
]);

export const LegacyMemberRoleSchema = z.enum(["project_maintainer", "finance_viewer"]);

export const MemberStatusSchema = z.enum(["active", "invited", "disabled"]);

export const ExportJobStatusSchema = z.enum(["pending", "running", "completed", "failed"]);
export const AlertSeveritySchema = z.enum(["info", "warning", "critical"]);
export const BudgetScopeKindSchema = z.enum(["workspace", "project", "environment"]);
export const ReportDeliveryChannelSchema = z.enum(["email", "slack", "feishu", "webhook"]);
export const EventDrivenTriggerEventSchema = z.enum(["budget-alert-opened", "export-job-failed"]);
export const ReportWorkflowStatusSchema = z.enum(["pending", "acknowledged", "in_progress", "blocked", "completed"]);
export const ReportGovernanceApprovalModeSchema = z.enum(["none", "required"]);
export const ReportGovernanceApprovalStatusSchema = z.enum(["not_required", "pending", "approved"]);
export const FingerprintDeploymentModeSchema = z.enum(["cloud", "hybrid", "self_host_preview"]);
export const FingerprintKeyPurposeSchema = z.enum(["fingerprint_hmac", "evidence_signing"]);
export const FingerprintKeyAlgorithmSchema = z.enum(["HMAC-SHA256", "Ed25519"]);
export const FingerprintKeyStatusSchema = z.enum([
  "draft",
  "active",
  "verify_only",
  "retired",
  "destroy_scheduled",
  "destroyed",
]);
export const FingerprintIssuanceStatusSchema = z.enum(["issued", "active", "revoked", "superseded"]);
export const EvidenceBundleKindSchema = z.enum(["fingerprint_issuance", "export_snapshot"]);
export const PromptInspectionVerdictSchema = z.enum([
  "allow_clean",
  "allow_with_record",
  "review",
  "block",
]);
export const PromptPolicyEnforcementModeSchema = z.enum(["graded", "alert_only", "strict"]);
export const PromptPolicyEvidenceModeSchema = z.enum(["redacted_snippet", "fingerprint_only", "disabled"]);
export const PromptRiskCategorySchema = z.enum([
  "secret_exfiltration",
  "credential_exposure",
  "pii_exposure",
  "customer_data_export",
  "external_business",
  "personal_use",
  "policy_evasion",
  "suspicious_obfuscation",
]);
export const PromptActivityLabelSchema = z.enum([
  "coding",
  "debugging",
  "testing",
  "documentation",
  "translation",
  "research",
  "external_delivery",
  "non_work",
  "unknown",
]);
export const PromptInspectionReviewStatusSchema = z.enum([
  "pending",
  "confirmed_violation",
  "confirmed_benign",
  "needs_followup",
]);
export const WorkspacePermissionSchema = z.enum([
  "organization.read",
  "organization.write",
  "workspace.read",
  "workspace.write",
  "project.read",
  "project.write",
  "environment.read",
  "environment.write",
  "member.read",
  "member.write",
  "budget.read",
  "budget.write",
  "provider.read",
  "provider.write",
  "virtual_key.read",
  "virtual_key.write",
  "usage.read",
  "prompt_inspection.read",
  "prompt_inspection.write",
  "audit_log.read",
  "export.read",
  "export.write",
  "alert.read",
  "alert.write",
  "prompt_policy.write",
]);

const builtinPricingProviderValues = ["anthropic", "openai"] as const;
export const BuiltinPricingProviderSchema = z.enum(builtinPricingProviderValues);

export function normalizeProviderModel(model: string) {
  return model.trim().toLowerCase();
}

export function normalizeCanonicalModel(model: string) {
  return normalizeProviderModel(model)
    .replace(/[-_]?20\d{2}[-_]\d{2}[-_]\d{2}$/u, "")
    .replace(/-\d{8}$/u, "");
}

export function inferModelFamily(model: string) {
  const canonicalModel = normalizeCanonicalModel(model);
  const parts = canonicalModel.split("-").filter(Boolean);
  if (parts.length <= 2) {
    return canonicalModel;
  }

  return parts.slice(0, 3).join("-");
}

export const ProviderPricingRatesSchema = z.object({
  inputUsdPerMillion: z.number().min(0),
  outputUsdPerMillion: z.number().min(0),
  cachedInputUsdPerMillion: z.number().min(0).nullable().default(null),
  cacheReadInputUsdPerMillion: z.number().min(0).nullable().default(null),
  cacheWrite5mInputUsdPerMillion: z.number().min(0).nullable().default(null),
  cacheWrite1hInputUsdPerMillion: z.number().min(0).nullable().default(null),
  longContextThresholdInputTokens: z.number().int().min(1).nullable().default(null),
  longContextInputUsdPerMillion: z.number().min(0).nullable().default(null),
  longContextOutputUsdPerMillion: z.number().min(0).nullable().default(null),
  longContextCacheReadInputUsdPerMillion: z.number().min(0).nullable().default(null),
  longContextCacheWrite5mInputUsdPerMillion: z.number().min(0).nullable().default(null),
  longContextCacheWrite1hInputUsdPerMillion: z.number().min(0).nullable().default(null),
});

export const ProviderPricingRuleSchema = z
  .object({
    matchType: ProviderPricingMatchTypeSchema,
    model: z
      .union([z.string().trim().min(1), z.null()])
      .transform((value) => (typeof value === "string" ? normalizeCanonicalModel(value) : null)),
    rates: ProviderPricingRatesSchema,
  })
  .superRefine((value, ctx) => {
    if (value.matchType === "canonical" && !value.model) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["model"],
        message: "Canonical pricing rules require a model",
      });
    }

    if (value.matchType === "fallback" && value.model !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["model"],
        message: "Fallback pricing rules cannot define a model",
      });
    }

    const hasLongContextRate =
      value.rates.longContextInputUsdPerMillion !== null ||
      value.rates.longContextOutputUsdPerMillion !== null ||
      value.rates.longContextCacheReadInputUsdPerMillion !== null ||
      value.rates.longContextCacheWrite5mInputUsdPerMillion !== null ||
      value.rates.longContextCacheWrite1hInputUsdPerMillion !== null;

    if (hasLongContextRate && value.rates.longContextThresholdInputTokens === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rates", "longContextThresholdInputTokens"],
        message: "Long context pricing requires a threshold",
      });
    }
  });

export const ProviderPricingConfigSchema = z
  .object({
    mode: ProviderPricingModeSchema,
    rules: z.array(ProviderPricingRuleSchema).default([]),
  })
  .superRefine((value, ctx) => {
    const seenCanonicalModels = new Set<string>();
    let fallbackCount = 0;

    value.rules.forEach((rule, index) => {
      if (rule.matchType === "fallback") {
        fallbackCount += 1;
      }

      if (rule.matchType === "canonical" && rule.model) {
        if (seenCanonicalModels.has(rule.model)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["rules", index, "model"],
            message: `Duplicate pricing rule for model ${rule.model}`,
          });
          return;
        }

        seenCanonicalModels.add(rule.model);
      }
    });

    if (fallbackCount > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rules"],
        message: "Only one fallback pricing rule is allowed",
      });
    }
  });

export const BuiltinPricingCatalogReferenceSchema = z.object({
  pricingPageUrl: z.string().url(),
  usagePageUrl: z.string().url(),
  promptCachingUrl: z.string().url().nullable().default(null),
  verifiedAt: z.string(),
});

export const BuiltinPricingCatalogEntrySchema = z.object({
  provider: BuiltinPricingProviderSchema,
  rules: z.array(ProviderPricingRuleSchema),
  reference: BuiltinPricingCatalogReferenceSchema,
});

const builtinPricingCatalogEntries = [
  {
    provider: "openai",
    reference: {
      pricingPageUrl: "https://platform.openai.com/docs/pricing",
      usagePageUrl: "https://platform.openai.com/docs/api-reference/responses/object",
      promptCachingUrl: "https://platform.openai.com/docs/guides/prompt-caching",
      verifiedAt: "2026-04-16",
    },
    rules: [
      {
        matchType: "canonical",
        model: "gpt-4.1",
        rates: {
          inputUsdPerMillion: 2,
          outputUsdPerMillion: 8,
          cachedInputUsdPerMillion: 0.5,
        },
      },
      {
        matchType: "canonical",
        model: "gpt-4.1-mini",
        rates: {
          inputUsdPerMillion: 0.4,
          outputUsdPerMillion: 1.6,
          cachedInputUsdPerMillion: 0.1,
        },
      },
      {
        matchType: "canonical",
        model: "gpt-4.1-nano",
        rates: {
          inputUsdPerMillion: 0.1,
          outputUsdPerMillion: 0.4,
          cachedInputUsdPerMillion: 0.025,
        },
      },
      {
        matchType: "canonical",
        model: "gpt-4o",
        rates: {
          inputUsdPerMillion: 2.5,
          outputUsdPerMillion: 10,
          cachedInputUsdPerMillion: 1.25,
        },
      },
      {
        matchType: "canonical",
        model: "gpt-4o-mini",
        rates: {
          inputUsdPerMillion: 0.15,
          outputUsdPerMillion: 0.6,
          cachedInputUsdPerMillion: 0.075,
        },
      },
      {
        matchType: "canonical",
        model: "o3",
        rates: {
          inputUsdPerMillion: 2,
          outputUsdPerMillion: 8,
          cachedInputUsdPerMillion: 0.5,
        },
      },
      {
        matchType: "canonical",
        model: "o4-mini",
        rates: {
          inputUsdPerMillion: 1.1,
          outputUsdPerMillion: 4.4,
          cachedInputUsdPerMillion: 0.275,
        },
      },
      {
        matchType: "canonical",
        model: "o3-mini",
        rates: {
          inputUsdPerMillion: 1.1,
          outputUsdPerMillion: 4.4,
          cachedInputUsdPerMillion: 0.55,
        },
      },
      {
        matchType: "canonical",
        model: "o1-mini",
        rates: {
          inputUsdPerMillion: 1.1,
          outputUsdPerMillion: 4.4,
          cachedInputUsdPerMillion: 0.55,
        },
      },
    ],
  },
  {
    provider: "anthropic",
    reference: {
      pricingPageUrl: "https://docs.anthropic.com/en/docs/about-claude/pricing",
      usagePageUrl: "https://docs.anthropic.com/en/api/messages",
      promptCachingUrl: "https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching",
      verifiedAt: "2026-04-16",
    },
    rules: [
      {
        matchType: "canonical",
        model: "claude-opus-4-1",
        rates: {
          inputUsdPerMillion: 15,
          outputUsdPerMillion: 75,
          cacheReadInputUsdPerMillion: 1.5,
          cacheWrite5mInputUsdPerMillion: 18.75,
          cacheWrite1hInputUsdPerMillion: 30,
        },
      },
      {
        matchType: "canonical",
        model: "claude-opus-4",
        rates: {
          inputUsdPerMillion: 15,
          outputUsdPerMillion: 75,
          cacheReadInputUsdPerMillion: 1.5,
          cacheWrite5mInputUsdPerMillion: 18.75,
          cacheWrite1hInputUsdPerMillion: 30,
        },
      },
      {
        matchType: "canonical",
        model: "claude-sonnet-4",
        rates: {
          inputUsdPerMillion: 3,
          outputUsdPerMillion: 15,
          cacheReadInputUsdPerMillion: 0.3,
          cacheWrite5mInputUsdPerMillion: 3.75,
          cacheWrite1hInputUsdPerMillion: 6,
          longContextThresholdInputTokens: 200_000,
          longContextInputUsdPerMillion: 6,
          longContextOutputUsdPerMillion: 22.5,
          longContextCacheReadInputUsdPerMillion: 0.6,
          longContextCacheWrite5mInputUsdPerMillion: 7.5,
          longContextCacheWrite1hInputUsdPerMillion: 12,
        },
      },
      {
        matchType: "canonical",
        model: "claude-sonnet-4-5",
        rates: {
          inputUsdPerMillion: 3,
          outputUsdPerMillion: 15,
          cacheReadInputUsdPerMillion: 0.3,
          cacheWrite5mInputUsdPerMillion: 3.75,
          cacheWrite1hInputUsdPerMillion: 6,
          longContextThresholdInputTokens: 200_000,
          longContextInputUsdPerMillion: 6,
          longContextOutputUsdPerMillion: 22.5,
          longContextCacheReadInputUsdPerMillion: 0.6,
          longContextCacheWrite5mInputUsdPerMillion: 7.5,
          longContextCacheWrite1hInputUsdPerMillion: 12,
        },
      },
      {
        matchType: "canonical",
        model: "claude-sonnet-4-6",
        rates: {
          inputUsdPerMillion: 3,
          outputUsdPerMillion: 15,
          cacheReadInputUsdPerMillion: 0.3,
          cacheWrite5mInputUsdPerMillion: 3.75,
          cacheWrite1hInputUsdPerMillion: 6,
          longContextThresholdInputTokens: 200_000,
          longContextInputUsdPerMillion: 6,
          longContextOutputUsdPerMillion: 22.5,
          longContextCacheReadInputUsdPerMillion: 0.6,
          longContextCacheWrite5mInputUsdPerMillion: 7.5,
          longContextCacheWrite1hInputUsdPerMillion: 12,
        },
      },
      {
        matchType: "canonical",
        model: "claude-3-7-sonnet",
        rates: {
          inputUsdPerMillion: 3,
          outputUsdPerMillion: 15,
          cacheReadInputUsdPerMillion: 0.3,
          cacheWrite5mInputUsdPerMillion: 3.75,
          cacheWrite1hInputUsdPerMillion: 6,
        },
      },
      {
        matchType: "canonical",
        model: "claude-3-5-sonnet",
        rates: {
          inputUsdPerMillion: 3,
          outputUsdPerMillion: 15,
          cacheReadInputUsdPerMillion: 0.3,
          cacheWrite5mInputUsdPerMillion: 3.75,
          cacheWrite1hInputUsdPerMillion: 6,
        },
      },
      {
        matchType: "canonical",
        model: "claude-3-5-haiku",
        rates: {
          inputUsdPerMillion: 0.8,
          outputUsdPerMillion: 4,
          cacheReadInputUsdPerMillion: 0.08,
          cacheWrite5mInputUsdPerMillion: 1,
          cacheWrite1hInputUsdPerMillion: 1.6,
        },
      },
      {
        matchType: "canonical",
        model: "claude-haiku-4-5",
        rates: {
          inputUsdPerMillion: 1,
          outputUsdPerMillion: 5,
          cacheReadInputUsdPerMillion: 0.1,
          cacheWrite5mInputUsdPerMillion: 1.25,
          cacheWrite1hInputUsdPerMillion: 2,
        },
      },
      {
        matchType: "canonical",
        model: "claude-3-haiku",
        rates: {
          inputUsdPerMillion: 0.25,
          outputUsdPerMillion: 1.25,
          cacheReadInputUsdPerMillion: 0.03,
          cacheWrite5mInputUsdPerMillion: 0.3,
          cacheWrite1hInputUsdPerMillion: 0.5,
        },
      },
    ],
  },
] as const satisfies readonly z.input<typeof BuiltinPricingCatalogEntrySchema>[];

export const BuiltinPricingCatalog = BuiltinPricingCatalogEntrySchema.array().parse(
  builtinPricingCatalogEntries,
);

export function cloneProviderPricingRules(
  rules: readonly z.infer<typeof ProviderPricingRuleSchema>[],
) {
  return rules.map((rule) => ({
    matchType: rule.matchType,
    model: rule.model,
    rates: {
      inputUsdPerMillion: rule.rates.inputUsdPerMillion,
      outputUsdPerMillion: rule.rates.outputUsdPerMillion,
      cachedInputUsdPerMillion: rule.rates.cachedInputUsdPerMillion,
      cacheReadInputUsdPerMillion: rule.rates.cacheReadInputUsdPerMillion,
      cacheWrite5mInputUsdPerMillion: rule.rates.cacheWrite5mInputUsdPerMillion,
      cacheWrite1hInputUsdPerMillion: rule.rates.cacheWrite1hInputUsdPerMillion,
      longContextThresholdInputTokens: rule.rates.longContextThresholdInputTokens,
      longContextInputUsdPerMillion: rule.rates.longContextInputUsdPerMillion,
      longContextOutputUsdPerMillion: rule.rates.longContextOutputUsdPerMillion,
      longContextCacheReadInputUsdPerMillion:
        rule.rates.longContextCacheReadInputUsdPerMillion,
      longContextCacheWrite5mInputUsdPerMillion:
        rule.rates.longContextCacheWrite5mInputUsdPerMillion,
      longContextCacheWrite1hInputUsdPerMillion:
        rule.rates.longContextCacheWrite1hInputUsdPerMillion,
    },
  }));
}

export function getBuiltinPricingCatalogEntry(
  provider: z.infer<typeof BuiltinPricingProviderSchema>,
) {
  return BuiltinPricingCatalog.find((entry) => entry.provider === provider) ?? null;
}

export function getBuiltinProviderPricingRules(
  provider: z.infer<typeof BuiltinPricingProviderSchema>,
) {
  const entry = getBuiltinPricingCatalogEntry(provider);
  return entry ? cloneProviderPricingRules(entry.rules) : [];
}

export function getBuiltinProviderPricingConfig(
  provider: z.infer<typeof BuiltinPricingProviderSchema>,
) {
  return ProviderPricingConfigSchema.parse({
    mode: "builtin",
    rules: getBuiltinProviderPricingRules(provider),
  });
}

function parseLegacyPricingNumber(value: string | undefined) {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export type ProviderModelPricingMatch = {
  matchType: z.infer<typeof ProviderPricingMatchTypeSchema>;
  source: "builtin" | "connection-metadata" | "manual";
  rates: z.infer<typeof ProviderPricingRatesSchema>;
};

function getManualProviderPricingMatch(
  model: string,
  pricingConfig: z.infer<typeof ProviderPricingConfigSchema> | null | undefined,
): ProviderModelPricingMatch | null {
  if (!pricingConfig || pricingConfig.mode !== "manual") {
    return null;
  }

  const canonicalModel = normalizeCanonicalModel(model);
  const matchedRule =
    pricingConfig.rules.find(
      (rule) => rule.matchType === "canonical" && rule.model === canonicalModel,
    ) ??
    pricingConfig.rules.find((rule) => rule.matchType === "fallback");

  if (!matchedRule) {
    return null;
  }

  return {
    matchType: matchedRule.matchType,
    source: "manual",
    rates: matchedRule.rates,
  };
}

function getBuiltinProviderPricingMatch(
  provider: z.infer<typeof ProviderKindSchema>,
  model: string,
): ProviderModelPricingMatch | null {
  if (provider !== "anthropic" && provider !== "openai") {
    return null;
  }

  const canonicalModel = normalizeCanonicalModel(model);
  const matchedRule = getBuiltinProviderPricingRules(provider).find(
    (rule) => rule.matchType === "canonical" && rule.model === canonicalModel,
  );

  if (!matchedRule) {
    return null;
  }

  return {
    matchType: "canonical",
    source: "builtin",
    rates: matchedRule.rates,
  };
}

function getLegacyProviderPricingMatch(
  model: string,
  metadata: Record<string, string>,
): ProviderModelPricingMatch | null {
  const normalizedModel = normalizeProviderModel(model);
  const exactInput = parseLegacyPricingNumber(metadata[`pricing.${normalizedModel}.inputUsdPer1m`]);
  const exactOutput = parseLegacyPricingNumber(metadata[`pricing.${normalizedModel}.outputUsdPer1m`]);

  if (exactInput !== null && exactOutput !== null) {
    return {
      matchType: "canonical",
      source: "connection-metadata",
      rates: {
        inputUsdPerMillion: exactInput,
        outputUsdPerMillion: exactOutput,
        cachedInputUsdPerMillion: null,
        cacheReadInputUsdPerMillion: null,
        cacheWrite5mInputUsdPerMillion: null,
        cacheWrite1hInputUsdPerMillion: null,
        longContextThresholdInputTokens: null,
        longContextInputUsdPerMillion: null,
        longContextOutputUsdPerMillion: null,
        longContextCacheReadInputUsdPerMillion: null,
        longContextCacheWrite5mInputUsdPerMillion: null,
        longContextCacheWrite1hInputUsdPerMillion: null,
      },
    };
  }

  const defaultInput = parseLegacyPricingNumber(metadata.defaultInputUsdPer1m);
  const defaultOutput = parseLegacyPricingNumber(metadata.defaultOutputUsdPer1m);

  if (defaultInput !== null && defaultOutput !== null) {
    return {
      matchType: "fallback",
      source: "connection-metadata",
      rates: {
        inputUsdPerMillion: defaultInput,
        outputUsdPerMillion: defaultOutput,
        cachedInputUsdPerMillion: null,
        cacheReadInputUsdPerMillion: null,
        cacheWrite5mInputUsdPerMillion: null,
        cacheWrite1hInputUsdPerMillion: null,
        longContextThresholdInputTokens: null,
        longContextInputUsdPerMillion: null,
        longContextOutputUsdPerMillion: null,
        longContextCacheReadInputUsdPerMillion: null,
        longContextCacheWrite5mInputUsdPerMillion: null,
        longContextCacheWrite1hInputUsdPerMillion: null,
      },
    };
  }

  return null;
}

export function getProviderModelPricingMatch(args: {
  provider: z.infer<typeof ProviderKindSchema>;
  model: string;
  pricingConfig: z.infer<typeof ProviderPricingConfigSchema> | null | undefined;
  metadata: Record<string, string>;
}): ProviderModelPricingMatch | null {
  return (
    getManualProviderPricingMatch(args.model, args.pricingConfig) ??
    getBuiltinProviderPricingMatch(args.provider, args.model) ??
    getLegacyProviderPricingMatch(args.model, args.metadata)
  );
}

export function getProviderModelPricingCoverageStatus(args: {
  provider: z.infer<typeof ProviderKindSchema>;
  model: string;
  pricingConfig: z.infer<typeof ProviderPricingConfigSchema> | null | undefined;
  metadata: Record<string, string>;
}) {
  const match = getProviderModelPricingMatch(args);
  if (!match) {
    return "uncovered" as const;
  }

  return match.matchType;
}

export function getUncoveredProviderModelIds(args: {
  provider: z.infer<typeof ProviderKindSchema>;
  modelIds: string[];
  pricingConfig: z.infer<typeof ProviderPricingConfigSchema> | null | undefined;
  metadata: Record<string, string>;
}) {
  return [...new Set(args.modelIds.map((modelId) => normalizeProviderModel(modelId)).filter(Boolean))].filter(
    (modelId) =>
      getProviderModelPricingCoverageStatus({
        provider: args.provider,
        model: modelId,
        pricingConfig: args.pricingConfig,
        metadata: args.metadata,
      }) === "uncovered",
  );
}

export const OrganizationSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  customerId: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const OrganizationSummarySchema = OrganizationSchema.extend({
  workspaceCount: z.number().int().nonnegative(),
});

export const ControlPlaneOperatorStatusSchema = z.enum(["active", "disabled"]);
export const IdentityProviderTypeSchema = z.enum([
  "generic-oidc",
  "okta",
  "entra-id",
  "google-workspace",
]);
export const IdentityProviderStatusSchema = z.enum(["active", "disabled"]);

export const ControlPlaneOperatorSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  status: ControlPlaneOperatorStatusSchema,
  provisioningSource: z.string(),
  guideExitedWorkspaceIds: z.array(z.string().uuid()).default([]),
  lastLoginAt: z.string().nullable(),
  lastActiveAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const IdentityProviderSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  providerType: IdentityProviderTypeSchema,
  issuer: z.string().url(),
  authorizationEndpoint: z.string().url(),
  tokenEndpoint: z.string().url(),
  userinfoEndpoint: z.string().url().nullable(),
  jwksUri: z.string().url(),
  clientId: z.string().min(1),
  scopes: z.array(z.string().min(1)).min(1),
  domainHint: z.string().min(1).nullable(),
  status: IdentityProviderStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const UpsertIdentityProviderInputSchema = z.object({
  providerType: IdentityProviderTypeSchema.default("generic-oidc"),
  issuer: z.string().url(),
  authorizationEndpoint: z.string().url(),
  tokenEndpoint: z.string().url(),
  userinfoEndpoint: z.string().url().nullable().default(null),
  jwksUri: z.string().url(),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1).nullable().default(null),
  scopes: z.array(z.string().min(1)).min(1).default(["openid", "email", "profile"]),
  domainHint: z.string().min(1).nullable().default(null),
  status: IdentityProviderStatusSchema.default("active"),
});

const AuthReturnToSchema = z
  .string()
  .min(1)
  .refine(
    (value) => value.startsWith("/") && !value.startsWith("//") && !/^[a-z][a-z\d+.-]*:/i.test(value),
    "returnTo must be a relative path",
  );

export const AuthLoginStartInputSchema = z.object({
  organizationSlug: z.string().min(2).max(120),
  returnTo: AuthReturnToSchema.default("/"),
});

export const AuthLoginStartResponseSchema = z.object({
  authorizationUrl: z.string().url(),
});

export const AuthLoginCallbackInputSchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

export const AuthLoginCallbackResponseSchema = z.object({
  sessionHandle: z.string().min(32),
  returnTo: AuthReturnToSchema,
});

export const AuthTestLoginInputSchema = z.object({
  organizationSlug: z.string().min(2).max(120),
  email: z.string().email(),
  returnTo: AuthReturnToSchema.default("/"),
});

export const AuthSessionSchema = z.object({
  authenticated: z.literal(true),
  organizationId: z.string().uuid(),
  organizationSlug: z.string(),
  operatorId: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  guideExitedWorkspaceIds: z.array(z.string().uuid()).default([]),
  expiresAt: z.string(),
  idleExpiresAt: z.string(),
  activeMembershipId: z.string().uuid().nullable().default(null),
  activeRole: z.string().nullable().default(null),
});

export const UpdateWorkspaceGuidePreferenceInputSchema = z.object({
  workspaceId: z.string().uuid(),
  exited: z.boolean(),
});

export const CreateOrganizationInputSchema = z.object({
  name: z.string().min(2).max(120),
  slug: z.string().min(2).max(120).optional(),
});

export const UpdateOrganizationInputSchema = z
  .object({
    name: z.string().min(2).max(120).optional(),
    slug: z.string().min(2).max(120).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one organization field must be updated",
  });

export const WorkspaceSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const WorkspaceOptionSchema = WorkspaceSchema.extend({
  organizationName: z.string(),
});

export const CreateWorkspaceInputSchema = z.object({
  organizationId: z.string().uuid(),
  name: z.string().min(2).max(120),
  slug: z.string().min(2).max(120).optional(),
});

export const UpdateWorkspaceInputSchema = z
  .object({
    name: z.string().min(2).max(120).optional(),
    slug: z.string().min(2).max(120).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one workspace field must be updated",
  });

export const ProjectSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  status: z.enum(["active", "archived"]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const CreateProjectInputSchema = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().min(2).max(120),
  slug: z.string().min(2).max(120).optional(),
});

export const UpdateProjectInputSchema = z
  .object({
    name: z.string().min(2).max(120).optional(),
    slug: z.string().min(2).max(120).optional(),
    status: z.enum(["active", "archived"]).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one project field must be updated",
  });

export const EnvironmentSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  runtime: EnvironmentRuntimeSchema,
  status: z.enum(["active", "archived"]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const CreateEnvironmentInputSchema = z.object({
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid(),
  name: z.string().min(2).max(120),
  slug: z.string().min(2).max(120).optional(),
  runtime: EnvironmentRuntimeSchema,
});

export const UpdateEnvironmentInputSchema = z
  .object({
    projectId: z.string().uuid().optional(),
    name: z.string().min(2).max(120).optional(),
    slug: z.string().min(2).max(120).optional(),
    runtime: EnvironmentRuntimeSchema.optional(),
    status: z.enum(["active", "archived"]).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one environment field must be updated",
  });

export const MemberSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  role: MemberRoleSchema,
  roles: z.array(MemberRoleSchema).default([]),
  status: MemberStatusSchema,
  lastLoginAt: z.string().nullable(),
  lastActiveAt: z.string().nullable(),
  temporaryAccessExpiresAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const MemberProjectAssignmentSchema = z.object({
  memberId: z.string().uuid(),
  projectId: z.string().uuid(),
  createdAt: z.string(),
});

export const CreateMemberInputSchema = z.object({
  workspaceId: z.string().uuid(),
  email: z.string().email(),
  name: z.string().min(2).max(120),
  role: MemberRoleSchema.default("developer"),
  roles: z.array(MemberRoleSchema).default([]),
  temporaryAccessExpiresAt: z.string().datetime().nullable().default(null),
});

export const UpdateMemberInputSchema = z
  .object({
    name: z.string().min(2).max(120).optional(),
    role: MemberRoleSchema.optional(),
    roles: z.array(MemberRoleSchema).optional(),
    status: MemberStatusSchema.optional(),
    temporaryAccessExpiresAt: z.string().datetime().nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one member field must be updated",
  });

export const ReplaceMemberProjectAssignmentsInputSchema = z.object({
  projectIds: z.array(z.string().uuid()).max(200).default([]),
});

export const ProviderConnectionSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid().optional(),
  workspaceId: z.string().uuid(),
  provider: ProviderKindSchema,
  label: z.string(),
  metadata: z.record(z.string(), z.string()).default({}),
  pricingConfig: ProviderPricingConfigSchema.nullable().default(null),
  baseUrl: z.string().nullable(),
  anthropicVersion: z.string().nullable(),
  status: z.enum(["active", "revoked"]),
  revokedAt: z.string().nullable(),
  lastTestedAt: z.string().nullable(),
  lastTestStatus: z.enum(["passed", "failed"]).nullable(),
  lastTestError: z.string().nullable(),
  lastTestStatusCode: z.number().int().nullable(),
  lastTestLatencyMs: z.number().int().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const CreateProviderConnectionInputSchema = z.object({
  workspaceId: z.string().uuid(),
  provider: ProviderKindSchema,
  label: z.string().min(2).max(120),
  apiKey: z.string().min(8),
  metadata: z.record(z.string(), z.string()).default({}),
  pricingConfig: ProviderPricingConfigSchema.nullable().optional(),
});

export const UpdateProviderConnectionInputSchema = z
  .object({
    label: z.string().min(2).max(120).optional(),
    apiKey: z.string().min(8).optional(),
    metadata: z.record(z.string(), z.string()).optional(),
    pricingConfig: ProviderPricingConfigSchema.nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one provider connection field must be updated",
  });

export const ProviderConnectionTestResponseSchema = z.object({
  providerConnectionId: z.string().uuid().nullable(),
  ok: z.boolean(),
  statusCode: z.number().int().nullable(),
  message: z.string(),
  testedAt: z.string(),
  latencyMs: z.number().int().nullable(),
});

export const VirtualKeySchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  providerConnectionId: z.string().uuid().nullable(),
  projectId: z.string().uuid().nullable(),
  environmentId: z.string().uuid().nullable(),
  environment: EnvironmentRuntimeSchema,
  label: z.string(),
  owner: z.string().nullable(),
  team: z.string().nullable(),
  service: z.string().nullable(),
  issuanceMode: z.enum(["admin", "self_serve"]).default("admin"),
  issuedByMemberId: z.string().uuid().nullable().default(null),
  keyPrefix: z.string(),
  status: z.enum(["active", "revoked"]),
  scopes: z.array(z.string()).default([]).transform(normalizeVirtualKeyScopes),
  lastUsedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  createdAt: z.string(),
});

export const CreateVirtualKeyInputSchema = z.object({
  workspaceId: z.string().uuid(),
  providerConnectionId: z.string().uuid().nullable().default(null),
  projectId: z.string().uuid().nullable().default(null),
  environmentId: z.string().uuid().nullable().default(null),
  label: z.string().min(2).max(120),
  owner: z.string().trim().min(1).max(120).nullable().default(null),
  team: z.string().trim().min(1).max(120).nullable().default(null),
  service: z.string().trim().min(1).max(120).nullable().default(null),
  environment: EnvironmentRuntimeSchema.default("production"),
  scopes: z.array(z.string()).default([]).transform(normalizeVirtualKeyScopes),
  expiresAt: z.string().datetime().nullable().default(null),
});

export const CreatedVirtualKeyResponseSchema = VirtualKeySchema.extend({
  token: z.string(),
});

export const VirtualKeyInventorySummarySchema = z.object({
  total: z.number().int().min(0),
  active: z.number().int().min(0),
  revoked: z.number().int().min(0),
  expired: z.number().int().min(0),
  neverUsed: z.number().int().min(0),
  environmentBound: z.number().int().min(0),
});

export const VirtualKeyListResponseSchema = z.object({
  items: z.array(VirtualKeySchema),
  total: z.number().int().min(0),
  summary: VirtualKeyInventorySummarySchema,
});

export const BudgetPolicyExceptionStatusSchema = z.enum(["none", "requested", "approved", "rejected"]);

export const BudgetPolicySchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid().nullable(),
  environmentId: z.string().uuid().nullable(),
  environment: EnvironmentRuntimeSchema.nullable(),
  monthlyUsdLimit: z.number(),
  softLimitPercent: z.number().int(),
  status: z.enum(["active", "paused"]),
  exceptionStatus: BudgetPolicyExceptionStatusSchema,
  exceptionReason: z.string().nullable(),
  exceptionRequestedBy: z.string().nullable(),
  exceptionRequestedAt: z.string().nullable(),
  exceptionReviewedBy: z.string().nullable(),
  exceptionReviewedAt: z.string().nullable(),
  exceptionReviewNote: z.string().nullable(),
  exceptionExpiresAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const CreateBudgetPolicyInputSchema = z.object({
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid().nullable().default(null),
  environmentId: z.string().uuid().nullable().default(null),
  environment: EnvironmentRuntimeSchema.nullable().default(null),
  monthlyUsdLimit: z.number().positive(),
  softLimitPercent: z.number().int().min(1).max(100).default(80),
});

export const UpdateBudgetPolicyInputSchema = z
  .object({
    projectId: z.string().uuid().nullable().optional(),
    environmentId: z.string().uuid().nullable().optional(),
    environment: EnvironmentRuntimeSchema.nullable().optional(),
    monthlyUsdLimit: z.number().positive().optional(),
    softLimitPercent: z.number().int().min(1).max(100).optional(),
    status: z.enum(["active", "paused"]).optional(),
    exceptionStatus: BudgetPolicyExceptionStatusSchema.optional(),
    exceptionReason: z.string().trim().max(4_000).nullable().optional(),
    exceptionRequestedBy: z.string().trim().max(120).nullable().optional(),
    exceptionRequestedAt: z.string().datetime().nullable().optional(),
    exceptionReviewedBy: z.string().trim().max(120).nullable().optional(),
    exceptionReviewedAt: z.string().datetime().nullable().optional(),
    exceptionReviewNote: z.string().trim().max(4_000).nullable().optional(),
    exceptionExpiresAt: z.string().datetime().nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one budget field must be updated",
  });

export const BudgetPolicySummarySchema = BudgetPolicySchema.extend({
  scopeKind: BudgetScopeKindSchema,
  currentMonthSpendUsd: z.number(),
  remainingUsd: z.number(),
  softLimitUsd: z.number(),
  softLimitReached: z.boolean(),
  hardLimitReached: z.boolean(),
  preventedRequestsCount: z.number().int(),
  preventedEstimatedCostUsd: z.number(),
  preventedUnestimatedRequestsCount: z.number().int(),
});

export const UsageEventStatusBreakdownSchema = z.object({
  status: UsageEventStatusSchema,
  eventCount: z.number().int(),
  totalTokens: z.number().int(),
  totalCostUsd: z.number(),
});

export const UsageEventProviderBreakdownSchema = z.object({
  provider: ProviderKindSchema.nullable(),
  eventCount: z.number().int(),
  totalTokens: z.number().int(),
  totalCostUsd: z.number(),
});

export const UsageEventModelBreakdownSchema = z.object({
  model: z.string().nullable(),
  eventCount: z.number().int(),
  totalTokens: z.number().int(),
  totalCostUsd: z.number(),
});

export const UsageEventSummarySchema = z.object({
  totalEvents: z.number().int(),
  totalPromptTokens: z.number().int(),
  totalCompletionTokens: z.number().int(),
  totalTokens: z.number().int(),
  totalCostUsd: z.number(),
  averageLatencyMs: z.number().nullable(),
  successRate: z.number().nullable(),
  statusBreakdown: z.array(UsageEventStatusBreakdownSchema).default([]),
  providerBreakdown: z.array(UsageEventProviderBreakdownSchema).default([]),
  modelBreakdown: z.array(UsageEventModelBreakdownSchema).default([]),
});

export const UsageEventDailyPointSchema = z.object({
  bucketDate: z.string(),
  requestCount: z.number().int(),
  totalTokens: z.number().int(),
  totalCostUsd: z.number(),
  blockedCount: z.number().int(),
  errorCount: z.number().int(),
});

export const UsageEventDailySeriesSchema = z.array(UsageEventDailyPointSchema);

export const WorkspaceHomeOverviewPermissionSummarySchema = z.object({
  projects: z.boolean(),
  budgets: z.boolean(),
  usage: z.boolean(),
  providers: z.boolean(),
  virtualKeys: z.boolean(),
  selfServeVirtualKeys: z.boolean(),
  auditLogs: z.boolean(),
  exports: z.boolean(),
  members: z.boolean(),
  promptInspections: z.boolean(),
  promptInspectionReview: z.boolean(),
  promptPolicyWrite: z.boolean(),
});

export const WorkspaceHomeOverviewBudgetSummarySchema = z.object({
  activeBudgetCount: z.number().int().min(0),
  openBudgetAlertCount: z.number().int().min(0),
  blockingBudgetAlertCount: z.number().int().min(0),
});

export const WorkspaceHomeOverviewSchema = z.object({
  workspaceId: z.string().uuid(),
  permissions: WorkspaceHomeOverviewPermissionSummarySchema,
  projectCount: z.number().int().min(0).nullable(),
  environmentCount: z.number().int().min(0).nullable(),
  budgetSummary: WorkspaceHomeOverviewBudgetSummarySchema.nullable(),
  usageSummary: UsageEventSummarySchema.nullable(),
});

export const SelfServeAvailableTargetStatusSchema = z.enum([
  "ready",
  "missing_configured_models",
  "pricing_uncovered",
]);

export const SelfServeAvailableTargetReasonSchema = z
  .enum(["missing_configured_models", "pricing_uncovered"])
  .nullable();

export const SelfServeAvailableTargetSchema = z.object({
  providerConnectionId: z.string().uuid(),
  label: z.string(),
  provider: ProviderKindSchema,
  protocol: ProviderRoutingProtocolSchema,
  status: SelfServeAvailableTargetStatusSchema,
  reason: SelfServeAvailableTargetReasonSchema.default(null),
  uncoveredModels: z.array(z.string().min(1)).default([]),
});

export const SelfServeModelCatalogItemSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  ownedBy: z.string().min(1).nullable(),
});

export const SelfServeModelCatalogSchema = z.object({
  providerConnectionId: z.string().uuid(),
  fetchedAt: z.string(),
  items: z.array(SelfServeModelCatalogItemSchema),
});

export const CatalogModelStatusSchema = z.enum(["active", "archived"]);

export const CatalogModelSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  modelId: z.string().min(1),
  label: z.string().min(1),
  protocol: ProviderRoutingProtocolSchema,
  sourceProviderConnectionId: z.string().uuid(),
  sourceProviderConnectionLabel: z.string().min(1),
  sourceProvider: ProviderKindSchema,
  status: CatalogModelStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const UpsertCatalogModelInputSchema = z.object({
  modelId: z.string().min(1),
  label: z.string().min(1),
  sourceProviderConnectionId: z.string().uuid(),
  status: CatalogModelStatusSchema.default("active"),
});

export const SyncWorkspaceModelAssignmentsInputSchema = z.object({
  modelIds: z.array(z.string().uuid()).max(5_000).default([]),
});

export const WorkspaceModelAvailabilityStatusSchema = z.enum([
  "ready",
  "routing_ambiguous",
  "no_provider",
  "pricing_uncovered",
]);

export const WorkspaceModelAvailabilitySchema = CatalogModelSchema.extend({
  assigned: z.boolean(),
  availabilityStatus: WorkspaceModelAvailabilityStatusSchema,
  uncoveredConnectionIds: z.array(z.string().uuid()).default([]),
  candidateConnectionIds: z.array(z.string().uuid()).default([]),
  candidateConnectionLabels: z.array(z.string()).default([]),
  routingConflict: z
    .object({
      message: z.string(),
      candidateConnectionIds: z.array(z.string().uuid()).default([]),
    })
    .nullable()
    .default(null),
});

export const WorkspaceModelCatalogResponseSchema = z.object({
  workspaceId: z.string().uuid(),
  organizationId: z.string().uuid(),
  models: z.array(WorkspaceModelAvailabilitySchema),
  groupedBySource: z.array(
    z.object({
      providerConnectionId: z.string().uuid(),
      label: z.string().min(1),
      provider: ProviderKindSchema,
      protocol: ProviderRoutingProtocolSchema,
      models: z.array(WorkspaceModelAvailabilitySchema),
    }),
  ).default([]),
});

export const SelfServeProviderConnectionSummarySchema = z.object({
  id: z.string().uuid(),
  label: z.string(),
  provider: ProviderKindSchema,
  configuredModels: z.array(SelfServeModelCatalogItemSchema).default([]),
});

export const ProviderModelSourceSchema = z.enum(["preset", "catalog", "custom"]);

export const ProviderModelConfigItemSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).nullable().optional(),
  source: ProviderModelSourceSchema,
});

export const ProviderModelConfigSchema = z.object({
  version: z.literal(1),
  items: z.array(ProviderModelConfigItemSchema),
});

export const ProviderConnectionModelCatalogStatusSchema = z.enum(["ready", "empty", "error"]);
export const ProviderConnectionModelCatalogErrorCodeSchema = z
  .enum(["credential_unreadable", "credential_key_mismatch"])
  .nullable();

export const ProviderConnectionModelCatalogSchema = z.object({
  providerConnectionId: z.string().uuid().nullable(),
  fetchedAt: z.string(),
  status: ProviderConnectionModelCatalogStatusSchema,
  errorCode: ProviderConnectionModelCatalogErrorCodeSchema.default(null),
  message: z.string().nullable(),
  items: z.array(SelfServeModelCatalogItemSchema),
});

export const IssueSelfServeVirtualKeyInputSchema = z.object({
  projectId: z.string().uuid(),
  protocol: ProviderRoutingProtocolSchema,
});

export const SelfServeVirtualKeyBootstrapSchema = z.object({
  allowed: z.boolean(),
  allowedProjects: z.array(ProjectSchema),
  availableTargets: z.array(SelfServeAvailableTargetSchema),
  providerConnections: z.array(SelfServeProviderConnectionSummarySchema),
  availableModels: z.array(SelfServeModelCatalogItemSchema).default([]),
  availableSources: z.array(
    z.object({
      providerConnectionId: z.string().uuid(),
      label: z.string().min(1),
      provider: ProviderKindSchema,
      protocol: ProviderRoutingProtocolSchema,
      models: z.array(SelfServeModelCatalogItemSchema).default([]),
    }),
  ).default([]),
  activeTokens: z.array(VirtualKeySchema),
  defaults: z.object({
    ttlHours: z.number().int().positive(),
    environmentRuntime: EnvironmentRuntimeSchema,
    projectId: z.string().uuid().nullable(),
  }),
});

export const WorkspaceSetupStepStatusSchema = z.enum(["done", "next", "pending"]);
export const WorkspaceSetupStepIdSchema = z.enum([
  "project_environment",
  "provider_connection",
  "virtual_key",
  "members",
  "project_assignment",
  "ready_for_handoff",
]);

export const WorkspaceSetupStepSchema = z.object({
  id: WorkspaceSetupStepIdSchema,
  status: WorkspaceSetupStepStatusSchema,
  title: z.string(),
  description: z.string(),
  primaryHref: z.string(),
  secondaryHref: z.string().nullable().optional(),
});

export const WorkspaceSetupSummaryCountsSchema = z.object({
  projectCount: z.number().int().min(0),
  environmentCount: z.number().int().min(0),
  activeProviderCount: z.number().int().min(0),
  readyProviderCount: z.number().int().min(0),
  activeVirtualKeyCount: z.number().int().min(0),
  memberCount: z.number().int().min(0),
  scopedMembersWithoutProjects: z.number().int().min(0),
});

export const WorkspaceSetupSummarySchema = z.object({
  workspaceId: z.string().uuid(),
  mode: z.enum(["setup", "ready"]),
  nextStepId: WorkspaceSetupStepIdSchema.nullable(),
  steps: z.array(WorkspaceSetupStepSchema).length(6),
  counts: WorkspaceSetupSummaryCountsSchema,
});

export const UsageEventSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid().nullable(),
  projectId: z.string().uuid().nullable(),
  environmentId: z.string().uuid().nullable(),
  virtualKeyId: z.string().uuid().nullable(),
  providerConnectionId: z.string().uuid().nullable(),
  requestId: z.string().nullable(),
  providerRequestId: z.string().nullable(),
  provider: ProviderKindSchema.nullable(),
  model: z.string().nullable(),
  promptTokens: z.number().int(),
  completionTokens: z.number().int(),
  totalTokens: z.number().int(),
  costUsd: z.number(),
  latencyMs: z.number().int().nullable(),
  status: UsageEventStatusSchema,
  metadata: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.string(),
});

export const RecordUsageEventInputSchema = z.object({
  workspaceId: z.string().uuid().nullable().default(null),
  projectId: z.string().uuid().nullable().default(null),
  environmentId: z.string().uuid().nullable().default(null),
  virtualKeyId: z.string().uuid().nullable().default(null),
  providerConnectionId: z.string().uuid().nullable().default(null),
  requestId: z.string().nullable().default(null),
  providerRequestId: z.string().nullable().default(null),
  provider: ProviderKindSchema.nullable().default(null),
  model: z.string().nullable().default(null),
  promptTokens: z.number().int().min(0).default(0),
  completionTokens: z.number().int().min(0).default(0),
  costUsd: z.number().min(0).default(0),
  latencyMs: z.number().int().min(0).nullable().default(null),
  status: UsageEventStatusSchema,
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const ModelMappingSchema = z.object({
  id: z.string().uuid(),
  provider: ProviderKindSchema,
  providerModel: z.string(),
  canonicalModel: z.string(),
  modelFamily: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const PriceSnapshotSchema = z.object({
  id: z.string().uuid(),
  provider: ProviderKindSchema,
  providerConnectionId: z.string().uuid().nullable(),
  providerModel: z.string(),
  canonicalModel: z.string(),
  inputUsdPerMillion: z.number(),
  outputUsdPerMillion: z.number(),
  cachedInputUsdPerMillion: z.number().nullable(),
  cacheReadInputUsdPerMillion: z.number().nullable(),
  cacheWrite5mInputUsdPerMillion: z.number().nullable(),
  cacheWrite1hInputUsdPerMillion: z.number().nullable(),
  longContextThresholdInputTokens: z.number().int().nullable(),
  longContextInputUsdPerMillion: z.number().nullable(),
  longContextOutputUsdPerMillion: z.number().nullable(),
  longContextCacheReadInputUsdPerMillion: z.number().nullable(),
  longContextCacheWrite5mInputUsdPerMillion: z.number().nullable(),
  longContextCacheWrite1hInputUsdPerMillion: z.number().nullable(),
  pricingSource: PricingSourceSchema,
  metadata: z.record(z.string(), z.unknown()).default({}),
  capturedAt: z.string(),
});

export const UsageLedgerEntrySchema = z.object({
  id: z.string().uuid(),
  usageEventId: z.string().uuid(),
  organizationId: z.string().uuid().nullable(),
  workspaceId: z.string().uuid().nullable(),
  projectId: z.string().uuid().nullable(),
  environmentId: z.string().uuid().nullable(),
  providerConnectionId: z.string().uuid().nullable(),
  virtualKeyId: z.string().uuid().nullable(),
  owner: z.string().nullable(),
  provider: ProviderKindSchema.nullable(),
  providerModel: z.string().nullable(),
  canonicalModel: z.string().nullable(),
  modelFamily: z.string().nullable(),
  priceSnapshotId: z.string().uuid().nullable(),
  pricingSource: PricingSourceSchema,
  inputUsdPerMillion: z.number().nullable(),
  outputUsdPerMillion: z.number().nullable(),
  cachedInputUsdPerMillion: z.number().nullable(),
  cacheReadInputUsdPerMillion: z.number().nullable(),
  cacheWrite5mInputUsdPerMillion: z.number().nullable(),
  cacheWrite1hInputUsdPerMillion: z.number().nullable(),
  longContextThresholdInputTokens: z.number().int().nullable(),
  longContextInputUsdPerMillion: z.number().nullable(),
  longContextOutputUsdPerMillion: z.number().nullable(),
  longContextCacheReadInputUsdPerMillion: z.number().nullable(),
  longContextCacheWrite5mInputUsdPerMillion: z.number().nullable(),
  longContextCacheWrite1hInputUsdPerMillion: z.number().nullable(),
  status: UsageEventStatusSchema,
  requestId: z.string().nullable(),
  providerRequestId: z.string().nullable(),
  promptTokens: z.number().int(),
  completionTokens: z.number().int(),
  totalTokens: z.number().int(),
  costUsd: z.number(),
  eventDate: z.string(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.string(),
});

export const UsageForecastDailySchema = z.object({
  id: z.string().uuid(),
  bucketDate: z.string(),
  organizationId: z.string().uuid().nullable(),
  workspaceId: z.string().uuid().nullable(),
  projectId: z.string().uuid().nullable(),
  environmentId: z.string().uuid().nullable(),
  provider: ProviderKindSchema.nullable(),
  owner: z.string().nullable(),
  canonicalModel: z.string().nullable(),
  requestCount: z.number().int(),
  totalPromptTokens: z.number().int(),
  totalCompletionTokens: z.number().int(),
  totalTokens: z.number().int(),
  totalCostUsd: z.number(),
  firstEventAt: z.string().nullable(),
  lastEventAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const StableUsageLedgerExportSchemaVersion = "usage-ledger.v1" as const;

export const UsageLedgerExportRowSchema = z.object({
  schemaVersion: z.literal(StableUsageLedgerExportSchemaVersion),
  ledgerEntryId: z.string().uuid(),
  usageEventId: z.string().uuid(),
  eventDate: z.string(),
  createdAt: z.string(),
  organizationId: z.string().uuid().nullable(),
  workspaceId: z.string().uuid().nullable(),
  projectId: z.string().uuid().nullable(),
  environmentId: z.string().uuid().nullable(),
  providerConnectionId: z.string().uuid().nullable(),
  virtualKeyId: z.string().uuid().nullable(),
  owner: z.string().nullable(),
  provider: ProviderKindSchema.nullable(),
  providerModel: z.string().nullable(),
  canonicalModel: z.string().nullable(),
  modelFamily: z.string().nullable(),
  priceSnapshotId: z.string().uuid().nullable(),
  pricingSource: PricingSourceSchema,
  inputUsdPerMillion: z.number().nullable(),
  outputUsdPerMillion: z.number().nullable(),
  status: UsageEventStatusSchema,
  requestId: z.string().nullable(),
  providerRequestId: z.string().nullable(),
  promptTokens: z.number().int(),
  completionTokens: z.number().int(),
  totalTokens: z.number().int(),
  costUsd: z.number(),
  metadataJson: z.string(),
});

export const AuditLogSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid().nullable(),
  projectId: z.string().uuid().nullable(),
  environmentId: z.string().uuid().nullable(),
  actorType: z.string(),
  actorId: z.string(),
  action: z.string(),
  subjectType: z.string(),
  subjectId: z.string(),
  payload: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.string(),
});

export const PromptPolicySchema = z.object({
  workspaceId: z.string().uuid(),
  enabled: z.boolean().default(false),
  enforcementMode: PromptPolicyEnforcementModeSchema.default("graded"),
  evidenceMode: PromptPolicyEvidenceModeSchema.default("redacted_snippet"),
  reviewThreshold: z.number().int().min(0).max(10_000).default(60),
  blockThreshold: z.number().int().min(0).max(10_000).default(100),
  allowedExternalDomains: z.array(z.string().trim().min(1)).max(200).default([]),
  allowedKeywordOverrides: z.array(z.string().trim().min(1)).max(200).default([]),
  disabledRuleIds: z.array(z.string().trim().min(1)).max(500).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const UpdatePromptPolicyInputSchema = z
  .object({
    enabled: z.boolean().optional(),
    enforcementMode: PromptPolicyEnforcementModeSchema.optional(),
    evidenceMode: PromptPolicyEvidenceModeSchema.optional(),
    reviewThreshold: z.number().int().min(0).max(10_000).optional(),
    blockThreshold: z.number().int().min(0).max(10_000).optional(),
    allowedExternalDomains: z.array(z.string().trim().min(1)).max(200).optional(),
    allowedKeywordOverrides: z.array(z.string().trim().min(1)).max(200).optional(),
    disabledRuleIds: z.array(z.string().trim().min(1)).max(500).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one prompt policy field must be updated",
  });

export const PromptInspectionSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid().nullable(),
  environmentId: z.string().uuid().nullable(),
  virtualKeyId: z.string().uuid().nullable(),
  providerConnectionId: z.string().uuid().nullable(),
  usageEventId: z.string().uuid().nullable(),
  requestId: z.string(),
  provider: ProviderKindSchema.nullable(),
  model: z.string().nullable(),
  verdict: PromptInspectionVerdictSchema,
  score: z.number().int(),
  topActivityLabel: PromptActivityLabelSchema,
  riskCategories: z.array(PromptRiskCategorySchema).default([]),
  hitRuleIds: z.array(z.string()).default([]),
  redactedEvidence: z.array(z.string()).default([]),
  simhash: z.string().nullable(),
  truncated: z.boolean(),
  contextCounts: z.record(z.string(), z.unknown()).default({}),
  reviewStatus: PromptInspectionReviewStatusSchema,
  reviewedBy: z.string().nullable(),
  reviewNote: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  createdAt: z.string(),
});

const promptInspectionFilterFields = {
  workspaceId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  environmentId: z.string().uuid().optional(),
  virtualKeyId: z.string().uuid().optional(),
  providerConnectionId: z.string().uuid().optional(),
  usageEventId: z.string().uuid().optional(),
  requestId: z.string().trim().min(1).optional(),
  provider: ProviderKindSchema.optional(),
  model: z.string().trim().min(1).optional(),
  verdict: PromptInspectionVerdictSchema.optional(),
  reviewStatus: PromptInspectionReviewStatusSchema.optional(),
  riskCategory: PromptRiskCategorySchema.optional(),
  activityLabel: PromptActivityLabelSchema.optional(),
  escalatedOnly: z.coerce.boolean().optional(),
  sortBy: z.enum([
    "newest",
    "oldest",
    "score_desc",
    "score_asc",
    "verdict_priority",
    "review_status_priority",
    "provider_asc",
    "model_asc",
  ]).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
};

export const PromptReviewInputSchema = z.object({
  reviewStatus: PromptInspectionReviewStatusSchema.exclude(["pending"]),
  reviewNote: z.string().trim().min(1).max(4_000).nullable().default(null),
});

export const PromptBatchReviewInputSchema = z.object({
  workspaceId: z.string().uuid(),
  inspectionIds: z.array(z.string().uuid()).min(1).max(200),
  reviewStatus: PromptInspectionReviewStatusSchema.exclude(["pending"]),
  reviewNote: z.string().trim().min(1).max(4_000).nullable().default(null),
});

export const PromptInspectionVerdictBreakdownSchema = z.object({
  verdict: PromptInspectionVerdictSchema,
  count: z.number().int(),
});

export const PromptInspectionReviewBreakdownSchema = z.object({
  reviewStatus: PromptInspectionReviewStatusSchema,
  count: z.number().int(),
});

export const PromptInspectionRiskBreakdownSchema = z.object({
  riskCategory: PromptRiskCategorySchema,
  count: z.number().int(),
});

export const PromptInspectionActivityBreakdownSchema = z.object({
  activityLabel: PromptActivityLabelSchema,
  count: z.number().int(),
});

export const PromptInspectionSummarySchema = z.object({
  total: z.number().int().min(0),
  escalatedCount: z.number().int().min(0),
  verdictBreakdown: z.array(PromptInspectionVerdictBreakdownSchema).default([]),
  reviewStatusBreakdown: z.array(PromptInspectionReviewBreakdownSchema).default([]),
  riskCategoryBreakdown: z.array(PromptInspectionRiskBreakdownSchema).default([]),
  activityBreakdown: z.array(PromptInspectionActivityBreakdownSchema).default([]),
});

export const PromptBatchReviewResultSchema = z.object({
  batchId: z.string().uuid(),
  reviewedCount: z.number().int().min(0),
  inspectionIds: z.array(z.string().uuid()),
  reviewStatus: PromptInspectionReviewStatusSchema.exclude(["pending"]),
});

const ReportDeliveryTargetSchema = z.object({
  channel: ReportDeliveryChannelSchema,
  destination: z.string().trim().min(1).max(500),
  label: z.string().trim().min(1).max(120).optional(),
});

export const ReportDistributionSchema = z.object({
  enabled: z.boolean().default(false),
  targets: z.array(ReportDeliveryTargetSchema).max(24).default([]),
  includeDownloadLink: z.boolean().default(true),
  includeSignedSnapshot: z.boolean().default(false),
});

const reportWorkflowFields = {
  ownerLabel: z.string().trim().min(1).max(120).nullable().default(null),
  status: ReportWorkflowStatusSchema.default("pending"),
  note: z.string().trim().min(1).max(2_000).nullable().default(null),
  slaDueAt: z.string().datetime().nullable().default(null),
  updatedAt: z.string().datetime().nullable().default(null),
};

export const ReportWorkflowSchema = z.object(reportWorkflowFields);
export const ReportWorkflowPatchSchema = z.object({
  ownerLabel: reportWorkflowFields.ownerLabel.optional(),
  status: reportWorkflowFields.status.optional(),
  note: reportWorkflowFields.note.optional(),
  slaDueAt: reportWorkflowFields.slaDueAt.optional(),
  updatedAt: reportWorkflowFields.updatedAt.optional(),
});

const reportGovernanceFields = {
  approvalMode: ReportGovernanceApprovalModeSchema.default("none"),
  approvalStatus: ReportGovernanceApprovalStatusSchema.default("not_required"),
  approverLabel: z.string().trim().min(1).max(120).nullable().default(null),
  approvedAt: z.string().datetime().nullable().default(null),
  watermarkLabel: z.string().trim().min(1).max(160).nullable().default(null),
  retentionDays: z.number().int().min(1).max(3650).nullable().default(null),
  signedSnapshot: z.boolean().default(false),
};

export const ReportGovernanceSchema = z.object(reportGovernanceFields);
export const ReportGovernancePatchSchema = z.object({
  approvalMode: reportGovernanceFields.approvalMode.optional(),
  approvalStatus: reportGovernanceFields.approvalStatus.optional(),
  approverLabel: reportGovernanceFields.approverLabel.optional(),
  approvedAt: reportGovernanceFields.approvedAt.optional(),
  watermarkLabel: reportGovernanceFields.watermarkLabel.optional(),
  retentionDays: reportGovernanceFields.retentionDays.optional(),
  signedSnapshot: reportGovernanceFields.signedSnapshot.optional(),
});

export const EventDrivenTriggerSchema = z.object({
  enabled: z.boolean().default(false),
  events: z.array(EventDrivenTriggerEventSchema).max(8).default([]),
  scope: z.enum(["report-scope", "workspace"]).default("report-scope"),
  cooldownMinutes: z.number().int().min(0).max(10_080).default(60),
});

export const ExportJobSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  kind: ExportJobKindSchema,
  format: z.enum(["csv", "xlsx"]),
  status: ExportJobStatusSchema,
  fileName: z.string(),
  filters: z.record(z.string(), z.unknown()).default({}),
  rowCount: z.number().int().nullable(),
  errorMessage: z.string().nullable(),
  downloadPath: z.string().nullable(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  attemptCount: z.number().int().min(0).default(0),
});

export const SavedViewSurfaceSchema = z.enum(["usage-events", "audit-logs", "prompt-inspections"]);

export const SavedViewSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  surface: SavedViewSurfaceSchema,
  name: z.string(),
  filters: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastOpenedAt: z.string().nullable(),
});

export const AlertSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  severity: AlertSeveritySchema,
  code: z.string(),
  title: z.string(),
  body: z.string(),
  status: z.enum(["open", "resolved"]),
  metadata: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.string(),
  resolvedAt: z.string().nullable(),
});

export const AlertQuerySchema = z.object({
  workspaceId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  environmentId: z.string().uuid().optional(),
  status: z.enum(["open", "resolved"]).optional(),
  severity: AlertSeveritySchema.optional(),
  code: z.string().trim().min(1).optional(),
  budgetPolicyId: z.string().uuid().optional(),
});

export const UpdateAlertInputSchema = z
  .object({
    status: z.enum(["open", "resolved"]).optional(),
    metadataPatch: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one alert field must be updated",
  });

export const PaginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const VirtualKeyListQuerySchema = PaginationQuerySchema.extend({
  workspaceId: z.string().uuid().optional(),
});

export const PromptInspectionQuerySchema = PaginationQuerySchema.extend(promptInspectionFilterFields);
export const PromptInspectionSummaryQuerySchema = z.object(promptInspectionFilterFields);

export const UsageEventStatusGroupSchema = z.enum(["attention"]);
export const UsageEventSurfaceSchema = z.enum(["metadata", "streamed", "interrupted"]);
export const UsageEventSortSchema = z.enum(["newest", "oldest", "latency_desc", "cost_desc", "tokens_desc"]);

const usageEventFilterFields = {
  workspaceId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  environmentId: z.string().uuid().optional(),
  virtualKeyId: z.string().uuid().optional(),
  providerConnectionId: z.string().uuid().optional(),
  budgetPolicyId: z.string().uuid().optional(),
  provider: ProviderKindSchema.optional(),
  model: z.string().optional(),
  requestId: z.string().trim().min(1).optional(),
  providerRequestId: z.string().trim().min(1).optional(),
  status: z.enum(["success", "error", "blocked"]).optional(),
  statusGroup: UsageEventStatusGroupSchema.optional(),
  surface: UsageEventSurfaceSchema.optional(),
  minLatencyMs: z.coerce.number().int().min(0).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  distribution: ReportDistributionSchema.optional(),
  workflow: ReportWorkflowSchema.optional(),
  governance: ReportGovernanceSchema.optional(),
  eventTrigger: EventDrivenTriggerSchema.optional(),
};

const usageLedgerFilterFields = {
  ...usageEventFilterFields,
  organizationId: z.string().uuid().optional(),
  owner: z.string().trim().min(1).optional(),
  canonicalModel: z.string().trim().min(1).optional(),
  modelFamily: z.string().trim().min(1).optional(),
};

export const UsageEventQuerySchema = PaginationQuerySchema.extend({
  ...usageEventFilterFields,
  sortBy: UsageEventSortSchema.optional(),
});

export const UsageEventSummaryQuerySchema = z.object(usageEventFilterFields);

export const UsageEventDailyWindowSchema = z.enum(["7", "30"]);
export const UsageEventDailyQuerySchema = z.object({
  workspaceId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  environmentId: z.string().uuid().optional(),
  window: UsageEventDailyWindowSchema.optional(),
});

export const UsageEventDailyResponseSchema = z.object({
  window: z.number().int(),
  items: UsageEventDailySeriesSchema,
});

export const WorkspaceHomeSnapshotActivationAuditEntrySchema = z.object({
  action: z.string(),
  entry: AuditLogSchema.nullable(),
});

export const WorkspaceHomeSnapshotSchema = z.object({
  workspaceId: z.string().uuid(),
  overview: WorkspaceHomeOverviewSchema.nullable(),
  providerConnections: z.array(ProviderConnectionSchema),
  virtualKeys: VirtualKeyListResponseSchema,
  recentUsage: z.object({
    items: z.array(UsageEventSchema),
    total: z.number().int().min(0),
  }),
  recentAudit: z.object({
    items: z.array(AuditLogSchema),
    total: z.number().int().min(0),
  }),
  budgetSummaries: z.array(BudgetPolicySummarySchema),
  openAlerts: z.array(AlertSchema),
  dailyUsage: UsageEventDailyResponseSchema,
  activationAuditEntries: z.array(WorkspaceHomeSnapshotActivationAuditEntrySchema),
});

export const UsageForecastDailyListSchema = z.object({
  window: z.number().int(),
  items: z.array(UsageForecastDailySchema),
});

const auditLogFilterFields = {
  workspaceId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  environmentId: z.string().uuid().optional(),
  actorType: z.string().trim().min(1).optional(),
  actorId: z.string().trim().min(1).optional(),
  action: z.string().trim().min(1).optional(),
  subjectType: z.string().trim().min(1).optional(),
  subjectId: z.string().trim().min(1).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  distribution: ReportDistributionSchema.optional(),
  workflow: ReportWorkflowSchema.optional(),
  governance: ReportGovernanceSchema.optional(),
  eventTrigger: EventDrivenTriggerSchema.optional(),
};

export const AuditLogQuerySchema = PaginationQuerySchema.extend(auditLogFilterFields);

export const UsageEventExportFiltersSchema = z.object({
  ...usageEventFilterFields,
  sortBy: UsageEventSortSchema.optional(),
  projectIds: z.array(z.string().uuid()).max(200).optional(),
});

export const UsageLedgerExportFiltersSchema = z.object({
  ...usageLedgerFilterFields,
  sortBy: UsageEventSortSchema.optional(),
  projectIds: z.array(z.string().uuid()).max(200).optional(),
});

export const AuditLogExportFiltersSchema = z.object({
  ...auditLogFilterFields,
  projectIds: z.array(z.string().uuid()).max(200).optional(),
});

const CreateExportJobBaseSchema = z.object({
  workspaceId: z.string().uuid(),
  format: z.enum(["csv", "xlsx"]).default("csv"),
  fileName: z.string().min(3).max(255).optional(),
});

export const CreateUsageExportJobInputSchema = CreateExportJobBaseSchema.extend({
  kind: z.literal("usage-events"),
  filters: UsageEventExportFiltersSchema.default({}),
});

export const CreateAuditExportJobInputSchema = CreateExportJobBaseSchema.extend({
  kind: z.literal("audit-logs"),
  filters: AuditLogExportFiltersSchema.default({}),
});

export const CreateUsageLedgerExportJobInputSchema = CreateExportJobBaseSchema.extend({
  kind: z.literal("usage-ledger"),
  filters: UsageLedgerExportFiltersSchema.default({}),
});

export const CreateExportJobInputSchema = z.discriminatedUnion("kind", [
  CreateUsageExportJobInputSchema,
  CreateAuditExportJobInputSchema,
  CreateUsageLedgerExportJobInputSchema,
]);

export const UpdateExportJobInputSchema = z
  .object({
    filtersPatch: z
      .object({
        workflow: ReportWorkflowPatchSchema.optional(),
        governance: ReportGovernancePatchSchema.optional(),
      })
      .refine((value) => Object.keys(value).length > 0, {
        message: "At least one export job filter patch must be provided",
      })
      .optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one export job field must be updated",
  });

export const FingerprintArtifactSchema = z.object({
  artifactRole: z.string().trim().min(1).max(120),
  relativePath: z.string().trim().min(1).max(1_024),
  objectKey: z.string().trim().min(1).max(1_024).nullable().default(null),
  sha256: z.string().trim().min(16).max(128),
  sizeBytes: z.number().int().nonnegative().nullable().default(null),
  embedLocator: z.record(z.string(), z.unknown()).default({}),
});
export const ArtifactAttestationSchema = FingerprintArtifactSchema;

export const WatermarkFamilySummarySchema = z.object({
  family: z.string().trim().min(1).max(120),
  symbol: z.number().int().min(0).nullable().default(null),
  hitCount: z.number().int().min(0),
});

export const BuildDescriptorArtifactSchema = z.object({
  artifactRole: z.string().trim().min(1).max(120),
  relativePath: z.string().trim().min(1).max(1_024),
  objectKey: z.string().trim().min(1).max(1_024).nullable().default(null),
});

export const LineageBuildDescriptorSchema = z.object({
  lineageId: z.string().trim().min(1),
  lineageToken: z.string().trim().min(1),
  customerId: z.string().trim().min(1),
  deploymentId: z.string().trim().min(1),
  releaseId: z.string().trim().min(1),
  manifestHash: z.string().trim().min(1),
  attestationBundleId: z.string().trim().min(1),
  channel: z.string().trim().min(1),
  version: z.string().trim().min(1),
  gitCommitSha: z.string().trim().min(1).nullable().default(null),
  declaredArtifacts: z.array(BuildDescriptorArtifactSchema).max(500).default([]),
  watermarkProfile: z.string().trim().min(1),
  schemeVersion: z.string().trim().min(1),
});

export const FingerprintArtifactVerificationStatusSchema = z.enum([
  "pending",
  "matched",
  "partial",
  "mismatch",
  "unverifiable",
]);

export const FingerprintArtifactVerificationSourceSchema = z.enum([
  "declared",
  "build_report",
  "artifact_extract",
  "manual",
]);

export const ArtifactVerificationRecordSchema = FingerprintArtifactSchema.extend({
  buildLocator: z.string().trim().min(1).max(120).nullable().default(null),
  codewordDigest: z.string().trim().min(1).max(128).nullable().default(null),
  candidateCount: z.number().int().min(0).nullable().default(null),
  assignmentCount: z.number().int().min(0).nullable().default(null),
  familySummary: z.array(WatermarkFamilySummarySchema).default([]),
  verificationSource: FingerprintArtifactVerificationSourceSchema.nullable().default(null),
  verificationStatus: FingerprintArtifactVerificationStatusSchema.default("pending"),
  lastVerifiedAt: z.string().nullable().default(null),
});

export const ArtifactExtractorObservedArtifactSchema = z.object({
  artifactRole: z.string().trim().min(1).max(120),
  relativePath: z.string().trim().min(1).max(1_024),
  sha256: z.string().trim().min(16).max(128),
  sizeBytes: z.number().int().nonnegative().nullable().default(null),
  buildLocator: z.string().trim().min(1).max(120).nullable().default(null),
  codewordDigest: z.string().trim().min(1).max(128).nullable().default(null),
  candidateCount: z.number().int().min(0).nullable().default(null),
  assignmentCount: z.number().int().min(0).nullable().default(null),
  familySummary: z.array(WatermarkFamilySummarySchema).default([]),
});

export const ArtifactExtractorSummarySchema = z.object({
  observedArtifacts: z.array(ArtifactExtractorObservedArtifactSchema).max(500).default([]),
  recoveredLocator: z.string().trim().min(1).max(120).nullable().default(null),
  locatorCandidates: z.array(z.string().trim().min(1).max(120)).max(50).default([]),
  codewordDigest: z.string().trim().min(1).max(128).nullable().default(null),
  digestCandidates: z.array(z.string().trim().min(1).max(128)).max(50).default([]),
  familyHitSummary: z.array(WatermarkFamilySummarySchema).default([]),
  matchStatus: FingerprintArtifactVerificationStatusSchema,
});

export const VerifyLineageArtifactsInputSchema = z.object({
  extractor: ArtifactExtractorSummarySchema,
});

export const VerifiedLineageArtifactSchema = ArtifactVerificationRecordSchema.extend({
  expectedSha256: z.string().trim().min(16).max(128),
  observedSha256: z.string().trim().min(16).max(128).nullable().default(null),
  matchStatus: FingerprintArtifactVerificationStatusSchema,
});

export const VerifyLineageArtifactsResponseSchema = z.object({
  lineageId: z.string().trim().min(1),
  matchStatus: FingerprintArtifactVerificationStatusSchema,
  artifacts: z.array(VerifiedLineageArtifactSchema).default([]),
  recoveredLocator: z.string().trim().min(1).max(120).nullable().default(null),
  locatorCandidates: z.array(z.string().trim().min(1).max(120)).max(50).default([]),
  codewordDigest: z.string().trim().min(1).max(128).nullable().default(null),
  digestCandidates: z.array(z.string().trim().min(1).max(128)).max(50).default([]),
  familyHitSummary: z.array(WatermarkFamilySummarySchema).default([]),
  verifiedAt: z.string(),
});

export const CustomerDeploymentSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid().nullable(),
  customerId: z.string(),
  deploymentId: z.string(),
  deploymentName: z.string(),
  deploymentMode: FingerprintDeploymentModeSchema,
  region: z.string().nullable(),
  installChannel: z.string().nullable(),
  status: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastSeenAt: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const ReleaseCatalogEntrySchema = z.object({
  id: z.string().uuid(),
  releaseId: z.string(),
  channel: z.string(),
  version: z.string(),
  gitCommitSha: z.string().nullable(),
  buildSystem: z.string().nullable(),
  manifestHash: z.string(),
  artifactManifest: z.record(z.string(), z.unknown()).default({}),
  publishedAt: z.string(),
  supersededAt: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const FingerprintKeyVersionSchema = z.object({
  id: z.string().uuid(),
  keyId: z.string(),
  purpose: FingerprintKeyPurposeSchema,
  algorithm: FingerprintKeyAlgorithmSchema,
  status: FingerprintKeyStatusSchema,
  wrappingKeyRef: z.string(),
  publicKeyMaterial: z.string().nullable(),
  createdByType: z.string(),
  createdById: z.string(),
  createdAt: z.string(),
  activatedAt: z.string().nullable(),
  retiredAt: z.string().nullable(),
  destroyAfter: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export const LineageKeyVersionSchema = FingerprintKeyVersionSchema;

export const FingerprintKeyVersionListQuerySchema = z.object({
  purpose: FingerprintKeyPurposeSchema.optional(),
});
export const LineageKeyVersionListQuerySchema = FingerprintKeyVersionListQuerySchema;

export const RotateFingerprintKeyVersionInputSchema = z.object({
  purpose: FingerprintKeyPurposeSchema,
});
export const RotateLineageKeyVersionInputSchema = RotateFingerprintKeyVersionInputSchema;

export const EvidenceBundleSchema = z.object({
  id: z.string().uuid(),
  evidenceBundleId: z.string(),
  fingerprintId: z.string().nullable(),
  exportJobId: z.string().uuid().nullable(),
  bundleKind: EvidenceBundleKindSchema,
  objectKey: z.string().nullable(),
  contentSha256: z.string(),
  contentSizeBytes: z.number().int().nullable(),
  generatedAt: z.string(),
  retainedUntil: z.string().nullable(),
  legalHold: z.boolean(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const AttestationBundleSchema = EvidenceBundleSchema.extend({
  attestationBundleId: z.string(),
  lineageId: z.string().nullable(),
}).transform((value) => ({
  ...value,
  attestationBundleId: value.evidenceBundleId,
  lineageId: value.fingerprintId,
}));

export const FingerprintIssuanceSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid().nullable(),
  customerId: z.string(),
  deploymentId: z.string(),
  releaseId: z.string(),
  manifestHash: z.string(),
  fingerprintId: z.string(),
  fingerprintToken: z.string(),
  status: FingerprintIssuanceStatusSchema,
  issuedByType: z.string(),
  issuedById: z.string(),
  issuedAt: z.string(),
  hmacKeyId: z.string(),
  signingKeyId: z.string(),
  evidenceBundleId: z.string(),
  evidenceRootHash: z.string(),
  revokedAt: z.string().nullable(),
  revokedByType: z.string().nullable(),
  revokedById: z.string().nullable(),
  revokeReason: z.string().nullable(),
  deployment: CustomerDeploymentSchema.nullable().default(null),
  release: ReleaseCatalogEntrySchema.nullable().default(null),
  artifacts: z.array(ArtifactVerificationRecordSchema).default([]),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const LineageIssuanceSchema = FingerprintIssuanceSchema.extend({
  lineageId: z.string(),
  lineageToken: z.string(),
  attestationBundleId: z.string(),
  attestationRootHash: z.string(),
  artifactAttestations: z.array(ArtifactVerificationRecordSchema).default([]),
  buildDescriptor: LineageBuildDescriptorSchema.nullable().default(null),
}).transform((value) => ({
  ...value,
  lineageId: value.fingerprintId,
  lineageToken: value.fingerprintToken,
  attestationBundleId: value.evidenceBundleId,
  attestationRootHash: value.evidenceRootHash,
  artifactAttestations: value.artifacts,
}));

export const IssueFingerprintInputSchema = z.object({
  deploymentId: z.string().trim().min(1).max(120).optional(),
  deploymentName: z.string().trim().min(1).max(120),
  deploymentMode: FingerprintDeploymentModeSchema,
  region: z.string().trim().min(1).max(120).nullable().default(null),
  installChannel: z.string().trim().min(1).max(120).nullable().default(null),
  releaseId: z.string().trim().min(1).max(120).optional(),
  channel: z.string().trim().min(1).max(120),
  version: z.string().trim().min(1).max(120),
  gitCommitSha: z.string().trim().min(1).max(160).nullable().default(null),
  buildSystem: z.string().trim().min(1).max(120).nullable().default(null),
  artifactManifest: z.record(z.string(), z.unknown()).default({}),
  artifacts: z.array(FingerprintArtifactSchema).max(500).default([]),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export const IssueLineageInputSchema = IssueFingerprintInputSchema;

export const BuildDescriptorResponseSchema = z.object({
  buildDescriptor: LineageBuildDescriptorSchema,
});

export const RevokeFingerprintInputSchema = z.object({
  reason: z.string().trim().min(1).max(4_000),
});
export const RevokeLineageInputSchema = RevokeFingerprintInputSchema;

export const FingerprintLookupQuerySchema = z
  .object({
    fingerprintId: z.string().trim().min(1).optional(),
    fingerprintToken: z.string().trim().min(1).optional(),
    customerId: z.string().trim().min(1).optional(),
    deploymentId: z.string().trim().min(1).optional(),
    releaseId: z.string().trim().min(1).optional(),
    manifestHash: z.string().trim().min(1).optional(),
    status: FingerprintIssuanceStatusSchema.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .refine(
    (value) =>
      Boolean(
        value.fingerprintId ||
          value.fingerprintToken ||
          value.customerId ||
          value.deploymentId ||
          value.releaseId ||
          value.manifestHash ||
          value.status,
      ),
    {
      message: "At least one fingerprint lookup filter must be provided",
    },
  );

export const LineageLookupQuerySchema = z
  .object({
    lineageId: z.string().trim().min(1).optional(),
    lineageToken: z.string().trim().min(1).optional(),
    customerId: z.string().trim().min(1).optional(),
    deploymentId: z.string().trim().min(1).optional(),
    releaseId: z.string().trim().min(1).optional(),
    manifestHash: z.string().trim().min(1).optional(),
    status: FingerprintIssuanceStatusSchema.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .refine(
    (value) =>
      Boolean(
        value.lineageId ||
          value.lineageToken ||
          value.customerId ||
          value.deploymentId ||
          value.releaseId ||
          value.manifestHash ||
          value.status,
      ),
    {
      message: "At least one lineage lookup filter must be provided",
    },
  );

export const FingerprintListResponseSchema = z.object({
  items: z.array(FingerprintIssuanceSchema),
  total: z.number().int().min(0),
});

export const LineageListResponseSchema = z.object({
  items: z.array(LineageIssuanceSchema),
  total: z.number().int().min(0),
});

export const SavedViewListQuerySchema = z.object({
  workspaceId: z.string().uuid(),
  surface: SavedViewSurfaceSchema,
});

export const CreateSavedViewInputSchema = z.object({
  workspaceId: z.string().uuid(),
  surface: SavedViewSurfaceSchema,
  name: z.string().trim().min(1).max(120),
  filters: z.record(z.string(), z.unknown()).default({}),
});

export const UpdateSavedViewInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    filters: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one saved view field must be updated",
  });

export const ScheduledReportCadenceSchema = z.enum(["daily", "weekly", "monthly"]);

export const ScheduledReportSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  kind: z.enum(["usage-events", "audit-logs"]),
  format: z.enum(["csv", "xlsx"]),
  name: z.string(),
  filters: z.record(z.string(), z.unknown()).default({}),
  cadence: ScheduledReportCadenceSchema,
  nextRunAt: z.string(),
  lastRunAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const ScheduledReportListQuerySchema = z.object({
  workspaceId: z.string().uuid(),
});

const CreateScheduledReportBaseSchema = z.object({
  workspaceId: z.string().uuid(),
  format: z.enum(["csv", "xlsx"]).default("csv"),
  name: z.string().trim().min(1).max(120),
  cadence: ScheduledReportCadenceSchema,
});

export const CreateUsageScheduledReportInputSchema = CreateScheduledReportBaseSchema.extend({
  kind: z.literal("usage-events"),
  filters: UsageEventExportFiltersSchema.default({}),
});

export const CreateAuditScheduledReportInputSchema = CreateScheduledReportBaseSchema.extend({
  kind: z.literal("audit-logs"),
  filters: AuditLogExportFiltersSchema.default({}),
});

export const CreateScheduledReportInputSchema = z.discriminatedUnion("kind", [
  CreateUsageScheduledReportInputSchema,
  CreateAuditScheduledReportInputSchema,
]);

const UpdateScheduledReportBaseSchema = z.object({
  format: z.enum(["csv", "xlsx"]).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  cadence: ScheduledReportCadenceSchema.optional(),
});

export const UpdateUsageScheduledReportInputSchema = UpdateScheduledReportBaseSchema.extend({
  kind: z.literal("usage-events").optional(),
  filters: UsageEventExportFiltersSchema.optional(),
});

export const UpdateAuditScheduledReportInputSchema = UpdateScheduledReportBaseSchema.extend({
  kind: z.literal("audit-logs").optional(),
  filters: AuditLogExportFiltersSchema.optional(),
});

export const UpdateScheduledReportInputSchema = z
  .union([UpdateUsageScheduledReportInputSchema, UpdateAuditScheduledReportInputSchema])
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one scheduled report field must be updated",
  });

export const GatewayRequestStubSchema = z.object({
  model: z.string().min(1),
}).passthrough();

export const CommonReportTemplateIdSchema = z.enum([
  "daily-burn-rate",
  "weekly-chargeback",
  "monthly-management-summary",
  "provider-reconciliation",
  "forecast-watchlist",
  "workspace-cost-breakdown",
]);

export const CommonReportTemplateSchema = z.object({
  id: CommonReportTemplateIdSchema,
  name: z.string(),
  description: z.string(),
  kind: ExportJobKindSchema,
  cadence: z.enum(["adhoc", "daily", "weekly", "monthly"]),
  format: z.enum(["csv", "xlsx"]),
  focus: z.string(),
  filters: z.record(z.string(), z.unknown()).default({}),
});

export type MemberRole = z.infer<typeof MemberRoleSchema>;
export type LegacyMemberRole = z.infer<typeof LegacyMemberRoleSchema>;
export type MemberStatus = z.infer<typeof MemberStatusSchema>;
export type WorkspacePermission = z.infer<typeof WorkspacePermissionSchema>;
export type ProviderRoutingProtocol = z.infer<typeof ProviderRoutingProtocolSchema>;
export type VirtualKeyGatewayScope = z.infer<typeof VirtualKeyGatewayScopeSchema>;

const virtualKeyGatewayScopeSet = new Set<string>(VirtualKeyGatewayScopeValues);

export function isVirtualKeyGatewayScope(scope: string): scope is VirtualKeyGatewayScope {
  return virtualKeyGatewayScopeSet.has(scope);
}

export function getReservedVirtualKeyScopes(scopes: readonly string[]) {
  const normalizedInputScopes = normalizeVirtualKeyScopes(scopes);
  const reservedScopes = new Set<VirtualKeyGatewayScope>();

  for (const scope of normalizedInputScopes) {
    const normalizedScope = scope.toLowerCase();
    if (isVirtualKeyGatewayScope(normalizedScope)) {
      reservedScopes.add(normalizedScope);
    }
  }

  return [...reservedScopes];
}

export function normalizeVirtualKeyScopes(scopes: readonly string[]) {
  const normalizedScopes: string[] = [];
  const seenScopes = new Set<string>();

  for (const scope of scopes) {
    const trimmedScope = scope.trim();
    if (!trimmedScope) {
      continue;
    }

    const lowerCaseScope = trimmedScope.toLowerCase();
    const normalizedScope = isVirtualKeyGatewayScope(lowerCaseScope) ? lowerCaseScope : trimmedScope;
    if (seenScopes.has(normalizedScope)) {
      continue;
    }

    seenScopes.add(normalizedScope);
    normalizedScopes.push(normalizedScope);
  }

  return normalizedScopes;
}

export function normalizeMemberRole(role: string): MemberRole | null {
  switch (role) {
    case "project_maintainer":
    case "finance_viewer":
      return "developer";
    case "organization_owner":
    case "workspace_admin":
    case "developer":
      return role;
    default:
      return null;
  }
}

const memberRolePermissions = {
  organization_owner: WorkspacePermissionSchema.options,
  workspace_admin: WorkspacePermissionSchema.options,
  developer: [
    "organization.read",
    "workspace.read",
    "project.read",
    "project.write",
    "environment.read",
    "environment.write",
    "budget.read",
    "budget.write",
    "audit_log.read",
    "export.read",
    "export.write",
    "usage.read",
    "prompt_inspection.read",
    "prompt_inspection.write",
    "virtual_key.read",
    "virtual_key.write",
    "alert.read",
    "alert.write",
  ],
} satisfies Record<MemberRole, readonly WorkspacePermission[]>;

export function listRolePermissions(role: MemberRole): WorkspacePermission[] {
  return [...memberRolePermissions[role]];
}

export function roleHasPermission(role: MemberRole, permission: WorkspacePermission) {
  const permissions: readonly WorkspacePermission[] = memberRolePermissions[role];
  return permissions.includes(permission);
}

export function roleUsesProjectAssignments(role: MemberRole) {
  return role === "developer";
}

export function rolesUseProjectAssignments(roles: readonly MemberRole[]) {
  return roles.some((role) => roleUsesProjectAssignments(role));
}

export function memberUsesProjectAssignments(input: {
  role: MemberRole;
  roles?: readonly MemberRole[] | null;
}) {
  const resolvedRoles =
    input.roles === undefined || input.roles === null ? [input.role] : input.roles;
  return rolesUseProjectAssignments(resolvedRoles);
}

export type Organization = z.infer<typeof OrganizationSchema>;
export type OrganizationSummary = z.infer<typeof OrganizationSummarySchema>;
export type ControlPlaneOperatorStatus = z.infer<typeof ControlPlaneOperatorStatusSchema>;
export type IdentityProviderType = z.infer<typeof IdentityProviderTypeSchema>;
export type IdentityProviderStatus = z.infer<typeof IdentityProviderStatusSchema>;
export type ControlPlaneOperator = z.infer<typeof ControlPlaneOperatorSchema>;
export type IdentityProvider = z.infer<typeof IdentityProviderSchema>;
export type UpsertIdentityProviderInput = z.infer<typeof UpsertIdentityProviderInputSchema>;
export type AuthLoginStartInput = z.infer<typeof AuthLoginStartInputSchema>;
export type AuthLoginStartResponse = z.infer<typeof AuthLoginStartResponseSchema>;
export type AuthLoginCallbackInput = z.infer<typeof AuthLoginCallbackInputSchema>;
export type AuthLoginCallbackResponse = z.infer<typeof AuthLoginCallbackResponseSchema>;
export type AuthTestLoginInput = z.infer<typeof AuthTestLoginInputSchema>;
export type AuthSession = z.infer<typeof AuthSessionSchema>;
export type UpdateWorkspaceGuidePreferenceInput = z.infer<typeof UpdateWorkspaceGuidePreferenceInputSchema>;
export type CreateOrganizationInput = z.infer<typeof CreateOrganizationInputSchema>;
export type UpdateOrganizationInput = z.infer<typeof UpdateOrganizationInputSchema>;
export type Workspace = z.infer<typeof WorkspaceSchema>;
export type WorkspaceOption = z.infer<typeof WorkspaceOptionSchema>;
export type CreateWorkspaceInput = z.infer<typeof CreateWorkspaceInputSchema>;
export type UpdateWorkspaceInput = z.infer<typeof UpdateWorkspaceInputSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type CreateProjectInput = z.infer<typeof CreateProjectInputSchema>;
export type UpdateProjectInput = z.infer<typeof UpdateProjectInputSchema>;
export type Environment = z.infer<typeof EnvironmentSchema>;
export type CreateEnvironmentInput = z.infer<typeof CreateEnvironmentInputSchema>;
export type UpdateEnvironmentInput = z.infer<typeof UpdateEnvironmentInputSchema>;
export type Member = z.infer<typeof MemberSchema>;
export type MemberProjectAssignment = z.infer<typeof MemberProjectAssignmentSchema>;
export type CreateMemberInput = z.infer<typeof CreateMemberInputSchema>;
export type UpdateMemberInput = z.infer<typeof UpdateMemberInputSchema>;
export type ReplaceMemberProjectAssignmentsInput = z.infer<typeof ReplaceMemberProjectAssignmentsInputSchema>;
export type ProviderConnection = z.infer<typeof ProviderConnectionSchema>;
export type CreateProviderConnectionInput = z.infer<typeof CreateProviderConnectionInputSchema>;
export type UpdateProviderConnectionInput = z.infer<typeof UpdateProviderConnectionInputSchema>;
export type ProviderConnectionTestResponse = z.infer<typeof ProviderConnectionTestResponseSchema>;
export type VirtualKey = z.infer<typeof VirtualKeySchema>;
export type CreateVirtualKeyInput = z.infer<typeof CreateVirtualKeyInputSchema>;
export type CreatedVirtualKeyResponse = z.infer<typeof CreatedVirtualKeyResponseSchema>;
export type VirtualKeyInventorySummary = z.infer<typeof VirtualKeyInventorySummarySchema>;
export type VirtualKeyListResponse = z.infer<typeof VirtualKeyListResponseSchema>;
export type VirtualKeyListQuery = z.infer<typeof VirtualKeyListQuerySchema>;
export type ReportDeliveryChannel = z.infer<typeof ReportDeliveryChannelSchema>;
export type EventDrivenTriggerEvent = z.infer<typeof EventDrivenTriggerEventSchema>;
export type ReportWorkflowStatus = z.infer<typeof ReportWorkflowStatusSchema>;
export type ReportGovernanceApprovalMode = z.infer<typeof ReportGovernanceApprovalModeSchema>;
export type ReportGovernanceApprovalStatus = z.infer<typeof ReportGovernanceApprovalStatusSchema>;
export type BudgetPolicyExceptionStatus = z.infer<typeof BudgetPolicyExceptionStatusSchema>;
export type BudgetPolicy = z.infer<typeof BudgetPolicySchema>;
export type CreateBudgetPolicyInput = z.infer<typeof CreateBudgetPolicyInputSchema>;
export type UpdateBudgetPolicyInput = z.infer<typeof UpdateBudgetPolicyInputSchema>;
export type BudgetPolicySummary = z.infer<typeof BudgetPolicySummarySchema>;
export type UsageEventSummary = z.infer<typeof UsageEventSummarySchema>;
export type UsageEventDailyPoint = z.infer<typeof UsageEventDailyPointSchema>;
export type UsageEventDailySeries = z.infer<typeof UsageEventDailySeriesSchema>;
export type UsageEventDailyResponse = z.infer<typeof UsageEventDailyResponseSchema>;
export type WorkspaceHomeOverviewPermissionSummary = z.infer<
  typeof WorkspaceHomeOverviewPermissionSummarySchema
>;
export type WorkspaceHomeOverviewBudgetSummary = z.infer<
  typeof WorkspaceHomeOverviewBudgetSummarySchema
>;
export type WorkspaceHomeOverview = z.infer<
  typeof WorkspaceHomeOverviewSchema
>;
export type WorkspaceSetupStepStatus = z.infer<
  typeof WorkspaceSetupStepStatusSchema
>;
export type WorkspaceSetupStepId = z.infer<
  typeof WorkspaceSetupStepIdSchema
>;
export type WorkspaceSetupStep = z.infer<
  typeof WorkspaceSetupStepSchema
>;
export type WorkspaceSetupSummaryCounts = z.infer<
  typeof WorkspaceSetupSummaryCountsSchema
>;
export type WorkspaceSetupSummary = z.infer<
  typeof WorkspaceSetupSummarySchema
>;
export type WorkspaceHomeSnapshotActivationAuditEntry = z.infer<
  typeof WorkspaceHomeSnapshotActivationAuditEntrySchema
>;
export type WorkspaceHomeSnapshot = z.infer<
  typeof WorkspaceHomeSnapshotSchema
>;
export type ProviderPricingRates = z.infer<typeof ProviderPricingRatesSchema>;
export type ProviderPricingRule = z.infer<typeof ProviderPricingRuleSchema>;
export type ProviderPricingConfig = z.infer<typeof ProviderPricingConfigSchema>;
export type BuiltinPricingProvider = z.infer<typeof BuiltinPricingProviderSchema>;
export type BuiltinPricingCatalogEntry = z.infer<typeof BuiltinPricingCatalogEntrySchema>;
export type UsageEvent = z.infer<typeof UsageEventSchema>;
export type RecordUsageEventInput = z.infer<typeof RecordUsageEventInputSchema>;
export type ModelMapping = z.infer<typeof ModelMappingSchema>;
export type PriceSnapshot = z.infer<typeof PriceSnapshotSchema>;
export type UsageLedgerEntry = z.infer<typeof UsageLedgerEntrySchema>;
export type UsageForecastDaily = z.infer<typeof UsageForecastDailySchema>;
export type UsageLedgerExportRow = z.infer<typeof UsageLedgerExportRowSchema>;
export type AuditLog = z.infer<typeof AuditLogSchema>;
export type PromptPolicyEnforcementMode = z.infer<typeof PromptPolicyEnforcementModeSchema>;
export type PromptPolicyEvidenceMode = z.infer<typeof PromptPolicyEvidenceModeSchema>;
export type PromptInspectionVerdict = z.infer<typeof PromptInspectionVerdictSchema>;
export type PromptRiskCategory = z.infer<typeof PromptRiskCategorySchema>;
export type PromptActivityLabel = z.infer<typeof PromptActivityLabelSchema>;
export type PromptInspectionReviewStatus = z.infer<typeof PromptInspectionReviewStatusSchema>;
export type PromptPolicy = z.infer<typeof PromptPolicySchema>;
export type UpdatePromptPolicyInput = z.infer<typeof UpdatePromptPolicyInputSchema>;
export type PromptInspection = z.infer<typeof PromptInspectionSchema>;
export type PromptInspectionQuery = z.infer<typeof PromptInspectionQuerySchema>;
export type PromptInspectionSort = NonNullable<PromptInspectionQuery["sortBy"]>;
export type PromptInspectionSummary = z.infer<typeof PromptInspectionSummarySchema>;
export type PromptReviewInput = z.infer<typeof PromptReviewInputSchema>;
export type PromptBatchReviewInput = z.infer<typeof PromptBatchReviewInputSchema>;
export type PromptBatchReviewResult = z.infer<typeof PromptBatchReviewResultSchema>;
export type SavedViewSurface = z.infer<typeof SavedViewSurfaceSchema>;
export type SavedView = z.infer<typeof SavedViewSchema>;
export type ScheduledReportCadence = z.infer<typeof ScheduledReportCadenceSchema>;
export type ScheduledReport = z.infer<typeof ScheduledReportSchema>;
export type AlertQuery = z.infer<typeof AlertQuerySchema>;
export type UpdateAlertInput = z.infer<typeof UpdateAlertInputSchema>;
export type ReportDistribution = z.infer<typeof ReportDistributionSchema>;
export type ReportWorkflow = z.infer<typeof ReportWorkflowSchema>;
export type ReportWorkflowPatch = z.infer<typeof ReportWorkflowPatchSchema>;
export type ReportGovernance = z.infer<typeof ReportGovernanceSchema>;
export type ReportGovernancePatch = z.infer<typeof ReportGovernancePatchSchema>;
export type EventDrivenTrigger = z.infer<typeof EventDrivenTriggerSchema>;
export type UsageEventExportFilters = z.infer<typeof UsageEventExportFiltersSchema>;
export type UsageLedgerExportFilters = z.infer<typeof UsageLedgerExportFiltersSchema>;
export type AuditLogExportFilters = z.infer<typeof AuditLogExportFiltersSchema>;
export type ExportJob = z.infer<typeof ExportJobSchema>;
export type CreateExportJobInput = z.infer<typeof CreateExportJobInputSchema>;
export type UpdateExportJobInput = z.infer<typeof UpdateExportJobInputSchema>;
export type SavedViewListQuery = z.infer<typeof SavedViewListQuerySchema>;
export type CreateSavedViewInput = z.infer<typeof CreateSavedViewInputSchema>;
export type UpdateSavedViewInput = z.infer<typeof UpdateSavedViewInputSchema>;
export type ScheduledReportListQuery = z.infer<typeof ScheduledReportListQuerySchema>;
export type CreateScheduledReportInput = z.infer<typeof CreateScheduledReportInputSchema>;
export type UpdateScheduledReportInput = z.infer<typeof UpdateScheduledReportInputSchema>;
export type Alert = z.infer<typeof AlertSchema>;
export type PricingSource = z.infer<typeof PricingSourceSchema>;
export type ExportJobKind = z.infer<typeof ExportJobKindSchema>;
export type CommonReportTemplateId = z.infer<typeof CommonReportTemplateIdSchema>;
export type CommonReportTemplate = z.infer<typeof CommonReportTemplateSchema>;

export const CommonReportTemplates = [
  {
    id: "daily-burn-rate",
    name: "Daily Burn Rate",
    description: "Track daily spend, token volume, and run-rate changes by workspace, provider, and owner.",
    kind: "usage-ledger",
    cadence: "daily",
    format: "xlsx",
    focus: "burn-rate",
    filters: {},
  },
  {
    id: "weekly-chargeback",
    name: "Weekly Chargeback",
    description: "Freeze weekly usage-ledger slices for org, workspace, project, environment, key, and owner attribution.",
    kind: "usage-ledger",
    cadence: "weekly",
    format: "xlsx",
    focus: "chargeback",
    filters: {},
  },
  {
    id: "monthly-management-summary",
    name: "Monthly Management Summary",
    description: "Support leadership review with month-to-date spend, top movers, burn-rate posture, and model mix.",
    kind: "usage-ledger",
    cadence: "monthly",
    format: "xlsx",
    focus: "management-summary",
    filters: {},
  },
  {
    id: "provider-reconciliation",
    name: "Provider Reconciliation",
    description: "Compare provider-model usage, price snapshots, and realized cost for finance close or invoice review.",
    kind: "usage-ledger",
    cadence: "monthly",
    format: "csv",
    focus: "provider-reconciliation",
    filters: {},
  },
  {
    id: "forecast-watchlist",
    name: "Forecast Watchlist",
    description: "Prepare the daily aggregate layer needed for forecast, threshold ETA, and budget watchlist reviews.",
    kind: "usage-ledger",
    cadence: "daily",
    format: "xlsx",
    focus: "forecast",
    filters: {},
  },
  {
    id: "workspace-cost-breakdown",
    name: "Workspace Cost Breakdown",
    description: "Provide a stable workspace-level cost breakdown across project, env, provider, model, and owner.",
    kind: "usage-ledger",
    cadence: "adhoc",
    format: "csv",
    focus: "cost-breakdown",
    filters: {},
  },
] satisfies readonly CommonReportTemplate[];

export type ProviderSelectionCandidate = {
  connection: Pick<ProviderConnection, "id" | "label" | "provider" | "pricingConfig">;
  metadata: Record<string, string>;
};

export type ProviderSelectionMatchedBy =
  | "connection_id"
  | "provider_kind"
  | "model"
  | "model_default"
  | "only_candidate"
  | "protocol_default";

export type ProviderSelectionSuccess<T extends ProviderSelectionCandidate> = {
  ok: true;
  candidate: T;
  matchedBy: ProviderSelectionMatchedBy;
};

export type ProviderSelectionErrorCode =
  | "no_active_provider_for_protocol"
  | "requested_connection_unavailable"
  | "multiple_provider_kind_matches"
  | "requested_provider_kind_unavailable"
  | "multiple_model_matches"
  | "multiple_active_without_default";

export type ProviderSelectionError<T extends ProviderSelectionCandidate> = {
  ok: false;
  code: ProviderSelectionErrorCode;
  statusCode: 409 | 424;
  message: string;
  protocol: ProviderRoutingProtocol;
  connectionId?: string;
  provider?: ProviderConnection["provider"];
  requestedModel?: string;
  candidates?: Array<Pick<T["connection"], "id" | "label" | "provider">>;
};

export type ProviderSelectionResult<T extends ProviderSelectionCandidate> =
  | ProviderSelectionSuccess<T>
  | ProviderSelectionError<T>;

export type ProviderRoutingTargetSet = {
  exactModels: string[];
  modelPrefixes: string[];
};

export type ProviderRoutingConflictKind = "exact_model" | "exact_vs_prefix" | "prefix_overlap";

export type ProviderRoutingConflictResolution = "ambiguous" | "default_resolved";

export type ProviderRoutingConflict<T extends ProviderSelectionCandidate> = {
  protocol: ProviderRoutingProtocol;
  kind: ProviderRoutingConflictKind;
  token: string;
  sampleModel: string;
  candidates: Array<Pick<T["connection"], "id" | "label" | "provider">>;
  defaultCandidates: Array<Pick<T["connection"], "id" | "label" | "provider">>;
  matchingPrefixes: string[];
  resolution: ProviderRoutingConflictResolution;
};

export function providerConnectionSupportsProtocol(
  provider: ProviderConnection["provider"],
  protocol: ProviderRoutingProtocol,
) {
  if (protocol === "anthropic") {
    return provider === "anthropic";
  }

  return provider === "openai" || provider === "openai-compatible";
}

export function normalizeProviderKindHint(value?: string | null): ProviderConnection["provider"] | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (
    normalized === "anthropic" ||
    normalized === "openai" ||
    normalized === "openai-compatible" ||
    normalized === "bedrock" ||
    normalized === "vertex"
  ) {
    return normalized;
  }

  return null;
}

export function collectProviderMetadataTokens(...values: Array<string | undefined>) {
  return [...new Set(
    values
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .flatMap((value) => value.split(/[\n,]/))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
  )];
}

export function normalizeProviderModelId(value: string) {
  return value.trim().toLowerCase();
}

export function normalizeProviderModelConfig(input: ProviderModelConfig) {
  const deduped = new Map<string, z.infer<typeof ProviderModelConfigItemSchema>>();

  for (const item of input.items) {
    const normalizedId = normalizeProviderModelId(item.id);
    if (!normalizedId) {
      continue;
    }

    const label = item.label?.trim();
    deduped.set(normalizedId, {
      id: normalizedId,
      label: label ? label : null,
      source: item.source,
    });
  }

  return ProviderModelConfigSchema.parse({
    version: 1,
    items: [...deduped.values()],
  });
}

export function parseProviderModelConfig(value?: string | null) {
  if (!value?.trim()) {
    return null;
  }

  try {
    return normalizeProviderModelConfig(
      ProviderModelConfigSchema.parse(JSON.parse(value)),
    );
  } catch {
    return null;
  }
}

export function serializeProviderModelConfig(config: ProviderModelConfig) {
  return JSON.stringify(normalizeProviderModelConfig(config));
}

export function getProviderModelConfigFromMetadata(metadata: Record<string, string>) {
  return parseProviderModelConfig(metadata["ui.modelConfig"]);
}

export function getProviderModelIdsFromModelConfig(config: ProviderModelConfig | null | undefined) {
  if (!config) {
    return [];
  }

  return normalizeProviderModelConfig(config).items.map((item) => item.id);
}

function getManualPricingCanonicalModelIds(
  pricingConfig: ProviderPricingConfig | null | undefined,
) {
  if (!pricingConfig || pricingConfig.mode !== "manual") {
    return [];
  }

  return [...new Set(
    pricingConfig.rules
      .filter(
        (rule) => rule.matchType === "canonical" && typeof rule.model === "string" && rule.model.trim().length > 0,
      )
      .map((rule) => normalizeProviderModelId(rule.model ?? ""))
      .filter(Boolean),
  )];
}

export function getProviderConfiguredModelCatalogItems(
  metadata: Record<string, string>,
  pricingConfig?: ProviderPricingConfig | null,
) {
  const items = new Map<string, z.infer<typeof SelfServeModelCatalogItemSchema>>();
  const modelConfig = getProviderModelConfigFromMetadata(metadata);

  for (const item of modelConfig?.items ?? []) {
    const normalizedId = normalizeProviderModelId(item.id);
    if (!normalizedId) {
      continue;
    }

    const normalizedLabel = item.label?.trim();
    items.set(normalizedId, {
      id: normalizedId,
      label: normalizedLabel && normalizedLabel.length > 0 ? normalizedLabel : normalizedId,
      ownedBy: null,
    });
  }

  for (const modelId of collectProviderMetadataTokens(
    metadata.models,
    metadata.defaultModels,
    metadata["routing.models"],
  )) {
    if (items.has(modelId)) {
      continue;
    }

    items.set(modelId, {
      id: modelId,
      label: modelId,
      ownedBy: null,
    });
  }

  for (const modelId of getManualPricingCanonicalModelIds(pricingConfig)) {
    if (items.has(modelId)) {
      continue;
    }

    items.set(modelId, {
      id: modelId,
      label: modelId,
      ownedBy: null,
    });
  }

  return [...items.values()];
}

export function getProviderRoutingTargetSet(
  metadata: Record<string, string>,
  pricingConfig?: ProviderPricingConfig | null,
): ProviderRoutingTargetSet {
  const modelConfig = getProviderModelConfigFromMetadata(metadata);
  return {
    exactModels: collectProviderMetadataTokens(
      metadata.models,
      metadata.defaultModels,
      metadata["routing.models"],
      getProviderModelIdsFromModelConfig(modelConfig).join(", "),
      getManualPricingCanonicalModelIds(pricingConfig).join(", "),
    ),
    modelPrefixes: collectProviderMetadataTokens(
      metadata.modelPrefixes,
      metadata.defaultModelPrefixes,
      metadata["routing.modelPrefixes"],
    ),
  };
}

export function providerMetadataMarksDefault(
  metadata: Record<string, string>,
  protocol: ProviderRoutingProtocol,
) {
  const tokens = collectProviderMetadataTokens(
    metadata.defaultForProtocol,
    metadata.gatewayProtocol,
    metadata.protocol,
    metadata.protocols,
  );

  if (tokens.includes("all") || tokens.includes("default")) {
    return true;
  }

  if (protocol === "anthropic") {
    return tokens.includes("anthropic") || tokens.includes("messages");
  }

  return tokens.includes("openai") || tokens.includes("openai-compatible") || tokens.includes("chat-completions");
}

export function providerMetadataMatchesRequestedModel(
  metadata: Record<string, string>,
  requestedModel?: string | null,
  pricingConfig?: ProviderPricingConfig | null,
) {
  if (!requestedModel) {
    return false;
  }

  const normalizedModel = requestedModel.trim().toLowerCase();
  if (!normalizedModel) {
    return false;
  }

  const { exactModels, modelPrefixes } = getProviderRoutingTargetSet(metadata, pricingConfig);
  if (exactModels.includes(normalizedModel)) {
    return true;
  }

  return modelPrefixes.some((prefix) => normalizedModel.startsWith(prefix));
}

function pickProviderSelectionConnection<T extends ProviderSelectionCandidate>(provider: T) {
  return {
    id: provider.connection.id,
    label: provider.connection.label,
    provider: provider.connection.provider,
  };
}

function compareProviderSelectionConnection(
  left: Pick<ProviderSelectionCandidate["connection"], "id" | "label" | "provider">,
  right: Pick<ProviderSelectionCandidate["connection"], "id" | "label" | "provider">,
) {
  return left.label.localeCompare(right.label) || left.id.localeCompare(right.id);
}

function buildProviderRoutingSampleModel(prefix: string) {
  return `${prefix}sample`;
}

export function analyzeProviderRoutingConflicts<T extends ProviderSelectionCandidate>(args: {
  providers: T[];
  protocol: ProviderRoutingProtocol;
}): ProviderRoutingConflict<T>[] {
  const protocolCandidates = args.providers.filter((provider) =>
    providerConnectionSupportsProtocol(provider.connection.provider, args.protocol),
  );
  if (protocolCandidates.length <= 1) {
    return [];
  }

  const targetsByConnectionId = new Map(
    protocolCandidates.map((provider) => [provider.connection.id, getProviderRoutingTargetSet(provider.metadata)] as const),
  );
  const conflicts = new Map<string, ProviderRoutingConflict<T>>();

  const addConflict = (input: {
    kind: ProviderRoutingConflictKind;
    token: string;
    sampleModel: string;
    providers: T[];
    matchingPrefixes?: string[];
  }) => {
    const uniqueProviders = [...new Map(input.providers.map((provider) => [provider.connection.id, provider])).values()];
    if (uniqueProviders.length <= 1) {
      return;
    }

    const candidates = uniqueProviders.map(pickProviderSelectionConnection).sort(compareProviderSelectionConnection);
    const defaultCandidates = uniqueProviders
      .filter((provider) => providerMetadataMarksDefault(provider.metadata, args.protocol))
      .map(pickProviderSelectionConnection)
      .sort(compareProviderSelectionConnection);
    const key = `${input.kind}:${input.sampleModel}:${candidates.map((candidate) => candidate.id).join(",")}`;

    conflicts.set(key, {
      protocol: args.protocol,
      kind: input.kind,
      token: input.token,
      sampleModel: input.sampleModel,
      candidates,
      defaultCandidates,
      matchingPrefixes: [...new Set(input.matchingPrefixes ?? [])].sort(),
      resolution: defaultCandidates.length === 1 ? "default_resolved" : "ambiguous",
    });
  };

  const exactModelOwners = new Map<string, T[]>();
  const distinctPrefixes = new Set<string>();

  for (const provider of protocolCandidates) {
    const targets = targetsByConnectionId.get(provider.connection.id);
    if (!targets) {
      continue;
    }

    for (const exactModel of targets.exactModels) {
      const owners = exactModelOwners.get(exactModel) ?? [];
      owners.push(provider);
      exactModelOwners.set(exactModel, owners);
    }

    for (const prefix of targets.modelPrefixes) {
      distinctPrefixes.add(prefix);
    }
  }

  for (const [exactModel, owners] of exactModelOwners.entries()) {
    if (owners.length > 1) {
      addConflict({
        kind: "exact_model",
        token: exactModel,
        sampleModel: exactModel,
        providers: owners,
      });
    }

    const prefixMatchedProviders = protocolCandidates.filter((provider) => {
      if (owners.some((owner) => owner.connection.id === provider.connection.id)) {
        return false;
      }

      const targets = targetsByConnectionId.get(provider.connection.id);
      return targets?.modelPrefixes.some((prefix) => exactModel.startsWith(prefix)) ?? false;
    });

    if (prefixMatchedProviders.length > 0) {
      addConflict({
        kind: "exact_vs_prefix",
        token: exactModel,
        sampleModel: exactModel,
        providers: [...owners, ...prefixMatchedProviders],
        matchingPrefixes: prefixMatchedProviders.flatMap(
          (provider) =>
            targetsByConnectionId
              .get(provider.connection.id)
              ?.modelPrefixes.filter((prefix) => exactModel.startsWith(prefix)) ?? [],
        ),
      });
    }
  }

  for (const token of distinctPrefixes) {
    const duplicateOwners = protocolCandidates.filter((provider) =>
      targetsByConnectionId.get(provider.connection.id)?.modelPrefixes.includes(token) ?? false,
    );
    const hasBroaderPrefix = protocolCandidates.some((provider) =>
      targetsByConnectionId
        .get(provider.connection.id)
        ?.modelPrefixes.some((prefix) => prefix !== token && token.startsWith(prefix)) ?? false,
    );

    if (duplicateOwners.length <= 1 && !hasBroaderPrefix) {
      continue;
    }

    const overlappingProviders = protocolCandidates.filter((provider) => {
      const targets = targetsByConnectionId.get(provider.connection.id);
      return targets?.modelPrefixes.some((prefix) => token.startsWith(prefix) || prefix.startsWith(token)) ?? false;
    });

    addConflict({
      kind: "prefix_overlap",
      token,
      sampleModel: buildProviderRoutingSampleModel(token),
      providers: overlappingProviders,
      matchingPrefixes: overlappingProviders.flatMap(
        (provider) =>
          targetsByConnectionId
            .get(provider.connection.id)
            ?.modelPrefixes.filter((prefix) => token.startsWith(prefix) || prefix.startsWith(token)) ?? [],
      ),
    });
  }

  return [...conflicts.values()].sort((left, right) => {
    const resolutionOrder = {
      ambiguous: 0,
      default_resolved: 1,
    } satisfies Record<ProviderRoutingConflictResolution, number>;
    const kindOrder = {
      exact_model: 0,
      exact_vs_prefix: 1,
      prefix_overlap: 2,
    } satisfies Record<ProviderRoutingConflictKind, number>;

    return (
      resolutionOrder[left.resolution] - resolutionOrder[right.resolution] ||
      kindOrder[left.kind] - kindOrder[right.kind] ||
      left.sampleModel.localeCompare(right.sampleModel)
    );
  });
}

export function analyzeProviderSelection<T extends ProviderSelectionCandidate>(args: {
  providers: T[];
  protocol: ProviderRoutingProtocol;
  headers?: Record<string, string>;
  requestedModel?: string;
}): ProviderSelectionResult<T> {
  const protocolCandidates = args.providers.filter((provider) =>
    providerConnectionSupportsProtocol(provider.connection.provider, args.protocol),
  );

  if (protocolCandidates.length === 0) {
    return {
      ok: false,
      code: "no_active_provider_for_protocol",
      statusCode: 424,
      message: `No active ${args.protocol} provider connection found for this workspace`,
      protocol: args.protocol,
    };
  }

  const connectionIdHint = args.headers?.["x-provider-connection-id"]?.trim();
  if (connectionIdHint) {
    const matched = protocolCandidates.find((provider) => provider.connection.id === connectionIdHint);
    if (!matched) {
      return {
        ok: false,
        code: "requested_connection_unavailable",
        statusCode: 409,
        message: "Requested provider connection is not available for this protocol",
        protocol: args.protocol,
        connectionId: connectionIdHint,
      };
    }

    return {
      ok: true,
      candidate: matched,
      matchedBy: "connection_id",
    };
  }

  const providerHint = normalizeProviderKindHint(
    args.headers?.["x-provider-kind"] ??
      args.headers?.["x-teamops-provider"] ??
      args.headers?.["x-provider"],
  );
  if (providerHint) {
    const hinted = protocolCandidates.filter((provider) => provider.connection.provider === providerHint);
    if (hinted.length === 1) {
      return {
        ok: true,
        candidate: hinted[0],
        matchedBy: "provider_kind",
      };
    }

    if (hinted.length > 1) {
      return {
        ok: false,
        code: "multiple_provider_kind_matches",
        statusCode: 409,
        message: "Multiple provider connections match the requested provider kind",
        protocol: args.protocol,
        provider: providerHint,
      };
    }

    return {
      ok: false,
      code: "requested_provider_kind_unavailable",
      statusCode: 409,
      message: "Requested provider kind is not available for this protocol",
      protocol: args.protocol,
      provider: providerHint,
    };
  }

  const modelMatchedCandidates = protocolCandidates.filter((provider) =>
    providerMetadataMatchesRequestedModel(
      provider.metadata,
      args.requestedModel,
      provider.connection.pricingConfig,
    ),
  );
  if (modelMatchedCandidates.length === 1) {
    return {
      ok: true,
      candidate: modelMatchedCandidates[0],
      matchedBy: "model",
    };
  }

  if (modelMatchedCandidates.length > 1) {
    const defaultModelMatchedCandidates = modelMatchedCandidates.filter((provider) =>
      providerMetadataMarksDefault(provider.metadata, args.protocol),
    );
    if (defaultModelMatchedCandidates.length === 1) {
      return {
        ok: true,
        candidate: defaultModelMatchedCandidates[0],
        matchedBy: "model_default",
      };
    }

    return {
      ok: false,
      code: "multiple_model_matches",
      statusCode: 409,
      message: "Multiple provider connections match the requested model",
      protocol: args.protocol,
      requestedModel: args.requestedModel,
      candidates: modelMatchedCandidates.map((provider) => ({
        id: provider.connection.id,
        label: provider.connection.label,
        provider: provider.connection.provider,
      })),
    };
  }

  if (protocolCandidates.length === 1) {
    return {
      ok: true,
      candidate: protocolCandidates[0],
      matchedBy: "only_candidate",
    };
  }

  const defaultCandidates = protocolCandidates.filter((provider) =>
    providerMetadataMarksDefault(provider.metadata, args.protocol),
  );
  if (defaultCandidates.length === 1) {
    return {
      ok: true,
      candidate: defaultCandidates[0],
      matchedBy: "protocol_default",
    };
  }

  return {
    ok: false,
    code: "multiple_active_without_default",
    statusCode: 409,
    message: "Multiple provider connections are available for this protocol; specify x-provider-connection-id or x-provider-kind",
    protocol: args.protocol,
    candidates: protocolCandidates.map((provider) => ({
      id: provider.connection.id,
      label: provider.connection.label,
      provider: provider.connection.provider,
      })),
  };
}

export type FingerprintArtifact = z.infer<typeof FingerprintArtifactSchema>;
export type ArtifactAttestation = z.infer<typeof ArtifactAttestationSchema>;
export type WatermarkFamilySummary = z.infer<typeof WatermarkFamilySummarySchema>;
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;
export type ApiError = z.infer<typeof ApiErrorSchema>;
export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;
export type BuildDescriptorArtifact = z.infer<typeof BuildDescriptorArtifactSchema>;
export type LineageBuildDescriptor = z.infer<typeof LineageBuildDescriptorSchema>;
export type FingerprintDeploymentMode = z.infer<typeof FingerprintDeploymentModeSchema>;
export type FingerprintKeyPurpose = z.infer<typeof FingerprintKeyPurposeSchema>;
export type FingerprintKeyAlgorithm = z.infer<typeof FingerprintKeyAlgorithmSchema>;
export type FingerprintKeyStatus = z.infer<typeof FingerprintKeyStatusSchema>;
export type FingerprintIssuanceStatus = z.infer<typeof FingerprintIssuanceStatusSchema>;
export type EvidenceBundleKind = z.infer<typeof EvidenceBundleKindSchema>;
export type FingerprintArtifactVerificationStatus = z.infer<typeof FingerprintArtifactVerificationStatusSchema>;
export type FingerprintArtifactVerificationSource = z.infer<typeof FingerprintArtifactVerificationSourceSchema>;
export type ArtifactVerificationRecord = z.infer<typeof ArtifactVerificationRecordSchema>;
export type ArtifactExtractorObservedArtifact = z.infer<typeof ArtifactExtractorObservedArtifactSchema>;
export type ArtifactExtractorSummary = z.infer<typeof ArtifactExtractorSummarySchema>;
export type VerifyLineageArtifactsInput = z.infer<typeof VerifyLineageArtifactsInputSchema>;
export type VerifiedLineageArtifact = z.infer<typeof VerifiedLineageArtifactSchema>;
export type VerifyLineageArtifactsResponse = z.infer<typeof VerifyLineageArtifactsResponseSchema>;
export type CustomerDeployment = z.infer<typeof CustomerDeploymentSchema>;
export type ReleaseCatalogEntry = z.infer<typeof ReleaseCatalogEntrySchema>;
export type FingerprintKeyVersion = z.infer<typeof FingerprintKeyVersionSchema>;
export type EvidenceBundle = z.infer<typeof EvidenceBundleSchema>;
export type AttestationBundle = z.infer<typeof AttestationBundleSchema>;
export type FingerprintIssuance = z.infer<typeof FingerprintIssuanceSchema>;
export type LineageIssuance = z.infer<typeof LineageIssuanceSchema>;
export type LineageKeyVersion = z.infer<typeof LineageKeyVersionSchema>;
export type FingerprintKeyVersionListQuery = z.infer<typeof FingerprintKeyVersionListQuerySchema>;
export type LineageKeyVersionListQuery = z.infer<typeof LineageKeyVersionListQuerySchema>;
export type RotateFingerprintKeyVersionInput = z.infer<typeof RotateFingerprintKeyVersionInputSchema>;
export type RotateLineageKeyVersionInput = z.infer<typeof RotateLineageKeyVersionInputSchema>;
export type IssueFingerprintInput = z.infer<typeof IssueFingerprintInputSchema>;
export type IssueLineageInput = z.infer<typeof IssueLineageInputSchema>;
export type BuildDescriptorResponse = z.infer<typeof BuildDescriptorResponseSchema>;
export type RevokeFingerprintInput = z.infer<typeof RevokeFingerprintInputSchema>;
export type RevokeLineageInput = z.infer<typeof RevokeLineageInputSchema>;
export type FingerprintLookupQuery = z.infer<typeof FingerprintLookupQuerySchema>;
export type LineageLookupQuery = z.infer<typeof LineageLookupQuerySchema>;
export type FingerprintListResponse = z.infer<typeof FingerprintListResponseSchema>;
export type LineageListResponse = z.infer<typeof LineageListResponseSchema>;
export type SelfServeProviderConnectionSummary = z.infer<typeof SelfServeProviderConnectionSummarySchema>;
export type SelfServeAvailableTarget = z.infer<typeof SelfServeAvailableTargetSchema>;
export type SelfServeModelCatalogItem = z.infer<typeof SelfServeModelCatalogItemSchema>;
export type SelfServeModelCatalog = z.infer<typeof SelfServeModelCatalogSchema>;
export type CatalogModelStatus = z.infer<typeof CatalogModelStatusSchema>;
export type CatalogModel = z.infer<typeof CatalogModelSchema>;
export type UpsertCatalogModelInput = z.infer<typeof UpsertCatalogModelInputSchema>;
export type SyncWorkspaceModelAssignmentsInput = z.infer<typeof SyncWorkspaceModelAssignmentsInputSchema>;
export type WorkspaceModelAvailabilityStatus = z.infer<typeof WorkspaceModelAvailabilityStatusSchema>;
export type WorkspaceModelAvailability = z.infer<typeof WorkspaceModelAvailabilitySchema>;
export type WorkspaceModelCatalogResponse = z.infer<typeof WorkspaceModelCatalogResponseSchema>;
export type ProviderModelSource = z.infer<typeof ProviderModelSourceSchema>;
export type ProviderModelConfigItem = z.infer<typeof ProviderModelConfigItemSchema>;
export type ProviderModelConfig = z.infer<typeof ProviderModelConfigSchema>;
export type ProviderConnectionModelCatalogStatus = z.infer<typeof ProviderConnectionModelCatalogStatusSchema>;
export type ProviderConnectionModelCatalogErrorCode = z.infer<typeof ProviderConnectionModelCatalogErrorCodeSchema>;
export type ProviderConnectionModelCatalog = z.infer<typeof ProviderConnectionModelCatalogSchema>;
export type IssueSelfServeVirtualKeyInput = z.infer<typeof IssueSelfServeVirtualKeyInputSchema>;
export type SelfServeVirtualKeyBootstrap = z.infer<typeof SelfServeVirtualKeyBootstrapSchema>;
