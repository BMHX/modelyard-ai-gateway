import type { FastifyReply } from "fastify";

import {
  findAlertById,
  findBudgetPolicyById,
  findEnvironmentById,
  findMemberById,
  findOrganizationById,
  findProjectById,
  findProviderConnectionById,
  findVirtualKeyById,
  findWorkspaceById,
  type Database,
} from "@teamops/database";

import { sendApiError } from "./api-error.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ResourceGuardError = {
  error: {
    code: string;
    message: string;
    resource?: string;
  };
};

export function isUuidLike(value: string) {
  return uuidPattern.test(value);
}

function invalidResourceId(reply: FastifyReply, resourceLabel: string): ResourceGuardError {
  return sendApiError(reply, {
    statusCode: 400,
    code: "INVALID_UUID",
    resource: resourceLabel,
    message: `Invalid ${resourceLabel} id`,
  });
}

export function validateResourceId(
  reply: FastifyReply,
  resourceLabel: string,
  resourceId: string,
): ResourceGuardError | null {
  return isUuidLike(resourceId) ? null : invalidResourceId(reply, resourceLabel);
}

export async function requireOrganization(db: Database, reply: FastifyReply, organizationId: string) {
  const validationError = validateResourceId(reply, "organization", organizationId);
  if (validationError) {
    return validationError;
  }

  const organization = await findOrganizationById(db, organizationId);
  if (organization) {
    return organization;
  }

  return sendApiError(reply, {
    statusCode: 404,
    code: "RESOURCE_NOT_FOUND",
    resource: "organization",
    message: "Organization not found",
  });
}

export async function requireWorkspace(db: Database, reply: FastifyReply, workspaceId: string) {
  const validationError = validateResourceId(reply, "workspace", workspaceId);
  if (validationError) {
    return validationError;
  }

  const workspace = await findWorkspaceById(db, workspaceId);
  if (workspace) {
    return workspace;
  }

  return sendApiError(reply, {
    statusCode: 404,
    code: "RESOURCE_NOT_FOUND",
    resource: "workspace",
    message: "Workspace not found",
  });
}

export async function requireProject(db: Database, reply: FastifyReply, projectId: string) {
  const validationError = validateResourceId(reply, "project", projectId);
  if (validationError) {
    return validationError;
  }

  const project = await findProjectById(db, projectId);
  if (project) {
    return project;
  }

  return sendApiError(reply, {
    statusCode: 404,
    code: "RESOURCE_NOT_FOUND",
    resource: "project",
    message: "Project not found",
  });
}

export async function requireProjectInWorkspace(
  db: Database,
  reply: FastifyReply,
  projectId: string,
  workspaceId: string,
) {
  const projectIdValidationError = validateResourceId(reply, "project", projectId);
  if (projectIdValidationError) {
    return projectIdValidationError;
  }

  const workspaceIdValidationError = validateResourceId(reply, "workspace", workspaceId);
  if (workspaceIdValidationError) {
    return workspaceIdValidationError;
  }

  const project = await findProjectById(db, projectId);
  if (!project) {
    return sendApiError(reply, {
      statusCode: 404,
      code: "RESOURCE_NOT_FOUND",
      resource: "project",
      message: "Project not found",
    });
  }

  if (project.workspaceId !== workspaceId) {
    return sendApiError(reply, {
      statusCode: 400,
      code: "RESOURCE_SCOPE_FORBIDDEN",
      resource: "project",
      message: "Project does not belong to the requested workspace",
    });
  }

  return project;
}

export async function requireEnvironment(db: Database, reply: FastifyReply, environmentId: string) {
  const validationError = validateResourceId(reply, "environment", environmentId);
  if (validationError) {
    return validationError;
  }

  const environment = await findEnvironmentById(db, environmentId);
  if (environment) {
    return environment;
  }

  return sendApiError(reply, {
    statusCode: 404,
    code: "RESOURCE_NOT_FOUND",
    resource: "environment",
    message: "Environment not found",
  });
}

export async function requireEnvironmentInWorkspace(
  db: Database,
  reply: FastifyReply,
  environmentId: string,
  workspaceId: string,
) {
  const environmentIdValidationError = validateResourceId(reply, "environment", environmentId);
  if (environmentIdValidationError) {
    return environmentIdValidationError;
  }

  const workspaceIdValidationError = validateResourceId(reply, "workspace", workspaceId);
  if (workspaceIdValidationError) {
    return workspaceIdValidationError;
  }

  const environment = await findEnvironmentById(db, environmentId);
  if (!environment) {
    return sendApiError(reply, {
      statusCode: 404,
      code: "RESOURCE_NOT_FOUND",
      resource: "environment",
      message: "Environment not found",
    });
  }

  if (environment.workspaceId !== workspaceId) {
    return sendApiError(reply, {
      statusCode: 400,
      code: "RESOURCE_SCOPE_FORBIDDEN",
      resource: "environment",
      message: "Environment does not belong to the requested workspace",
    });
  }

  return environment;
}

