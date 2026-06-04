"use server";

import {
  normalizeVirtualKeyScopes,
  type CreatedVirtualKeyResponse,
  type VirtualKey,
} from "@teamops/contracts";

import { createVirtualKey, revokeVirtualKey, rotateVirtualKey } from "../lib/control-api";
import { getUserErrorMessage, toFriendlyRequiredMessage } from "../lib/user-facing-error";

function getErrorMessage(error: unknown) {
  return getUserErrorMessage(error, "Can't update this key right now.");
}

const virtualKeyActionMessageKeys = {
  createSuccess: "actions.create.success",
  revokeSuccess: "actions.revoke.success",
  rotateSuccess: "actions.rotate.success",
  bulkRevokeNoneSelected: "actions.bulkRevoke.noneSelected",
  bulkRevokeNoneSucceeded: "actions.bulkRevoke.noneSucceeded",
  bulkRevokeSuccess: "actions.bulkRevoke.success",
  bulkRevokePartial: "actions.bulkRevoke.partial",
  bulkRotateNoneSelected: "actions.bulkRotate.noneSelected",
  bulkRotateNoneSucceeded: "actions.bulkRotate.noneSucceeded",
  bulkRotateSuccess: "actions.bulkRotate.success",
  bulkRotatePartial: "actions.bulkRotate.partial",
} as const;

function normalizeOptionalLabel(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed || null;
}

export type CreateVirtualKeyActionInput = {
  workspaceId: string;
  providerConnectionId: string | null;
  label: string;
  owner: string | null;
  team: string | null;
  service: string | null;
  projectId: string | null;
  environmentId: string | null;
  environment: "development" | "staging" | "production";
  scopes: string[];
  expiresAt?: string | null;
};

export type CreateVirtualKeyActionResult =
  | {
      status: "idle";
      message: null;
      created: null;
    }
  | {
      status: "error";
      message: string;
      created: null;
    }
  | {
      status: "success";
      message: string;
      created: CreatedVirtualKeyResponse;
    };

export type BulkRevokeVirtualKeysActionResult =
  | {
      status: "success";
      message: string;
      virtualKeys: VirtualKey[];
      failedIds: string[];
    }
  | {
      status: "error";
      message: string;
      virtualKeys: VirtualKey[];
      failedIds: string[];
    };

export type BulkRotateVirtualKeysActionResult =
  | {
      status: "success";
      message: string;
      rotated: Array<{
        previousId: string;
        created: CreatedVirtualKeyResponse;
      }>;
      failedIds: string[];
    }
  | {
      status: "error";
      message: string;
      rotated: Array<{
        previousId: string;
        created: CreatedVirtualKeyResponse;
      }>;
      failedIds: string[];
    };

export async function createVirtualKeyAction(
  input: CreateVirtualKeyActionInput,
): Promise<CreateVirtualKeyActionResult> {
  try {
    const label = input.label.trim();
    if (!label) {
      return {
        status: "error",
        message: toFriendlyRequiredMessage("label"),
        created: null,
      };
    }

    const created = await createVirtualKey({
      workspaceId: input.workspaceId,
      providerConnectionId: input.providerConnectionId,
      label,
      owner: normalizeOptionalLabel(input.owner),
      team: normalizeOptionalLabel(input.team),
      service: normalizeOptionalLabel(input.service),
      projectId: input.projectId,
      environmentId: input.environmentId,
      environment: input.environment,
      scopes: normalizeVirtualKeyScopes(input.scopes),
      expiresAt: input.expiresAt ?? null,
    });

    return {
      status: "success",
      message: virtualKeyActionMessageKeys.createSuccess,
      created,
    };
  } catch (error) {
    return {
      status: "error",
      message: getErrorMessage(error),
      created: null,
    };
  }
}

export type RevokeVirtualKeyActionResult =
  | {
      status: "success";
      message: string;
      virtualKey: VirtualKey;
    }
  | {
      status: "error";
      message: string;
      virtualKey: null;
    };

