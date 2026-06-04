import { roleUsesProjectAssignments } from "@teamops/contracts";
import { listAssignedProjectIdsForMember } from "@teamops/database";

import type { ControlApiContext } from "./context.js";
import type { WorkspaceAccess } from "./permissions.js";

export function shouldApplyAssignedProjectScopeToExport(
  access: WorkspaceAccess | { error: { message: string } },
  _filters: Record<string, unknown>,
) {
  if ("error" in access || access.isAdmin || !roleUsesProjectAssignments(access.member.role)) {
    return false;
  }

  return true;
}

export async function getAssignedProjectIdSet(
  context: ControlApiContext,
  access: WorkspaceAccess | { error: { message: string } },
) {
  if ("error" in access || access.isAdmin || !roleUsesProjectAssignments(access.member.role)) {
    return null;
  }

  return new Set(await listAssignedProjectIdsForMember(context.db, access.member.id));
}
