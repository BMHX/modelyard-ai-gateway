"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { memberUsesProjectAssignments, type Member, type MemberRole } from "@teamops/contracts";

import { createMember, deleteMember, replaceMemberProjectAssignments, updateMember } from "../lib/control-api";
import { getUserErrorMessage } from "../lib/user-facing-error";
import { buildMembersRedirect } from "./routing";

function getErrorMessage(error: unknown) {
  return getUserErrorMessage(error, "Can't save this member right now.");
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
  const value = typeof rawValue === "string" ? rawValue.trim() : "";
  return value || null;
}

function normalizeOptionalDateTime(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error("temporaryAccessExpiresAt must be a valid date time");
  }

  return new Date(parsed).toISOString();
}

function getMultiStrings(formData: FormData, key: string) {
  return formData
    .getAll(key)
    .flatMap((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean);
}

function getMemberRole(formData: FormData, key: string) {
  return getRequiredString(formData, key) as MemberRole;
}

function getMemberRoles(formData: FormData, key = "roles") {
  return getMultiStrings(formData, key) as MemberRole[];
}

function getRoleSelectionFromFormData(formData: FormData) {
  const roles = getMemberRoles(formData);

  return {
    role: roles[0] ?? null,
    roles,
  };
}

function getTemporaryAccessExpiresAt(formData: FormData, key = "temporaryAccessExpiresAt") {
  return normalizeOptionalDateTime(getOptionalString(formData, key));
}

async function syncMemberProjectAssignments(
  projectIds: string[],
  memberId: string,
  role: MemberRole | null,
  roles?: readonly MemberRole[],
) {
  const usesProjectAssignments =
    roles !== undefined
      ? memberUsesProjectAssignments({
          role: role ?? "developer",
          roles,
        })
      : role
        ? memberUsesProjectAssignments({ role })
        : false;

  await replaceMemberProjectAssignments(memberId, {
    projectIds: usesProjectAssignments ? projectIds : [],
  });
}

type MemberAssignmentsResult = {
  member: Member;
  assignmentsErrorMessage: string | null;
};

const memberMessageKeys = {
  invited: "message.invited",
  createdActive: "message.createdActive",
  updated: "message.updated",
  removed: "message.removed",
  assignmentWarning: "message.assignmentWarning",
  bulkDisable: {
    noSelection: "message.bulkDisable.noSelection",
    success: "message.bulkDisable.success",
    partial: "message.bulkDisable.partial",
    allFailed: "message.bulkDisable.allFailed",
  },
};

async function finalizeMemberAssignments(input: {
  member: Member;
  projectIds: string[];
  role: MemberRole | null;
  roles?: readonly MemberRole[];
  actionLabel: string;
}): Promise<MemberAssignmentsResult> {
  try {
    await syncMemberProjectAssignments(input.projectIds, input.member.id, input.role, input.roles);

    return {
      member: input.member,
      assignmentsErrorMessage: null,
    };
  } catch (error) {
    return {
      member: input.member,
      assignmentsErrorMessage: memberMessageKeys.assignmentWarning,
    };
  }
}

async function saveMemberRecord(input: {
  memberId: string;
  name: string;
  role: MemberRole | null;
  roles: MemberRole[];
  status: Member["status"];
  projectIds: string[];
  temporaryAccessExpiresAt: string | null;
  actionLabel?: string;
}): Promise<MemberAssignmentsResult> {
  const member = await updateMember(input.memberId, {
    name: input.name,
    ...(input.role ? { role: input.role } : {}),
    roles: input.roles,
    status: input.status,
    temporaryAccessExpiresAt: input.temporaryAccessExpiresAt,
  });

  return finalizeMemberAssignments({
    member,
    projectIds: input.projectIds,
    role: input.role,
    roles: input.roles,
    actionLabel: input.actionLabel ?? "Saved",
  });
}

export type MemberMutationActionResult =
  | {
      status: "success";
      message: string;
      member: Member;
    }
  | {
      status: "partial";
      message: string;
      member: Member;
    }
  | {
      status: "error";
      message: string;
      member: null;
    };

export type DeleteMemberActionResult =
  | {
      status: "success";
      message: string;
      memberId: string;
    }
  | {
      status: "error";
      message: string;
      memberId: null;
    };

export type BulkDisableMembersActionResult =
  | {
      status: "success";
      message: string;
      members: Member[];
      failedIds: string[];
    }
  | {
      status: "error";
      message: string;
      members: Member[];
      failedIds: string[];
    };

export type AssignMemberProjectsMutationActionResult =
  | {
      status: "success";
      message: string;
      memberId: string;
    }
  | {
      status: "error";
      message: string;
      memberId: null;
    };

export async function assignMemberProjectsMutationAction(input: {
  memberId: string;
  role: MemberRole;
  roles?: readonly MemberRole[];
  projectIds: string[];
}): Promise<AssignMemberProjectsMutationActionResult> {
  try {
    await syncMemberProjectAssignments(
      [...new Set(input.projectIds.map((projectId) => projectId.trim()).filter(Boolean))],
      input.memberId,
      input.role,
      input.roles,
    );

    return {
      status: "success",
      message: memberMessageKeys.updated,
      memberId: input.memberId,
    };
  } catch (error) {
    return {
      status: "error",
      message: getErrorMessage(error),
      memberId: null,
    };
  }
}

export async function assignMemberProjectsAction(formData: FormData) {
  const workspaceId = getRequiredString(formData, "workspaceId");
  const memberId = getRequiredString(formData, "memberId");
  const role = getMemberRole(formData, "role");
  const roles = getMemberRoles(formData, "roles");
  const redirectPath = typeof formData.get("redirectPath") === "string" ? String(formData.get("redirectPath")).trim() : undefined;
  const projectId = getOptionalString(formData, "projectId");
  let destination = buildMembersRedirect(workspaceId, redirectPath, {
    task: "assign-projects",
    focusMemberId: memberId,
    projectId: projectId ?? undefined,
  });

  const result = await assignMemberProjectsMutationAction({
    memberId,
    role,
    roles,
    projectIds: getMultiStrings(formData, "projectIds"),
  });

  if (result.status === "success") {
    destination = buildMembersRedirect(workspaceId, redirectPath, {
      notice: "updated",
      message: result.message,
      clearTaskState: true,
    });
  } else {
    destination = buildMembersRedirect(workspaceId, redirectPath, {
      notice: "error",
      message: result.message,
      focusMemberId: memberId,
      task: "assign-projects",
      projectId: projectId ?? undefined,
    });
  }

  revalidatePath("/", "layout");
  redirect(destination);
}

export async function saveMemberAction(input: {
  memberId: string;
  name: string;
  role: MemberRole;
  status: Member["status"];
  projectIds: string[];
  temporaryAccessExpiresAt: string | null;
}): Promise<MemberMutationActionResult> {
  try {
    const result = await saveMemberRecord({
      memberId: input.memberId,
      name: input.name.trim(),
      role: input.role,
      roles: [input.role],
      status: input.status,
      projectIds: input.projectIds,
      temporaryAccessExpiresAt: normalizeOptionalDateTime(input.temporaryAccessExpiresAt),
      actionLabel: "Updated",
    });

    if (result.assignmentsErrorMessage) {
      return {
        status: "partial",
        message: result.assignmentsErrorMessage,
        member: result.member,
      };
    }

    return {
      status: "success",
      message: memberMessageKeys.updated,
      member: result.member,
    };
  } catch (error) {
    return {
      status: "error",
      message: getErrorMessage(error),
      member: null,
    };
  }
}

export async function removeMemberAction(memberId: string): Promise<DeleteMemberActionResult> {
  try {
    await deleteMember(memberId);

    return {
      status: "success",
      message: memberMessageKeys.removed,
      memberId,
    };
  } catch (error) {
    return {
      status: "error",
      message: getErrorMessage(error),
      memberId: null,
    };
  }
}

export async function bulkDisableMembersAction(memberIds: string[]): Promise<BulkDisableMembersActionResult> {
  const uniqueMemberIds = [...new Set(memberIds.map((memberId) => memberId.trim()).filter(Boolean))];

  if (!uniqueMemberIds.length) {
    return {
      status: "error",
      message: memberMessageKeys.bulkDisable.noSelection,
      members: [],
      failedIds: [],
    };
  }

  const settledResults = await Promise.allSettled(
    uniqueMemberIds.map((memberId) =>
      updateMember(memberId, {
        status: "disabled",
      }),
    ),
  );

  const members: Member[] = [];
  const failedIds: string[] = [];

  settledResults.forEach((result, index) => {
    if (result.status === "fulfilled") {
      members.push(result.value);
      return;
    }

    failedIds.push(uniqueMemberIds[index] ?? "");
  });

  if (!members.length) {
    return {
      status: "error",
      message: memberMessageKeys.bulkDisable.allFailed,
      members,
      failedIds,
    };
  }

  const message =
    failedIds.length > 0 ? memberMessageKeys.bulkDisable.partial : memberMessageKeys.bulkDisable.success;

  return {
    status: failedIds.length > 0 ? "error" : "success",
    message,
    members,
    failedIds,
  };
}

export async function createMemberAction(formData: FormData) {
  const workspaceId = getRequiredString(formData, "workspaceId");
  const redirectPath = typeof formData.get("redirectPath") === "string" ? String(formData.get("redirectPath")).trim() : undefined;
  let destination = buildMembersRedirect(workspaceId, redirectPath);

  try {
    const role = getMemberRole(formData, "role");
    const member = await createMember({
      workspaceId,
      name: getRequiredString(formData, "name"),
      email: getRequiredString(formData, "email"),
      role,
      roles: [role],
      temporaryAccessExpiresAt: getTemporaryAccessExpiresAt(formData),
    });

    const assignmentResult = await finalizeMemberAssignments({
      member,
      projectIds: getMultiStrings(formData, "projectIds"),
      role,
      roles: [role],
      actionLabel: "Invited",
    });

    destination = memberUsesProjectAssignments({ role, roles: [role] })
      ? buildMembersRedirect(workspaceId, redirectPath, {
          notice: assignmentResult.assignmentsErrorMessage ? "error" : "created",
          message: assignmentResult.assignmentsErrorMessage ?? memberMessageKeys.invited,
          focusMemberId: assignmentResult.member.id,
          task: "assign-projects",
        })
      : buildMembersRedirect(workspaceId, redirectPath, {
          notice: assignmentResult.assignmentsErrorMessage ? "error" : "created",
          message: assignmentResult.assignmentsErrorMessage ?? memberMessageKeys.invited,
          focusMemberId: assignmentResult.member.id,
        });
  } catch (error) {
    destination = buildMembersRedirect(workspaceId, redirectPath, {
      notice: "error",
      message: getErrorMessage(error),
    });
  }

  revalidatePath("/", "layout");
  redirect(destination);
}

export async function createMemberMutationAction(input: {
  workspaceId: string;
  name: string;
  email: string;
  role: MemberRole;
  projectIds: string[];
  temporaryAccessExpiresAt?: string | null;
}): Promise<MemberMutationActionResult> {
  try {
    const member = await createMember({
      workspaceId: input.workspaceId.trim(),
      name: input.name.trim(),
      email: input.email.trim(),
      role: input.role,
      roles: [input.role],
      temporaryAccessExpiresAt: normalizeOptionalDateTime(
        input.temporaryAccessExpiresAt ?? null,
      ),
    });

    const assignmentResult = await finalizeMemberAssignments({
      member,
      projectIds: input.projectIds,
      role: input.role,
      roles: [input.role],
      actionLabel: "Invited",
    });

    if (assignmentResult.assignmentsErrorMessage) {
      return {
        status: "partial",
        message: assignmentResult.assignmentsErrorMessage,
        member: assignmentResult.member,
      };
    }

    return {
      status: "success",
      message: memberMessageKeys.invited,
      member: assignmentResult.member,
    };
  } catch (error) {
    return {
      status: "error",
      message: getErrorMessage(error),
      member: null,
    };
  }
}

export async function createActiveMemberAction(formData: FormData) {
  const workspaceId = getRequiredString(formData, "workspaceId");
  const redirectPath = typeof formData.get("redirectPath") === "string" ? String(formData.get("redirectPath")).trim() : undefined;
  let destination = buildMembersRedirect(workspaceId, redirectPath);
  let createdMember: Member | null = null;

  try {
    const role = getMemberRole(formData, "role");
    createdMember = await createMember({
      workspaceId,
      name: getRequiredString(formData, "name"),
      email: getRequiredString(formData, "email"),
      role,
      roles: [role],
      temporaryAccessExpiresAt: getTemporaryAccessExpiresAt(formData),
    });

    const activeMember = await updateMember(createdMember.id, {
      status: "active",
    });

    const assignmentResult = await finalizeMemberAssignments({
      member: activeMember,
      projectIds: getMultiStrings(formData, "projectIds"),
      role,
      roles: [role],
      actionLabel: "Created",
    });

    destination = memberUsesProjectAssignments({ role, roles: [role] })
      ? buildMembersRedirect(workspaceId, redirectPath, {
          notice: assignmentResult.assignmentsErrorMessage ? "error" : "created",
          message: assignmentResult.assignmentsErrorMessage ?? memberMessageKeys.createdActive,
          focusMemberId: assignmentResult.member.id,
          task: "assign-projects",
        })
      : buildMembersRedirect(workspaceId, redirectPath, {
          notice: assignmentResult.assignmentsErrorMessage ? "error" : "created",
          message: assignmentResult.assignmentsErrorMessage ?? memberMessageKeys.createdActive,
          focusMemberId: assignmentResult.member.id,
        });
  } catch (error) {
    destination = buildMembersRedirect(workspaceId, redirectPath, {
      notice: "error",
      message: getErrorMessage(error),
      focusMemberId: createdMember?.id ?? undefined,
    });
  }

  revalidatePath("/", "layout");
  redirect(destination);
}

export async function createActiveMemberMutationAction(input: {
  workspaceId: string;
  name: string;
  email: string;
  role: MemberRole;
  projectIds: string[];
  temporaryAccessExpiresAt?: string | null;
}): Promise<MemberMutationActionResult> {
  let createdMember: Member | null = null;

  try {
    createdMember = await createMember({
      workspaceId: input.workspaceId.trim(),
      name: input.name.trim(),
      email: input.email.trim(),
      role: input.role,
      roles: [input.role],
      temporaryAccessExpiresAt: normalizeOptionalDateTime(
        input.temporaryAccessExpiresAt ?? null,
      ),
    });

    const activeMember = await updateMember(createdMember.id, {
      status: "active",
    });

    const assignmentResult = await finalizeMemberAssignments({
      member: activeMember,
      projectIds: input.projectIds,
      role: input.role,
      roles: [input.role],
      actionLabel: "Created",
    });

    if (assignmentResult.assignmentsErrorMessage) {
      return {
        status: "partial",
        message: assignmentResult.assignmentsErrorMessage,
        member: assignmentResult.member,
      };
    }

    return {
      status: "success",
      message: memberMessageKeys.createdActive,
      member: assignmentResult.member,
    };
  } catch (error) {
    return {
      status: "error",
      message: getErrorMessage(error),
      member: null,
    };
  }
}

export async function updateMemberAction(formData: FormData) {
  const workspaceId = getRequiredString(formData, "workspaceId");
  const memberId = getRequiredString(formData, "memberId");
  const redirectPath = typeof formData.get("redirectPath") === "string" ? String(formData.get("redirectPath")).trim() : undefined;
  const clearTaskStateOnSuccess = getOptionalString(formData, "clearTaskStateOnSuccess") === "true";
  let destination = buildMembersRedirect(workspaceId, redirectPath);

  try {
    const { role, roles } = getRoleSelectionFromFormData(formData);
    const result = await saveMemberRecord({
      memberId,
      name: getRequiredString(formData, "name"),
      role,
      roles,
      status: getRequiredString(formData, "status") as Member["status"],
      projectIds: getMultiStrings(formData, "projectIds"),
      temporaryAccessExpiresAt: getTemporaryAccessExpiresAt(formData),
      actionLabel: "Updated",
    });

    destination = buildMembersRedirect(workspaceId, redirectPath, {
      notice: result.assignmentsErrorMessage ? "error" : "updated",
      message: result.assignmentsErrorMessage ?? memberMessageKeys.updated,
      focusMemberId: result.member.id,
      clearTaskState: clearTaskStateOnSuccess,
    });
  } catch (error) {
    destination = buildMembersRedirect(workspaceId, redirectPath, {
      notice: "error",
      message: getErrorMessage(error),
      focusMemberId: memberId,
    });
  }

  revalidatePath("/", "layout");
  redirect(destination);
}

export async function deleteMemberAction(formData: FormData) {
  const workspaceId = getRequiredString(formData, "workspaceId");
  const redirectPath = typeof formData.get("redirectPath") === "string" ? String(formData.get("redirectPath")).trim() : undefined;
  const memberId = getRequiredString(formData, "memberId");
  let destination = buildMembersRedirect(workspaceId, redirectPath);

  try {
    await deleteMember(memberId);

    destination = buildMembersRedirect(workspaceId, redirectPath, {
      notice: "deleted",
      message: memberMessageKeys.removed,
      anchor: "members-roster",
    });
  } catch (error) {
    destination = buildMembersRedirect(workspaceId, redirectPath, {
      notice: "error",
      message: getErrorMessage(error),
      focusMemberId: memberId,
    });
  }

  revalidatePath("/", "layout");
  redirect(destination);
}

export async function bulkDisableMembersFormAction(formData: FormData) {
  const workspaceId = getRequiredString(formData, "workspaceId");
  const redirectPath = typeof formData.get("redirectPath") === "string" ? String(formData.get("redirectPath")).trim() : undefined;
  const memberIds = getMultiStrings(formData, "memberIds");
  let destination = buildMembersRedirect(workspaceId, redirectPath);

  try {
    const result = await bulkDisableMembersAction(memberIds);
    destination = buildMembersRedirect(workspaceId, redirectPath, {
      notice: result.status === "success" ? "updated" : "error",
      message: result.message,
      anchor: "member-primary-view",
    });
  } catch (error) {
    destination = buildMembersRedirect(workspaceId, redirectPath, {
      notice: "error",
      message: getErrorMessage(error),
    });
  }

  revalidatePath("/", "layout");
  redirect(destination);
}
