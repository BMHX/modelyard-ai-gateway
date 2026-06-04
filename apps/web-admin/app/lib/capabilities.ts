import { type WorkspaceHomeOverview } from "@teamops/contracts";

export type Capabilities = {
  canAccessAdminSurfaces: boolean;
  canManageInfrastructure: boolean;
  canManageGovernance: boolean;
  canManageProjects: boolean;
  canManageMembers: boolean;
  canAccessDeveloperTools: boolean;
  canSelfServeVirtualKeys: boolean;
  canViewUsage: boolean;
  canReviewPrompts: boolean;
  isAdvancedUser: boolean;
  isManager: boolean;
};

export function getCapabilitiesFromPermissions(
  permissions?: WorkspaceHomeOverview["permissions"] | null,
): Capabilities {
  const p = permissions ?? {
    projects: false,
    budgets: false,
    usage: false,
    providers: false,
    virtualKeys: false,
    selfServeVirtualKeys: false,
    auditLogs: false,
    exports: false,
    members: false,
    promptInspections: false,
    promptInspectionReview: false,
    promptPolicyWrite: false,
  };

  const canAccessAdminSurfaces = p.providers || p.members || p.promptPolicyWrite;
  const canManageGovernance = p.budgets || p.auditLogs || p.exports;

  return {
    canAccessAdminSurfaces,
    canManageInfrastructure: p.providers,
    canManageGovernance,
    canManageProjects: p.projects,
    canManageMembers: p.members,
    canAccessDeveloperTools: p.virtualKeys || p.selfServeVirtualKeys,
    canSelfServeVirtualKeys: p.selfServeVirtualKeys,
    canViewUsage: p.usage,
    canReviewPrompts: p.promptInspectionReview,
    isAdvancedUser: p.promptPolicyWrite,
    isManager: canAccessAdminSurfaces,
  };
}

export const EMPTY_CAPABILITIES: Capabilities = {
  canAccessAdminSurfaces: false,
  canManageInfrastructure: false,
  canManageGovernance: false,
  canManageProjects: false,
  canManageMembers: false,
  canAccessDeveloperTools: false,
  canSelfServeVirtualKeys: false,
  canViewUsage: false,
  canReviewPrompts: false,
  isAdvancedUser: false,
  isManager: false,
};
