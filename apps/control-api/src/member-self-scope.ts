import type { VirtualKey } from "@teamops/contracts";

import type { WorkspaceAccess } from "./permissions.js";

export function shouldApplyMemberSelfScope(access: WorkspaceAccess) {
  return !access.isAdmin && access.member.role === "developer";
}

export function getMemberSelfScopeFilters(access: WorkspaceAccess) {
  if (access.isAdmin || access.member.role !== "developer") {
    return null;
  }

  return {
    owner: access.member.email,
    issuedByMemberId: access.member.id,
  };
}

export function isVirtualKeyVisibleWithinMemberSelfScope(
  access: WorkspaceAccess,
  virtualKey: Pick<VirtualKey, "owner" | "issuedByMemberId">,
) {
  if (access.isAdmin || access.member.role !== "developer") {
    return true;
  }

  const memberEmail = access.member.email.trim().toLowerCase();
  const keyOwner = virtualKey.owner?.trim().toLowerCase() ?? null;

  return keyOwner === memberEmail || virtualKey.issuedByMemberId === access.member.id;
}
