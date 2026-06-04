import type { FastifyInstance } from "fastify";

import { AlertQuerySchema, UpdateAlertInputSchema, type Alert } from "@teamops/contracts";
import { findEnvironmentById, listAlerts, updateAlert } from "@teamops/database";

import { appendRequestAuditLog } from "../audit.js";
import type { ControlApiContext } from "../context.js";
import { getWorkspaceAccess } from "../permissions.js";
import { getAssignedProjectIdSet } from "../project-scope.js";
import { requireAlert } from "../resource-guards.js";

async function resolveAlertProjectId(context: ControlApiContext, alert: Alert) {
  const metadata = alert.metadata;
  const projectId = typeof metadata.projectId === "string" ? metadata.projectId : null;
  if (projectId) {
    return projectId;
  }

  const environmentId = typeof metadata.environmentId === "string" ? metadata.environmentId : null;
  if (!environmentId) {
    return null;
  }

  const environment = await findEnvironmentById(context.db, environmentId);
  return environment?.projectId ?? null;
}

async function isAlertVisibleToAssignedProjects(
  context: ControlApiContext,
  alert: Alert,
  assignedProjectIds: Set<string> | null,
) {
  if (!assignedProjectIds) {
    return true;
  }

  const projectId = await resolveAlertProjectId(context, alert);
  return projectId ? assignedProjectIds.has(projectId) : false;
}

export async function registerAlertRoutes(app: FastifyInstance, context: ControlApiContext) {
  app.get("/v1/alerts", async (request, reply) => {
    const query = AlertQuerySchema.parse(request.query);
    if (!query.workspaceId) {
      return { items: [] };
    }

    const access = await getWorkspaceAccess(context, request, reply, "alert.read", query.workspaceId);
    if ("error" in access) {
      return access;
    }

    const items = await listAlerts(context.db, query);
    const assignedProjectIds = await getAssignedProjectIdSet(context, access);
    if (assignedProjectIds) {
      const visibleItems = await Promise.all(
        items.map(async (alert) => ({
          alert,
          visible: await isAlertVisibleToAssignedProjects(context, alert, assignedProjectIds),
        })),
      );

      return {
        items: visibleItems.filter((entry) => entry.visible).map((entry) => entry.alert),
      };
    }

    return {
      items,
    };
  });

  app.get("/v1/alerts/:alertId", async (request, reply) => {
    const params = request.params as { alertId: string };
    const alert = await requireAlert(context.db, reply, params.alertId);
    if ("error" in alert) {
      return alert;
    }

    const access = await getWorkspaceAccess(context, request, reply, "alert.read", alert.workspaceId);
    if ("error" in access) {
      return access;
    }

    const assignedProjectIds = await getAssignedProjectIdSet(context, access);
    if (!(await isAlertVisibleToAssignedProjects(context, alert, assignedProjectIds))) {
      reply.code(403);
      return {
        error: {
          message: "You do not have access to view this alert",
        },
      };
    }

    return alert;
  });

  app.patch("/v1/alerts/:alertId", async (request, reply) => {
    const params = request.params as { alertId: string };
    const input = UpdateAlertInputSchema.parse(request.body);
    const alert = await requireAlert(context.db, reply, params.alertId);
    if ("error" in alert) {
      return alert;
    }

    const access = await getWorkspaceAccess(context, request, reply, "alert.write", alert.workspaceId);
    if ("error" in access) {
      return access;
    }

    const assignedProjectIds = await getAssignedProjectIdSet(context, access);
    if (!(await isAlertVisibleToAssignedProjects(context, alert, assignedProjectIds))) {
      reply.code(403);
      return {
        error: {
          message: "You do not have access to update this alert",
        },
      };
    }

    const updatedAlert = await updateAlert(context.db, alert.id, input);
    if (!updatedAlert) {
      reply.code(404);
      return {
        error: {
          message: "Alert not found",
        },
      };
    }

    await appendRequestAuditLog(context.db, request, {
      workspaceId: updatedAlert.workspaceId,
      projectId:
        typeof updatedAlert.metadata.projectId === "string" ? updatedAlert.metadata.projectId : null,
      environmentId:
        typeof updatedAlert.metadata.environmentId === "string" ? updatedAlert.metadata.environmentId : null,
      action:
        input.status && input.status !== alert.status
          ? updatedAlert.status === "resolved"
            ? "alert.resolved"
            : "alert.reopened"
          : input.metadataPatch
            ? "alert.collaboration_updated"
            : "alert.updated",
      subjectType: "alert",
      subjectId: updatedAlert.id,
      payload: {
        previousStatus: alert.status,
        nextStatus: updatedAlert.status,
        code: updatedAlert.code,
        severity: updatedAlert.severity,
        updatedMetadataKeys: input.metadataPatch ? Object.keys(input.metadataPatch).sort() : [],
      },
    });

    return updatedAlert;
  });
}
