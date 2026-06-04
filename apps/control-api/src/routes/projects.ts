import type { FastifyInstance } from "fastify";

import {
  CreateEnvironmentInputSchema,
  CreateProjectInputSchema,
  UpdateEnvironmentInputSchema,
  UpdateProjectInputSchema,
} from "@teamops/contracts";
import {
  createEnvironment,
  createProject,
  listEnvironments,
  listEnvironmentsByWorkspace,
  listProjects,
  updateEnvironment,
  updateProject,
} from "@teamops/database";

import { appendRequestAuditLog } from "../audit.js";
import type { ControlApiContext } from "../context.js";
import { getWorkspaceAccess } from "../permissions.js";
import { getAssignedProjectIdSet } from "../project-scope.js";
import {
  requireEnvironment,
  requireProject,
  requireProjectInWorkspace,
  requireWorkspace,
  validateResourceId,
} from "../resource-guards.js";

function buildProjectScopeError(message: string) {
  return {
    error: {
      message,
    },
  };
}

export async function registerProjectRoutes(app: FastifyInstance, context: ControlApiContext) {
  app.get("/v1/projects", async (request, reply) => {
    const query = request.query as { workspaceId?: string };
    if (!query.workspaceId) {
      return { items: [] };
    }

    const validationError = validateResourceId(reply, "workspace", query.workspaceId);
    if (validationError) {
      return validationError;
    }

    const access = await getWorkspaceAccess(context, request, reply, "project.read", query.workspaceId);
    if ("error" in access) {
      return access;
    }

    const assignedProjectIds = await getAssignedProjectIdSet(context, access);
    const items = await listProjects(context.db, query.workspaceId);

    return {
      items: assignedProjectIds ? items.filter((project) => assignedProjectIds.has(project.id)) : items,
    };
  });

  app.post("/v1/projects", async (request, reply) => {
    const input = CreateProjectInputSchema.parse(request.body);
    const access = await getWorkspaceAccess(context, request, reply, "project.write", input.workspaceId);
    if ("error" in access) {
      return access;
    }

    const assignedProjectIds = await getAssignedProjectIdSet(context, access);
    if (assignedProjectIds) {
      reply.code(403);
      return buildProjectScopeError("Creating projects requires workspace_admin access");
    }

    const workspace = await requireWorkspace(context.db, reply, input.workspaceId);
    if ("error" in workspace) {
      return workspace;
    }

    const project = await createProject(context.db, input);

    await appendRequestAuditLog(context.db, request, {
      workspaceId: workspace.id,
      projectId: project.id,
      action: "project.created",
      subjectType: "project",
      subjectId: project.id,
      payload: project,
    });

    reply.code(201);
    return project;
  });

  app.patch("/v1/projects/:projectId", async (request, reply) => {
    const params = request.params as { projectId: string };
    const input = UpdateProjectInputSchema.parse(request.body);
    const project = await requireProject(context.db, reply, params.projectId);
    if ("error" in project) {
      return project;
    }

    const access = await getWorkspaceAccess(context, request, reply, "project.write", project.workspaceId);
    if ("error" in access) {
      return access;
    }

    const assignedProjectIds = await getAssignedProjectIdSet(context, access);
    if (assignedProjectIds && !assignedProjectIds.has(project.id)) {
      reply.code(403);
      return buildProjectScopeError("This project is outside the current assigned project scope");
    }

    const updatedProject = await updateProject(context.db, project.id, input);
    if (!updatedProject) {
      reply.code(404);
      return {
        error: {
          message: "Project not found",
        },
      };
    }

    await appendRequestAuditLog(context.db, request, {
      workspaceId: updatedProject.workspaceId,
      projectId: updatedProject.id,
      action: "project.updated",
      subjectType: "project",
      subjectId: updatedProject.id,
      payload: input,
    });

    return updatedProject;
  });

  app.delete("/v1/projects/:projectId", async (request, reply) => {
    const params = request.params as { projectId: string };
    const project = await requireProject(context.db, reply, params.projectId);
    if ("error" in project) {
      return project;
    }

    const access = await getWorkspaceAccess(context, request, reply, "project.write", project.workspaceId);
    if ("error" in access) {
      return access;
    }

    const assignedProjectIds = await getAssignedProjectIdSet(context, access);
    if (assignedProjectIds) {
      reply.code(403);
      return buildProjectScopeError("Archiving projects requires workspace_admin access");
    }

    const archivedProject = await updateProject(context.db, project.id, {
      status: "archived",
    });

    if (!archivedProject) {
      reply.code(404);
      return {
        error: {
          message: "Project not found",
        },
      };
    }

    await appendRequestAuditLog(context.db, request, {
      workspaceId: archivedProject.workspaceId,
      projectId: archivedProject.id,
      action: "project.archived",
      subjectType: "project",
      subjectId: archivedProject.id,
      payload: {
        previousStatus: project.status,
        nextStatus: archivedProject.status,
      },
    });

    reply.code(204);
    return null;
  });

  app.get("/v1/environments", async (request, reply) => {
    const query = request.query as { projectId?: string; workspaceId?: string };
    if (query.projectId) {
      const project = await requireProject(context.db, reply, query.projectId);
      if ("error" in project) {
        return project;
      }

      const access = await getWorkspaceAccess(
        context,
        request,
        reply,
        "environment.read",
        project.workspaceId,
      );
      if ("error" in access) {
        return access;
      }

      const assignedProjectIds = await getAssignedProjectIdSet(context, access);
      if (assignedProjectIds && !assignedProjectIds.has(project.id)) {
        reply.code(403);
        return buildProjectScopeError("This project is outside the current assigned project scope");
      }

      return {
        items: await listEnvironments(context.db, query.projectId),
      };
    }

    if (query.workspaceId) {
      const validationError = validateResourceId(reply, "workspace", query.workspaceId);
      if (validationError) {
        return validationError;
      }

      const access = await getWorkspaceAccess(
        context,
        request,
        reply,
        "environment.read",
        query.workspaceId,
      );
      if ("error" in access) {
        return access;
      }

      const assignedProjectIds = await getAssignedProjectIdSet(context, access);
      const items = await listEnvironmentsByWorkspace(context.db, query.workspaceId);

      return {
        items: assignedProjectIds ? items.filter((environment) => assignedProjectIds.has(environment.projectId)) : items,
      };
    }

    return { items: [] };
  });

  app.post("/v1/environments", async (request, reply) => {
    const input = CreateEnvironmentInputSchema.parse(request.body);
    const access = await getWorkspaceAccess(
      context,
      request,
      reply,
      "environment.write",
      input.workspaceId,
    );
    if ("error" in access) {
      return access;
    }

    const project = await requireProjectInWorkspace(context.db, reply, input.projectId, input.workspaceId);
    if ("error" in project) {
      return project;
    }

    const assignedProjectIds = await getAssignedProjectIdSet(context, access);
    if (assignedProjectIds && !assignedProjectIds.has(project.id)) {
      reply.code(403);
      return buildProjectScopeError("This project is outside the current assigned project scope");
    }

    if (project.status !== "active") {
      reply.code(400);
      return {
        error: {
          message: "Cannot create an environment under an archived project",
        },
      };
    }

    const environment = await createEnvironment(context.db, input);

    await appendRequestAuditLog(context.db, request, {
      workspaceId: environment.workspaceId,
      projectId: environment.projectId,
      environmentId: environment.id,
      action: "environment.created",
      subjectType: "environment",
      subjectId: environment.id,
      payload: environment,
    });

    reply.code(201);
    return environment;
  });

  app.patch("/v1/environments/:environmentId", async (request, reply) => {
    const params = request.params as { environmentId: string };
    const input = UpdateEnvironmentInputSchema.parse(request.body);
    const environment = await requireEnvironment(context.db, reply, params.environmentId);
    if ("error" in environment) {
      return environment;
    }

    const access = await getWorkspaceAccess(
      context,
      request,
      reply,
      "environment.write",
      environment.workspaceId,
    );
    if ("error" in access) {
      return access;
    }

    const assignedProjectIds = await getAssignedProjectIdSet(context, access);
    if (assignedProjectIds && !assignedProjectIds.has(environment.projectId)) {
      reply.code(403);
      return buildProjectScopeError("This environment is outside the current assigned project scope");
    }

    if (input.projectId) {
      const targetProject = await requireProjectInWorkspace(context.db, reply, input.projectId, environment.workspaceId);
      if ("error" in targetProject) {
        return targetProject;
      }

      if (assignedProjectIds && !assignedProjectIds.has(targetProject.id)) {
        reply.code(403);
        return buildProjectScopeError("Cannot move an environment into a project outside the current scope");
      }

      if (targetProject.status !== "active") {
        reply.code(400);
        return {
          error: {
            message: "Cannot move an environment into an archived project",
          },
        };
      }
    }

    const updatedEnvironment = await updateEnvironment(context.db, environment.id, input);
    if (!updatedEnvironment) {
      reply.code(404);
      return {
        error: {
          message: "Environment not found",
        },
      };
    }

    await appendRequestAuditLog(context.db, request, {
      workspaceId: updatedEnvironment.workspaceId,
      projectId: updatedEnvironment.projectId,
      environmentId: updatedEnvironment.id,
      action: "environment.updated",
      subjectType: "environment",
      subjectId: updatedEnvironment.id,
      payload: input,
    });

    return updatedEnvironment;
  });

  app.delete("/v1/environments/:environmentId", async (request, reply) => {
    const params = request.params as { environmentId: string };
    const environment = await requireEnvironment(context.db, reply, params.environmentId);
    if ("error" in environment) {
      return environment;
    }

    const access = await getWorkspaceAccess(
      context,
      request,
      reply,
      "environment.write",
      environment.workspaceId,
    );
    if ("error" in access) {
      return access;
    }

    const assignedProjectIds = await getAssignedProjectIdSet(context, access);
    if (assignedProjectIds && !assignedProjectIds.has(environment.projectId)) {
      reply.code(403);
      return buildProjectScopeError("This environment is outside the current assigned project scope");
    }

    const archivedEnvironment = await updateEnvironment(context.db, environment.id, {
      status: "archived",
    });

    if (!archivedEnvironment) {
      reply.code(404);
      return {
        error: {
          message: "Environment not found",
        },
      };
    }

    await appendRequestAuditLog(context.db, request, {
      workspaceId: archivedEnvironment.workspaceId,
      projectId: archivedEnvironment.projectId,
      environmentId: archivedEnvironment.id,
      action: "environment.archived",
      subjectType: "environment",
      subjectId: archivedEnvironment.id,
      payload: {
        previousStatus: environment.status,
        nextStatus: archivedEnvironment.status,
      },
    });

    reply.code(204);
    return null;
  });
}
