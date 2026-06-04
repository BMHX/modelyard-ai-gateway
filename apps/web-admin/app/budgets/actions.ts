"use server";

import { redirect } from "next/navigation";

import { buildActionRedirectPath } from "../lib/action-redirect";
import {
  createBudgetPolicy,
  deleteBudgetPolicy,
  listWorkspaceEnvironments,
  updateBudgetPolicy,
} from "../lib/control-api";

function getRequiredString(formData: FormData, key: string) {
  const rawValue = formData.get(key);
  const value = typeof rawValue === "string" ? rawValue.trim() : "";

  if (!value) {
    throw new Error(`${key} is required`);
  }

  return value;
}

function getOptionalString(formData: FormData, key: string) {
  const rawValue = formData.get(key);
  if (typeof rawValue !== "string") {
    return null;
  }

  const value = rawValue.trim();
  return value ? value : null;
}

function getRequiredNumber(formData: FormData, key: string) {
  const value = Number(getRequiredString(formData, key));
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${key} must be a positive number`);
  }
  return value;
}

function getRequiredPercent(formData: FormData, key: string) {
  const value = Number(getRequiredString(formData, key));
  if (!Number.isFinite(value) || value < 1 || value > 100) {
    throw new Error(`${key} must be between 1 and 100`);
  }
  return value;
}

function withHash(path: string | undefined | null, hash: string | null) {
  if (!path || !hash) {
    return path ?? undefined;
  }

  const url = new URL(path, "http://localhost");
  url.hash = hash.startsWith("#") ? hash : `#${hash}`;
  return `${url.pathname}${url.search}${url.hash}`;
}

function buildBudgetsRedirect(
  workspaceId: string,
  requestedPath?: string | null,
  options?: {
    notice?: "created" | "updated" | "deleted" | "error";
    message?: string;
    budgetPolicyId?: string;
    anchor?: string;
  },
) {
  const hash =
    options?.budgetPolicyId ? `budget-${options.budgetPolicyId}`
    : options?.anchor ?? null;

  return buildActionRedirectPath(
    `/budgets?workspaceId=${encodeURIComponent(workspaceId)}${hash ? `#${hash}` : ""}`,
    withHash(requestedPath, hash),
    {
      notice: options?.notice,
      message: options?.message,
      budgetPolicyId: options?.budgetPolicyId,
    },
  );
}

function getOptionalDateTimeIso(formData: FormData, key: string) {
  const value = getOptionalString(formData, key);
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function getBudgetActionErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "";

  if (/An active budget policy already exists for this exact scope/i.test(message)) {
    return "notice.message.scopeConflict";
  }

  if (/Selected environment was not found/i.test(message)) {
    return "notice.message.environmentMissing";
  }

  if (
    /Assignment-scoped members can only create project-scoped budgets/i.test(message) ||
    /outside the current assigned project scope/i.test(message)
  ) {
    return "notice.message.scopeForbidden";
  }

  return "notice.message.saveFailedPolicy";
}

export async function createBudgetPolicyAction(formData: FormData) {
  const workspaceId = getRequiredString(formData, "workspaceId");
  const redirectPath = getOptionalString(formData, "redirectPath");
  const requestedProjectId = getOptionalString(formData, "projectId");
  const requestedEnvironmentId = getOptionalString(formData, "environmentId");
  let destination = buildBudgetsRedirect(workspaceId, redirectPath);

  try {
    let projectId = requestedProjectId;
    let environmentId = requestedEnvironmentId;
    let environment: "development" | "staging" | "production" | null = null;

    if (environmentId) {
      const environments = await listWorkspaceEnvironments(workspaceId);
      const selectedEnvironment = environments.find((item) => item.id === environmentId);

      if (!selectedEnvironment) {
        throw new Error("Selected environment was not found");
      }

      projectId = selectedEnvironment.projectId;
      environment = selectedEnvironment.runtime;
    }

    const budgetPolicy = await createBudgetPolicy({
      workspaceId,
      projectId,
      environmentId,
      environment,
      monthlyUsdLimit: getRequiredNumber(formData, "monthlyUsdLimit"),
      softLimitPercent: getRequiredPercent(formData, "softLimitPercent"),
    });

    destination = buildBudgetsRedirect(workspaceId, redirectPath, {
      notice: "created",
      message: "notice.message.createdPolicy",
      budgetPolicyId: budgetPolicy.id,
    });
  } catch (error) {
    destination = buildBudgetsRedirect(workspaceId, redirectPath, {
      notice: "error",
      message: getBudgetActionErrorMessage(error),
      anchor: "budget-policy-list",
    });
  }

  redirect(destination);
}

