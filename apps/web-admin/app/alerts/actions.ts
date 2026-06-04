"use server";

import { redirect } from "next/navigation";

import { buildActionRedirectPath } from "../lib/action-redirect";
import { updateAlert } from "../lib/control-api";
import { getUserErrorMessage } from "../lib/user-facing-error";

function getErrorMessage(error: unknown) {
  return getUserErrorMessage(error, "alerts.action.error");
}

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
  return value.length ? value : null;
}

function getRedirectPath(formData: FormData) {
  return buildActionRedirectPath("/alerts", getOptionalString(formData, "redirectPath") ?? undefined);
}

function buildAlertCollaborationMetadataPatch(args: {
  ackState?: string | null;
  ownerLabel?: string | null;
  note?: string | null;
  slaDueAt?: string | null;
  runbookHref?: string | null;
  runbookLabel?: string | null;
  ticketHref?: string | null;
  ticketLabel?: string | null;
}) {
  const patch: Record<string, unknown> = {
    collaborationUpdatedAt: new Date().toISOString(),
  };

  if (args.ackState !== undefined) {
    patch.collaborationAckState = args.ackState;
  }
  if (args.ownerLabel !== undefined) {
    patch.collaborationOwnerLabel = args.ownerLabel;
  }
  if (args.note !== undefined) {
    patch.collaborationNote = args.note;
    patch.collaborationNoteCount = args.note ? 1 : 0;
  }
  if (args.slaDueAt !== undefined) {
    patch.collaborationSlaDueAt = args.slaDueAt;
  }
  if (args.runbookHref !== undefined) {
    patch.collaborationRunbookHref = args.runbookHref;
  }
  if (args.runbookLabel !== undefined) {
    patch.collaborationRunbookLabel = args.runbookLabel;
  }
  if (args.ticketHref !== undefined) {
    patch.collaborationTicketHref = args.ticketHref;
  }
  if (args.ticketLabel !== undefined) {
    patch.collaborationTicketLabel = args.ticketLabel;
  }

  return patch;
}

function buildFormAlertCollaborationMetadataPatch(formData: FormData) {
  return buildAlertCollaborationMetadataPatch({
    ackState: getOptionalString(formData, "ackState"),
    ownerLabel: getOptionalString(formData, "ownerLabel"),
    note: getOptionalString(formData, "note"),
    slaDueAt: getOptionalString(formData, "slaDueAt"),
    runbookHref: getOptionalString(formData, "runbookHref"),
    runbookLabel: getOptionalString(formData, "runbookLabel"),
    ticketHref: getOptionalString(formData, "ticketHref"),
    ticketLabel: getOptionalString(formData, "ticketLabel"),
  });
}

function getAlertIds(formData: FormData) {
  return [...new Set(formData.getAll("alertIds").filter((value): value is string => typeof value === "string"))]
    .map((value) => value.trim())
    .filter(Boolean);
}

function getBatchIntent(formData: FormData) {
  const intent = getOptionalString(formData, "batchIntent");

  if (intent === "assign" || intent === "ack" || intent === "resolve") {
    return intent;
  }

  return "ack";
}

function getBatchRedirectPath(
  formData: FormData,
  params?: Record<string, string | undefined>,
) {
  return buildActionRedirectPath("/alerts", getOptionalString(formData, "redirectPath") ?? undefined, params);
}

type BatchQueueAction = "assigned" | "acknowledged" | "resolved";

type BatchAlertUpdateResult = {
  successCount: number;
  failureCount: number;
  firstFailureMessage: string | null;
};

async function runBatchAlertUpdate(
  alertIds: string[],
  updateAlertRecord: (alertId: string) => Promise<unknown>,
): Promise<BatchAlertUpdateResult> {
  const results = await Promise.allSettled(alertIds.map((alertId) => updateAlertRecord(alertId)));
  const successCount = results.filter((result) => result.status === "fulfilled").length;
  const failureCount = results.length - successCount;
  const firstFailure = results.find((result) => result.status === "rejected");

  return {
    successCount,
    failureCount,
    firstFailureMessage:
      firstFailure?.status === "rejected"
        ? getErrorMessage(firstFailure.reason)
        : null,
  };
}

function redirectWithBatchQueueResult(
  formData: FormData,
  action: BatchQueueAction,
  result: BatchAlertUpdateResult,
) {
  if (!result.successCount) {
    redirect(
      getBatchRedirectPath(formData, {
        queueAction: "batch-error",
        queueMessage: result.firstFailureMessage ?? "None of the selected alerts could be updated.",
      }),
    );
  }

  if (result.failureCount > 0) {
    redirect(
      getBatchRedirectPath(formData, {
        queueAction: `${action}-partial`,
        queueCount: String(result.successCount),
        queueFailed: String(result.failureCount),
        queueMessage: result.firstFailureMessage ?? undefined,
      }),
    );
  }

  redirect(
    getBatchRedirectPath(formData, {
      queueAction: action,
      queueCount: String(result.successCount),
    }),
  );
}

export async function resolveAlertAction(formData: FormData) {
  const alertId = getRequiredString(formData, "alertId");
  await updateAlert(alertId, {
    status: "resolved",
  });
  redirect(getRedirectPath(formData));
}

export async function reopenAlertAction(formData: FormData) {
  const alertId = getRequiredString(formData, "alertId");
  await updateAlert(alertId, {
    status: "open",
  });
  redirect(getRedirectPath(formData));
}

export async function updateAlertCollaborationAction(formData: FormData) {
  const alertId = getRequiredString(formData, "alertId");
  await updateAlert(alertId, {
    metadataPatch: buildFormAlertCollaborationMetadataPatch(formData),
  });
  redirect(getRedirectPath(formData));
}

export async function batchUpdateAlertsAction(formData: FormData) {
  const alertIds = getAlertIds(formData);
  const batchIntent = getBatchIntent(formData);

  if (!alertIds.length) {
    redirect(
      getBatchRedirectPath(formData, {
        queueAction: "selection-required",
      }),
    );
  }

  if (batchIntent === "assign") {
    const ownerLabel = getOptionalString(formData, "ownerLabel");

    if (!ownerLabel) {
      redirect(
        getBatchRedirectPath(formData, {
          queueAction: "owner-required",
        }),
      );
    }

    const result = await runBatchAlertUpdate(
      alertIds,
      (alertId) =>
        updateAlert(alertId, {
          metadataPatch: buildAlertCollaborationMetadataPatch({
            ownerLabel,
          }),
        }),
    );

    redirectWithBatchQueueResult(formData, "assigned", result);
  }

  if (batchIntent === "resolve") {
    const result = await runBatchAlertUpdate(
      alertIds,
      (alertId) =>
        updateAlert(alertId, {
          status: "resolved",
          metadataPatch: buildAlertCollaborationMetadataPatch({
            ackState: "resolved",
          }),
        }),
    );

    redirectWithBatchQueueResult(formData, "resolved", result);
  }

  const result = await runBatchAlertUpdate(
    alertIds,
    (alertId) =>
      updateAlert(alertId, {
        metadataPatch: buildAlertCollaborationMetadataPatch({
          ackState: "acknowledged",
        }),
      }),
  );

  redirectWithBatchQueueResult(formData, "acknowledged", result);
}
