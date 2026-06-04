"use server";

import { redirect } from "next/navigation";

import { batchReviewPromptInspections, reviewPromptInspection, updatePromptPolicy } from "../lib/control-api";
import { buildActionRedirectPath } from "../lib/action-redirect";
import { getUserErrorMessage } from "../lib/user-facing-error";

function getOptionalString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getOptionalInteger(formData: FormData, key: string) {
  const value = getOptionalString(formData, key);
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function getNoticePath(
  redirectTo: string | null,
  workspaceId: string | null,
  params: Record<string, string | undefined>,
  fallbackPath = "/prompt-inspections",
) {
  return buildActionRedirectPath(
    fallbackPath,
    redirectTo ?? undefined,
    {
      ...(workspaceId ? { workspaceId } : {}),
      ...params,
    },
  );
}

export async function reviewPromptInspectionAction(formData: FormData) {
  const promptInspectionId = getOptionalString(formData, "promptInspectionId");
  const reviewStatus = getOptionalString(formData, "reviewStatus");
  const reviewNote = getOptionalString(formData, "reviewNote");
  const redirectTo = getOptionalString(formData, "redirectTo");
  const workspaceId = getOptionalString(formData, "workspaceId");

  if (!promptInspectionId || !reviewStatus) {
    redirect(
      getNoticePath(redirectTo, workspaceId, {
        notice: "error",
        message: "Please choose a review result.",
      }),
    );
  }

  try {
    await reviewPromptInspection(promptInspectionId, {
      reviewStatus: reviewStatus as "confirmed_violation" | "confirmed_benign" | "needs_followup",
      reviewNote,
    });
  } catch (error) {
    redirect(
      getNoticePath(redirectTo, workspaceId, {
        notice: "error",
        message: getUserErrorMessage(error, "Unable to save the review right now."),
        inspectionId: promptInspectionId,
      }),
    );
  }

  redirect(
    getNoticePath(redirectTo, workspaceId, {
      inspectionId: promptInspectionId,
      notice: "success",
      message: "Review saved.",
    }),
  );
}

export async function batchReviewPromptInspectionsAction(formData: FormData) {
  const promptInspectionIds = [...new Set(
    formData
      .getAll("promptInspectionIds")
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0),
  )];
  const reviewStatus = getOptionalString(formData, "reviewStatus");
  const reviewNote = getOptionalString(formData, "reviewNote");
  const redirectTo = getOptionalString(formData, "redirectTo");
  const workspaceId = getOptionalString(formData, "workspaceId");

  if (!promptInspectionIds.length || !reviewStatus) {
    redirect(
      getNoticePath(redirectTo, workspaceId, {
        notice: "error",
        message: "Please select at least one inspection and a review result.",
      }),
    );
  }

  try {
    const result = await batchReviewPromptInspections({
      workspaceId: workspaceId ?? "",
      inspectionIds: promptInspectionIds,
      reviewStatus: reviewStatus as "confirmed_violation" | "confirmed_benign" | "needs_followup",
      reviewNote,
    });
    redirect(
      getNoticePath(redirectTo, workspaceId, {
        notice: "success",
        message: `${result.reviewedCount} reviews saved.`,
      }),
    );
  } catch (error) {
    redirect(
      getNoticePath(redirectTo, workspaceId, {
        notice: "error",
        message: getUserErrorMessage(error, "Unable to save the batch review right now."),
      }),
    );
  }
}

export async function updatePromptPolicyAction(formData: FormData) {
  const workspaceId = getOptionalString(formData, "workspaceId");
  const redirectTo = getOptionalString(formData, "redirectTo");
  const fallbackPath = getOptionalString(formData, "fallbackPath") ?? "/prompt-inspections/policy";

  if (!workspaceId) {
    redirect(buildActionRedirectPath(fallbackPath, redirectTo ?? undefined));
  }

  const enabled = formData.get("enabled") === "on";
  const enforcementMode = getOptionalString(formData, "enforcementMode");
  const evidenceMode = getOptionalString(formData, "evidenceMode");
  const reviewThreshold = getOptionalInteger(formData, "reviewThreshold");
  const blockThreshold = getOptionalInteger(formData, "blockThreshold");
  const allowedExternalDomains = getOptionalString(formData, "allowedExternalDomains");
  const allowedKeywordOverrides = getOptionalString(formData, "allowedKeywordOverrides");
  const disabledRuleIds = getOptionalString(formData, "disabledRuleIds");

  await updatePromptPolicy(workspaceId, {
    enabled,
    ...(enforcementMode ? { enforcementMode: enforcementMode as "graded" | "alert_only" | "strict" } : {}),
    ...(evidenceMode ? { evidenceMode: evidenceMode as "redacted_snippet" | "fingerprint_only" | "disabled" } : {}),
    ...(reviewThreshold !== null ? { reviewThreshold } : {}),
    ...(blockThreshold !== null ? { blockThreshold } : {}),
    allowedExternalDomains: allowedExternalDomains
      ? allowedExternalDomains.split(/[\n,]/).map((item) => item.trim()).filter(Boolean)
      : [],
    allowedKeywordOverrides: allowedKeywordOverrides
      ? allowedKeywordOverrides.split(/[\n,]/).map((item) => item.trim()).filter(Boolean)
      : [],
    disabledRuleIds: disabledRuleIds
      ? disabledRuleIds.split(/[\n,]/).map((item) => item.trim()).filter(Boolean)
      : [],
  }).catch((error) => {
    redirect(
      getNoticePath(redirectTo, workspaceId, {
        notice: "error",
        message: getUserErrorMessage(error, "Unable to save the policy right now."),
      }, fallbackPath),
    );
  });

  redirect(
    getNoticePath(redirectTo, workspaceId, {
      notice: "success",
      message: "Policy saved.",
    }, fallbackPath),
  );
}