export async function updateBudgetPolicyAction(formData: FormData) {
  const workspaceId = getRequiredString(formData, "workspaceId");
  const budgetPolicyId = getRequiredString(formData, "budgetPolicyId");
  const redirectPath = getOptionalString(formData, "redirectPath");
  let destination = buildBudgetsRedirect(workspaceId, redirectPath, {
    budgetPolicyId,
  });

  try {
    await updateBudgetPolicy(budgetPolicyId, {
      monthlyUsdLimit: getRequiredNumber(formData, "monthlyUsdLimit"),
      softLimitPercent: getRequiredPercent(formData, "softLimitPercent"),
      status: getRequiredString(formData, "status") === "paused" ? "paused" : "active",
    });

    destination = buildBudgetsRedirect(workspaceId, redirectPath, {
      notice: "updated",
      message: "notice.message.updatedPolicy",
      budgetPolicyId,
    });
  } catch (error) {
    destination = buildBudgetsRedirect(workspaceId, redirectPath, {
      notice: "error",
      message: getBudgetActionErrorMessage(error),
      budgetPolicyId,
    });
  }

  redirect(destination);
}

export async function deleteBudgetPolicyAction(formData: FormData) {
  const workspaceId = getRequiredString(formData, "workspaceId");
  const budgetPolicyId = getRequiredString(formData, "budgetPolicyId");
  const redirectPath = getOptionalString(formData, "deleteRedirectPath") ?? getOptionalString(formData, "redirectPath");
  let destination = buildBudgetsRedirect(workspaceId, redirectPath, {
    budgetPolicyId,
  });

  try {
    await deleteBudgetPolicy(budgetPolicyId);
    destination = buildBudgetsRedirect(workspaceId, redirectPath, {
      notice: "deleted",
      message: "notice.message.deletedPolicy",
      anchor: "budget-policy-list",
    });
  } catch (error) {
    destination = buildBudgetsRedirect(workspaceId, redirectPath, {
      notice: "error",
      message: getBudgetActionErrorMessage(error),
      budgetPolicyId,
    });
  }

  redirect(destination);
}

export async function updateBudgetExceptionAction(
  nextExceptionStatus: "requested" | "approved" | "rejected" | "none" | FormData,
  maybeFormData?: FormData,
) {
  const formData = nextExceptionStatus instanceof FormData ? nextExceptionStatus : maybeFormData;

  if (!formData) {
    throw new Error("formData is required");
  }

  const workspaceId = getRequiredString(formData, "workspaceId");
  const budgetPolicyId = getRequiredString(formData, "budgetPolicyId");
  const redirectPath = getOptionalString(formData, "redirectPath");
  const exceptionStatus =
    nextExceptionStatus instanceof FormData ? getRequiredString(formData, "exceptionStatus") : nextExceptionStatus;

  await updateBudgetPolicy(budgetPolicyId, {
    exceptionStatus:
      exceptionStatus === "requested" || exceptionStatus === "approved" || exceptionStatus === "rejected"
        ? exceptionStatus
        : "none",
    exceptionReason: getOptionalString(formData, "exceptionReason"),
    exceptionRequestedBy: getOptionalString(formData, "exceptionRequestedBy"),
    exceptionRequestedAt:
      exceptionStatus === "requested" ? new Date().toISOString()
      : exceptionStatus === "none" ? null
      : undefined,
    exceptionReviewedBy:
      exceptionStatus === "approved" || exceptionStatus === "rejected"
        ? getOptionalString(formData, "exceptionReviewedBy")
        : exceptionStatus === "none" ? null
        : undefined,
    exceptionReviewedAt:
      exceptionStatus === "approved" || exceptionStatus === "rejected"
        ? new Date().toISOString()
        : exceptionStatus === "none" ? null
        : undefined,
    exceptionReviewNote:
      exceptionStatus === "approved" || exceptionStatus === "rejected" || exceptionStatus === "none"
        ? getOptionalString(formData, "exceptionReviewNote")
        : undefined,
    exceptionExpiresAt:
      exceptionStatus === "approved"
        ? getOptionalDateTimeIso(formData, "exceptionExpiresAt")
        : exceptionStatus === "none" || exceptionStatus === "rejected"
          ? null
          : undefined,
  });

  redirect(buildBudgetsRedirect(workspaceId, redirectPath, {
    notice: "updated",
    message: "notice.message.exceptionUpdated",
    budgetPolicyId,
  }));
}
