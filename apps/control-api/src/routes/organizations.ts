import type { FastifyInstance } from "fastify";

import {
  CreateOrganizationInputSchema,
  IdentityProviderSchema,
  UpdateOrganizationInputSchema,
  UpsertIdentityProviderInputSchema,
} from "@teamops/contracts";
import {
  createOrganization,
  deleteOrganization,
  getIdentityProviderByOrganizationId,
  listOrganizations,
  listOrganizationSummaries,
  listOrganizationSummariesByMemberEmail,
  listOrganizationsByMemberEmail,
  upsertIdentityProvider,
  updateOrganization,
} from "@teamops/database";

import { appendRequestAuditLog } from "../audit.js";
import type { ControlApiContext } from "../context.js";
import { hasAdminAccess, requireAdminAccess, requireOrganizationOwnerAccess } from "../permissions.js";
import { getRequestScopedEmail } from "../request-auth.js";
import { requireOrganization } from "../resource-guards.js";

export async function registerOrganizationRoutes(app: FastifyInstance, context: ControlApiContext) {
  app.get("/v1/organizations", async (request, reply) => {
    const query = request.query as { includeWorkspaceCounts?: string | boolean };
    const includeWorkspaceCounts =
      query.includeWorkspaceCounts === true ||
      query.includeWorkspaceCounts === "true" ||
      query.includeWorkspaceCounts === "1";

    if (hasAdminAccess(context, request)) {
      return {
        items: includeWorkspaceCounts
          ? await listOrganizationSummaries(context.db)
          : await listOrganizations(context.db),
      };
    }

    const memberEmail = await getRequestScopedEmail(context, request);
    if (!memberEmail) {
      reply.code(401);
      return {
        error: {
          code: "AUTH_REQUIRED",
          message: "Authentication is required for this route",
        },
      };
    }

    return {
      items: includeWorkspaceCounts
        ? await listOrganizationSummariesByMemberEmail(context.db, memberEmail)
        : await listOrganizationsByMemberEmail(context.db, memberEmail),
    };
  });

  app.post("/v1/organizations", async (request, reply) => {
    const permissionError = requireAdminAccess(context, request, reply);
    if (permissionError) {
      return permissionError;
    }

    const input = CreateOrganizationInputSchema.parse(request.body);
    const organization = await createOrganization(context.db, input);

    await appendRequestAuditLog(context.db, request, {
      workspaceId: null,
      action: "organization.created",
      subjectType: "organization",
      subjectId: organization.id,
      payload: organization,
    });

    reply.code(201);
    return organization;
  });

  app.patch("/v1/organizations/:organizationId", async (request, reply) => {
    const params = request.params as { organizationId: string };
    const organization = await requireOrganization(context.db, reply, params.organizationId);
    if ("error" in organization) {
      return organization;
    }

    const permissionError = await requireOrganizationOwnerAccess(
      context,
      request,
      reply,
      organization.id,
    );
    if (permissionError) {
      return permissionError;
    }

    const input = UpdateOrganizationInputSchema.parse(request.body);

    const updatedOrganization = await updateOrganization(context.db, organization.id, input);
    if (!updatedOrganization) {
      reply.code(404);
      return {
        error: {
          message: "Organization not found",
        },
      };
    }

    await appendRequestAuditLog(context.db, request, {
      workspaceId: null,
      action: "organization.updated",
      subjectType: "organization",
      subjectId: updatedOrganization.id,
      payload: input,
    });

    return updatedOrganization;
  });

  app.delete("/v1/organizations/:organizationId", async (request, reply) => {
    const permissionError = requireAdminAccess(context, request, reply);
    if (permissionError) {
      return permissionError;
    }

    const params = request.params as { organizationId: string };
    const organization = await requireOrganization(context.db, reply, params.organizationId);
    if ("error" in organization) {
      return organization;
    }

    const removedOrganization = await deleteOrganization(context.db, organization.id);
    if (!removedOrganization) {
      reply.code(404);
      return {
        error: {
          message: "Organization not found",
        },
      };
    }

    await appendRequestAuditLog(context.db, request, {
      workspaceId: null,
      action: "organization.deleted",
      subjectType: "organization",
      subjectId: removedOrganization.id,
      payload: removedOrganization,
    });

    reply.code(204);
    return null;
  });

  app.get("/v1/organizations/:organizationId/identity-provider", async (request, reply) => {
    const params = request.params as { organizationId: string };
    const organization = await requireOrganization(context.db, reply, params.organizationId);
    if ("error" in organization) {
      return organization;
    }

    const permissionError = await requireOrganizationOwnerAccess(
      context,
      request,
      reply,
      organization.id,
    );
    if (permissionError) {
      return permissionError;
    }

    const identityProvider = await getIdentityProviderByOrganizationId(context.db, organization.id);
    if (!identityProvider) {
      reply.code(404);
      return {
        error: {
          message: "Identity provider not found",
        },
      };
    }

    return IdentityProviderSchema.parse(identityProvider);
  });

  app.put("/v1/organizations/:organizationId/identity-provider", async (request, reply) => {
    const params = request.params as { organizationId: string };
    const organization = await requireOrganization(context.db, reply, params.organizationId);
    if ("error" in organization) {
      return organization;
    }

    const permissionError = await requireOrganizationOwnerAccess(
      context,
      request,
      reply,
      organization.id,
    );
    if (permissionError) {
      return permissionError;
    }

    const input = UpsertIdentityProviderInputSchema.parse(request.body);
    const identityProvider = await upsertIdentityProvider(
      context.db,
      organization.id,
      input,
      context.env.ENCRYPTION_KEY_BASE64,
    );

    await appendRequestAuditLog(context.db, request, {
      workspaceId: null,
      action: "auth.provider-configured",
      subjectType: "organization",
      subjectId: organization.id,
      payload: {
        providerType: identityProvider.providerType,
        issuer: identityProvider.issuer,
        status: identityProvider.status,
      },
    });

    return IdentityProviderSchema.parse(identityProvider);
  });
}