export async function revokeVirtualKeyAction(virtualKeyId: string): Promise<RevokeVirtualKeyActionResult> {
  try {
    const virtualKey = await revokeVirtualKey(virtualKeyId);

    return {
      status: "success",
      message: virtualKeyActionMessageKeys.revokeSuccess,
      virtualKey,
    };
  } catch (error) {
    return {
      status: "error",
      message: getErrorMessage(error),
      virtualKey: null,
    };
  }
}

export async function rotateVirtualKeyAction(virtualKeyId: string): Promise<CreateVirtualKeyActionResult> {
  try {
    const created = await rotateVirtualKey(virtualKeyId);

    return {
      status: "success",
      message: virtualKeyActionMessageKeys.rotateSuccess,
      created,
    };
  } catch (error) {
    return {
      status: "error",
      message: getErrorMessage(error),
      created: null,
    };
  }
}

export async function bulkRevokeVirtualKeysAction(virtualKeyIds: string[]): Promise<BulkRevokeVirtualKeysActionResult> {
  const uniqueVirtualKeyIds = [...new Set(virtualKeyIds.map((virtualKeyId) => virtualKeyId.trim()).filter(Boolean))];

  if (!uniqueVirtualKeyIds.length) {
    return {
      status: "error",
      message: virtualKeyActionMessageKeys.bulkRevokeNoneSelected,
      virtualKeys: [],
      failedIds: [],
    };
  }

  const settledResults = await Promise.allSettled(uniqueVirtualKeyIds.map((virtualKeyId) => revokeVirtualKey(virtualKeyId)));
  const virtualKeys: VirtualKey[] = [];
  const failedIds: string[] = [];

  settledResults.forEach((result, index) => {
    if (result.status === "fulfilled") {
      virtualKeys.push(result.value);
      return;
    }

    failedIds.push(uniqueVirtualKeyIds[index] ?? "");
  });

  if (!virtualKeys.length) {
    return {
      status: "error",
      message: virtualKeyActionMessageKeys.bulkRevokeNoneSucceeded,
      virtualKeys,
      failedIds,
    };
  }

  return {
    status: failedIds.length > 0 ? "error" : "success",
    message:
      failedIds.length > 0
        ? virtualKeyActionMessageKeys.bulkRevokePartial
        : virtualKeyActionMessageKeys.bulkRevokeSuccess,
    virtualKeys,
    failedIds,
  };
}

export async function bulkRotateVirtualKeysAction(virtualKeyIds: string[]): Promise<BulkRotateVirtualKeysActionResult> {
  const uniqueVirtualKeyIds = [...new Set(virtualKeyIds.map((virtualKeyId) => virtualKeyId.trim()).filter(Boolean))];

  if (!uniqueVirtualKeyIds.length) {
    return {
      status: "error",
      message: virtualKeyActionMessageKeys.bulkRotateNoneSelected,
      rotated: [],
      failedIds: [],
    };
  }

  const settledResults = await Promise.allSettled(uniqueVirtualKeyIds.map((virtualKeyId) => rotateVirtualKey(virtualKeyId)));
  const rotated: Array<{
    previousId: string;
    created: CreatedVirtualKeyResponse;
  }> = [];
  const failedIds: string[] = [];

  settledResults.forEach((result, index) => {
    if (result.status === "fulfilled") {
      const previousId = uniqueVirtualKeyIds[index];
      if (previousId) {
        rotated.push({
          previousId,
          created: result.value,
        });
      }
      return;
    }

    failedIds.push(uniqueVirtualKeyIds[index] ?? "");
  });

  if (!rotated.length) {
    return {
      status: "error",
      message: virtualKeyActionMessageKeys.bulkRotateNoneSucceeded,
      rotated,
      failedIds,
    };
  }

  return {
    status: failedIds.length > 0 ? "error" : "success",
    message:
      failedIds.length > 0
        ? virtualKeyActionMessageKeys.bulkRotatePartial
        : virtualKeyActionMessageKeys.bulkRotateSuccess,
    rotated,
    failedIds,
  };
}
