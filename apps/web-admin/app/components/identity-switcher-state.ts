import {
  getIdentityRoleOptions,
  type AuthIdentityOption,
  type IdentityRoleOption,
} from "@/app/lib/auth-identities";

export function getVisibleIdentityRoleOptions(args: {
  identities: AuthIdentityOption[];
  currentWorkspaceId: string | null;
  activeMembershipId?: string | null;
}) {
  const { activeMembershipId = null, currentWorkspaceId, identities } = args;
  const workspaceScopedIdentities = currentWorkspaceId
    ? identities.filter((identity) => identity.workspaceId === currentWorkspaceId)
    : identities;
  const activeIdentity =
    activeMembershipId
      ? identities.find((identity) => identity.membershipId === activeMembershipId) ?? null
      : null;
  const visibleIdentities =
    workspaceScopedIdentities.length > 0
      ? workspaceScopedIdentities
      : activeIdentity
        ? [activeIdentity]
        : identities;

  return getIdentityRoleOptions(visibleIdentities);
}

export function getActiveIdentity(args: {
  identities: AuthIdentityOption[];
  visibleRoleOptions: IdentityRoleOption[];
  activeMembershipId: string | null;
  activeRole: string | null;
}) {
  const { identities, visibleRoleOptions, activeMembershipId, activeRole } = args;

  return (
    visibleRoleOptions.find(
      ({ identity, role }) =>
        identity.membershipId === activeMembershipId && (!activeRole || role === activeRole),
    )?.identity ??
    identities.find(
      (identity) =>
        identity.membershipId === activeMembershipId &&
        (!activeRole || identity.roles.includes(activeRole)),
    ) ??
    (visibleRoleOptions.length === 1 ? visibleRoleOptions[0]?.identity ?? null : null) ??
    (identities.length === 1 ? identities[0] : null) ??
    null
  );
}
