import { z } from "zod";

export const AuthIdentityOptionSchema = z.object({
  membershipId: z.string().min(1),
  workspaceId: z.string().min(1),
  workspaceName: z.string().min(1),
  roles: z.array(z.string().min(1)).min(1),
});

export type AuthIdentityOption = z.infer<typeof AuthIdentityOptionSchema>;

export const AuthSelectIdentityInputSchema = z.object({
  membershipId: z.string().min(1),
  role: z.string().min(1),
});

export type AuthSelectIdentityInput = z.infer<typeof AuthSelectIdentityInputSchema>;

export type IdentityRoleOption = {
  identity: AuthIdentityOption;
  role: string;
};

const workspaceRolePriority = [
  "organization_owner",
  "workspace_admin",
  "developer",
] as const;

export type WorkspaceIdentitySelection = {
  needsSwitch: boolean;
  selectedMembershipId: string;
  selectedRole: string;
  workspaceId: string;
};

function getRolePriority(role: string) {
  const priority = workspaceRolePriority.indexOf(
    role as (typeof workspaceRolePriority)[number],
  );
  return priority === -1 ? workspaceRolePriority.length : priority;
}

export function isWorkspaceIdentityMismatchMessage(message?: string | null) {
  return message === "The current active identity does not have access to this workspace";
}

export function getIdentityRoleOptions(
  identities: AuthIdentityOption[],
): IdentityRoleOption[] {
  return identities.flatMap((identity) =>
    identity.roles.map((role) => ({
      identity,
      role,
    })),
  );
}

export function resolveWorkspaceIdentitySelection(args: {
  identities: AuthIdentityOption[];
  targetWorkspaceId: string | null;
  activeMembershipId?: string | null;
  activeRole?: string | null;
}): WorkspaceIdentitySelection | null {
  const {
    identities,
    targetWorkspaceId,
    activeMembershipId = null,
    activeRole = null,
  } = args;

  if (!targetWorkspaceId) {
    return null;
  }

  const workspaceIdentities = identities.filter(
    (identity) => identity.workspaceId === targetWorkspaceId,
  );
  if (!workspaceIdentities.length) {
    return null;
  }

  const activeWorkspaceIdentity =
    activeMembershipId
      ? workspaceIdentities.find(
          (identity) => identity.membershipId === activeMembershipId,
        ) ?? null
      : null;

  if (activeWorkspaceIdentity) {
    const selectedRole =
      activeRole && activeWorkspaceIdentity.roles.includes(activeRole)
        ? activeRole
        : [...activeWorkspaceIdentity.roles].sort(
            (left, right) => getRolePriority(left) - getRolePriority(right),
          )[0] ?? null;

    if (!selectedRole) {
      return null;
    }

    return {
      needsSwitch:
        activeMembershipId !== activeWorkspaceIdentity.membershipId ||
        activeRole !== selectedRole,
      selectedMembershipId: activeWorkspaceIdentity.membershipId,
      selectedRole,
      workspaceId: targetWorkspaceId,
    };
  }

  const matchingRoleOption =
    activeRole
      ? workspaceIdentities.find((identity) => identity.roles.includes(activeRole)) ?? null
      : null;
  if (matchingRoleOption && activeRole) {
    return {
      needsSwitch: true,
      selectedMembershipId: matchingRoleOption.membershipId,
      selectedRole: activeRole,
      workspaceId: targetWorkspaceId,
    };
  }

  const rankedRoleOption =
    workspaceIdentities
      .flatMap((identity) =>
        identity.roles.map((role) => ({
          membershipId: identity.membershipId,
          role,
        })),
      )
      .sort((left, right) => getRolePriority(left.role) - getRolePriority(right.role))[0] ??
    null;

  if (!rankedRoleOption) {
    return null;
  }

  return {
    needsSwitch: true,
    selectedMembershipId: rankedRoleOption.membershipId,
    selectedRole: rankedRoleOption.role,
    workspaceId: targetWorkspaceId,
  };
}