export async function requireBudgetPolicy(db: Database, reply: FastifyReply, budgetPolicyId: string) {
  const validationError = validateResourceId(reply, "budget policy", budgetPolicyId);
  if (validationError) {
    return validationError;
  }

  const budgetPolicy = await findBudgetPolicyById(db, budgetPolicyId);
  if (budgetPolicy) {
    return budgetPolicy;
  }

  return sendApiError(reply, {
    statusCode: 404,
    code: "RESOURCE_NOT_FOUND",
    resource: "budget_policy",
    message: "Budget policy not found",
  });
}

export async function requireAlert(db: Database, reply: FastifyReply, alertId: string) {
  const validationError = validateResourceId(reply, "alert", alertId);
  if (validationError) {
    return validationError;
  }

  const alert = await findAlertById(db, alertId);
  if (alert) {
    return alert;
  }

  return sendApiError(reply, {
    statusCode: 404,
    code: "RESOURCE_NOT_FOUND",
    resource: "alert",
    message: "Alert not found",
  });
}

export async function requireVirtualKey(db: Database, reply: FastifyReply, virtualKeyId: string) {
  const validationError = validateResourceId(reply, "virtual key", virtualKeyId);
  if (validationError) {
    return validationError;
  }

  const virtualKey = await findVirtualKeyById(db, virtualKeyId);
  if (virtualKey) {
    return virtualKey;
  }

  return sendApiError(reply, {
    statusCode: 404,
    code: "RESOURCE_NOT_FOUND",
    resource: "virtual_key",
    message: "Virtual key not found",
  });
}

export async function requireProviderConnection(db: Database, reply: FastifyReply, providerConnectionId: string) {
  const validationError = validateResourceId(reply, "provider connection", providerConnectionId);
  if (validationError) {
    return validationError;
  }

  const providerConnection = await findProviderConnectionById(db, providerConnectionId);
  if (providerConnection) {
    return providerConnection;
  }

  return sendApiError(reply, {
    statusCode: 404,
    code: "RESOURCE_NOT_FOUND",
    resource: "provider_connection",
    message: "Provider connection not found",
  });
}

export async function requireProviderConnectionInWorkspace(
  db: Database,
  reply: FastifyReply,
  providerConnectionId: string,
  workspaceId: string,
) {
  const providerConnectionIdValidationError = validateResourceId(reply, "provider connection", providerConnectionId);
  if (providerConnectionIdValidationError) {
    return providerConnectionIdValidationError;
  }

  const workspaceIdValidationError = validateResourceId(reply, "workspace", workspaceId);
  if (workspaceIdValidationError) {
    return workspaceIdValidationError;
  }

  const providerConnection = await findProviderConnectionById(db, providerConnectionId);
  if (!providerConnection) {
    return sendApiError(reply, {
      statusCode: 404,
      code: "RESOURCE_NOT_FOUND",
      resource: "provider_connection",
      message: "Provider connection not found",
    });
  }

  if (!providerConnection.organizationId) {
    if (providerConnection.workspaceId === workspaceId) {
      return providerConnection;
    }

    const [providerWorkspace, requestedWorkspace] = await Promise.all([
      findWorkspaceById(db, providerConnection.workspaceId),
      findWorkspaceById(db, workspaceId),
    ]);

    if (!providerWorkspace || !requestedWorkspace) {
      return sendApiError(reply, {
        statusCode: 404,
        code: "RESOURCE_NOT_FOUND",
        resource: "workspace",
        message: "Workspace not found",
      });
    }

    if (providerWorkspace.organizationId !== requestedWorkspace.organizationId) {
      return sendApiError(reply, {
        statusCode: 400,
        code: "RESOURCE_SCOPE_FORBIDDEN",
        resource: "provider_connection",
        message: "Provider connection does not belong to the requested organization",
      });
    }

    return providerConnection;
  }

  const workspace = await findWorkspaceById(db, workspaceId);
  if (!workspace) {
    return sendApiError(reply, {
      statusCode: 404,
      code: "RESOURCE_NOT_FOUND",
      resource: "workspace",
      message: "Workspace not found",
    });
  }

  if (providerConnection.organizationId !== workspace.organizationId) {
    return sendApiError(reply, {
      statusCode: 400,
      code: "RESOURCE_SCOPE_FORBIDDEN",
      resource: "provider_connection",
      message: "Provider connection does not belong to the requested organization",
    });
  }

  return providerConnection;
}

export async function requireMember(db: Database, reply: FastifyReply, memberId: string) {
  const validationError = validateResourceId(reply, "member", memberId);
  if (validationError) {
    return validationError;
  }

  const member = await findMemberById(db, memberId);
  if (member) {
    return member;
  }

  return sendApiError(reply, {
    statusCode: 404,
    code: "RESOURCE_NOT_FOUND",
    resource: "member",
    message: "Member not found",
  });
}
