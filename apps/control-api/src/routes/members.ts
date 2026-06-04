import type { FastifyInstance, FastifyReply } from "fastify";

import {
  CreateMemberInputSchema,
  ReplaceMemberProjectAssignmentsInputSchema,
  UpdateMemberInputSchema,
} from "@teamops/contracts";
import {
  createMember,
  deleteMember,
  listMemberProjectAssignments,
  listMembers,
  replaceMemberProjectAssignments,
  updateMember,
} from "@teamops/database";

import { appendRequestAuditLog } from "../audit.js";
import type { ControlApiContext } from "../context.js";
import { requireWorkspacePermission } from "../permissions.js";
import { requireMember, requireProjectInWorkspace, requireWorkspace, validateResourceId } from "../resource-guards.js";

function validateWorkspaceScopedRole(role: string) {
  if (role === "organization_owner") {
    return {
      error: {
        message: "organization_owner is not managed from workspace member APIs",
      },
    };
  }

  return null;
}

function validateWorkspaceScopedRoles(roles: string[] | undefined) {
  if (!roles) {
    return null;
  }

  for (const role of roles) {
    const roleError = validateWorkspaceScopedRole(role);
    if (roleError) {
      return roleError;
    }
  }

  return null;
}

async function validateAssignedProjects(
  context: ControlApiContext,
  reply: FastifyReply,
  workspaceId: string,
  projectIds: string[],
) {
  for (const projectId of projectIds) {
    const project = await requireProjectInWorkspace(context.db, reply, projectId, workspaceId);
    if ("error" in project) {
      return project;
    }

    if (project.status !== "active") {
      reply.code(400);
      return {
        error: {
          message: "Only active projects can be assigned to members",
        },
      };
    }
  }

  return null;
}

export async function registerMemberRoutes(app: FastifyInstance, context: ControlApiContext) {
  app.get("/v1/members", async (request, reply) => {
    const query = request.query as { workspaceId?: string };
    if (!query.workspaceId) {
      return { items: [] };
    }

    const validationError = validateResourceId(reply, "workspace", query.workspaceId);
    if (validationError) {
      return validationError;
    }

    const permissionError = await requireWorkspacePermission(context, request, reply, "member.read", query.workspaceId);
    if (permissionError) {
      return permissionError;
    }

    return {
      items: await listMembers(context.db, query.workspaceId),
    };
  });

  app.get("/v1/member-project-assignments", async (request, reply) => {
    const query = request.query as { workspaceId?: string };
    if (!query.workspaceId) {
      return { items: [] };
    }

    const validationError = validateResourceId(reply, "workspace", query.workspaceId);
    if (validationError) {
      return validationError;
    }

    const permissionError = await requireWorkspacePermission(context, request, reply, "member.read", query.workspaceId);
    if (permissionError) {
      return permissionError;
    }

    return {
      items: await listMemberProjectAssignments(context.db, query.workspaceId),
    };
  });

  app.post("/v1/members", async (request, reply) => {
    const input = CreateMemberInputSchema.parse(request.body);
    const permissionError = await requireWorkspacePermission(context, request, reply, "member.write", input.workspaceId);
    if (permissionError) {
      return permissionError;
    }

    const roleError = validateWorkspaceScopedRole(input.role);
    if (roleError) {
      reply.code(400);
      return roleError;
    }

    const rolesError = validateWorkspaceScopedRoles(input.roles);
    if (rolesError) {
      reply.code(400);
      return rolesError;
    }

    const workspace = await requireWorkspace(context.db, reply, input.workspaceId);
    if ("error" in workspace) {
      return workspace;
    }

    const member = await createMember(context.db, input);

    await appendRequestAuditLog(context.db, request, {
      workspaceId: workspace.id,
      action: "member.invited",
      subjectType: "member",
      subjectId: member.id,
      payload: {
        email: member.email,
        role: member.role,
        status: member.status,
        temporaryAccessExpiresAt: member.temporaryAccessExpiresAt,
      },
    });

    reply.code(201);
    return member;
  });

  app.patch("/v1/members/:memberId", async (request, reply) => {
    const params = request.params as { memberId: string };
    const input = UpdateMemberInputSchema.parse(request.body);

    if (input.role) {
      const roleError = validateWorkspaceScopedRole(input.role);
      if (roleError) {
        reply.code(400);
        return roleError;
      }
    }

    const rolesError = validateWorkspaceScopedRoles(input.roles);
    if (rolesError) {
      reply.code(400);
      return rolesError;
    }

    const member = await requireMember(context.db, reply, params.memberId);
    if ("error" in member) {
      return member;
    }

    const permissionError = await requireWorkspacePermission(context, request, reply, "member.write", member.workspaceId);
    if (permissionError) {
      return permissionError;
    }

    const updatedMember = await updateMember(context.db, member.id, input);
    if (!updatedMember) {
      reply.code(404);
      return {
        error: {
          message: "Member not found",
        },
      };
    }

    await appendRequestAuditLog(context.db, request, {
      workspaceId: updatedMember.workspaceId,
      action: "member.updated",
      subjectType: "member",
      subjectId: updatedMember.id,
      payload: input,
    });

    return updatedMember;
  });

  app.delete("/v1/members/:memberId", async (request, reply) => {
    const params = request.params as { memberId: string };
    const member = await requireMember(context.db, reply, params.memberId);
    if ("error" in member) {
      return member;
    }

    const permissionError = await requireWorkspacePermission(context, request, reply, "member.write", member.workspaceId);
    if (permissionError) {
      return permissionError;
    }

    const removedMember = await deleteMember(context.db, member.id);
    if (!removedMember) {
      reply.code(404);
      return {
        error: {
          message: "Member not found",
        },
      };
    }

    await appendRequestAuditLog(context.db, request, {
      workspaceId: removedMember.workspaceId,
      action: "member.removed",
      subjectType: "member",
      subjectId: removedMember.id,
      payload: {
        email: removedMember.email,
        role: removedMember.role,
        status: removedMember.status,
      },
    });

    reply.code(204);
    return null;
  });

  app.put("/v1/members/:memberId/project-assignments", async (request, reply) => {
    const params = request.params as { memberId: string };
    const input = ReplaceMemberProjectAssignmentsInputSchema.parse(request.body);
    const member = await requireMember(context.db, reply, params.memberId);
    if ("error" in member) {
      return member;
    }

    const permissionError = await requireWorkspacePermission(context, request, reply, "member.write", member.workspaceId);
    if (permissionError) {
      return permissionError;
    }

    const projectValidationError = await validateAssignedProjects(context, reply, member.workspaceId, input.projectIds);
    if (projectValidationError) {
      return projectValidationError;
    }

    const projectIds = await replaceMemberProjectAssignments(context.db, member.id, input);

    await appendRequestAuditLog(context.db, request, {
      workspaceId: member.workspaceId,
      action: "member.project-assignments.replaced",
      subjectType: "member",
      subjectId: member.id,
      payload: {
        projectIds,
      },
    });

    return {
      memberId: member.id,
      projectIds,
    };
  });
}
