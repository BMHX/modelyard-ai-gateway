"use server";

import { redirect } from "next/navigation";

import { buildActionRedirectPath } from "../lib/action-redirect";
import {
  archiveEnvironment,
  archiveProject,
  createEnvironment,
  createProject,
  updateEnvironment,
  updateProject,
} from "../lib/control-api";
import { getUserErrorMessage } from "../lib/user-facing-error";

function getErrorMessage(error: unknown) {
  return getUserErrorMessage(error, "Can't save this item right now.");
}

function getRequiredString(formData: FormData, key: string) {
  const rawValue = formData.get(key);
  const value = typeof rawValue === "string" ? rawValue.trim() : "";

  if (!value) {
    throw new Error(`${key} is required`);
  }

  return value;
}

function getOptionalString(formData: FormData, key: string) {
  const rawValue = formData.get(key);
  if (typeof rawValue !== "string") {
    return undefined;
  }

  const value = rawValue.trim();
  return value || undefined;
}

function withHash(path: string | undefined, hash: string | null) {
  if (!path || !hash) {
    return path;
  }

  const url = new URL(path, "http://localhost");
  url.hash = hash.startsWith("#") ? hash : `#${hash}`;
  return `${url.pathname}${url.search}${url.hash}`;
}

function buildProjectsRedirect(
  workspaceId: string,
  requestedPath?: string,
  options?: {
    notice?: "created" | "updated" | "archived" | "reactivated" | "error";
    message?: string;
    focusProjectId?: string;
    focusEnvironmentId?: string;
    anchor?: string;
  },
) {
  const hash =
    options?.focusProjectId ? `project-${options.focusProjectId}`
    : options?.focusEnvironmentId ? `environment-${options.focusEnvironmentId}`
    : options?.anchor ?? null;

  return buildActionRedirectPath(
    `/projects?workspaceId=${encodeURIComponent(workspaceId)}${hash ? `#${hash}` : ""}`,
    withHash(requestedPath, hash),
    {
      notice: options?.notice,
      message: options?.message,
      focusProjectId: options?.focusProjectId,
      focusEnvironmentId: options?.focusEnvironmentId,
    },
  );
}

export async function createProjectAction(formData: FormData) {
  const workspaceId = getRequiredString(formData, "workspaceId");
  const redirectPath = getOptionalString(formData, "redirectPath");
  let destination = buildProjectsRedirect(workspaceId, redirectPath);

  try {
    const project = await createProject({
      workspaceId,
      name: getRequiredString(formData, "name"),
      slug: getOptionalString(formData, "slug"),
    });

    destination = buildProjectsRedirect(workspaceId, redirectPath, {
      notice: "created",
      message: "Project created.",
      focusProjectId: project.id,
    });
  } catch (error) {
    destination = buildProjectsRedirect(workspaceId, redirectPath, {
      notice: "error",
      message: getErrorMessage(error),
    });
  }

  redirect(destination);
}

export type CreateProjectMutationActionResult =
  | {
      status: "success";
      message: string;
      project: Awaited<ReturnType<typeof createProject>>;
    }
  | {
      status: "error";
      message: string;
      project: null;
    };

export async function createProjectMutationAction(input: {
  workspaceId: string;
  name: string;
  slug?: string | null;
}): Promise<CreateProjectMutationActionResult> {
  try {
    const project = await createProject({
      workspaceId: input.workspaceId.trim(),
      name: input.name.trim(),
      slug: input.slug?.trim() || undefined,
    });

    return {
      status: "success",
      message: "Project created.",
      project,
    };
  } catch (error) {
    return {
      status: "error",
      message: getErrorMessage(error),
      project: null,
    };
  }
}

export async function updateProjectAction(
  forcedStatus: "active" | "archived" | FormData,
  maybeFormData?: FormData,
) {
  const formData = forcedStatus instanceof FormData ? forcedStatus : maybeFormData;

  if (!formData) {
    throw new Error("formData is required");
  }

  const workspaceId = getRequiredString(formData, "workspaceId");
  const redirectPath = getOptionalString(formData, "redirectPath");
  let destination = buildProjectsRedirect(workspaceId, redirectPath);

  try {
    const projectId = getRequiredString(formData, "projectId");
    const previousStatus = getOptionalString(formData, "previousStatus");
    const nextStatus =
      forcedStatus instanceof FormData
        ? getRequiredString(formData, "status") === "archived" ? "archived" : "active"
        : forcedStatus;
    const project = await updateProject(projectId, {
      name: getRequiredString(formData, "name"),
      slug: getOptionalString(formData, "slug"),
      status: nextStatus,
    });

    destination = buildProjectsRedirect(workspaceId, redirectPath, {
      notice:
        previousStatus === "archived" && nextStatus === "active" ? "reactivated"
        : previousStatus === "active" && nextStatus === "archived" ? "archived"
        : "updated",
      message:
        previousStatus === "archived" && nextStatus === "active" ? "Project reactivated."
        : previousStatus === "active" && nextStatus === "archived" ? "Project archived."
        : "Project updated.",
      focusProjectId: project.id,
    });
  } catch (error) {
    destination = buildProjectsRedirect(workspaceId, redirectPath, {
      notice: "error",
      message: getErrorMessage(error),
    });
  }

  redirect(destination);
}

export async function archiveProjectAction(formData: FormData) {
  const workspaceId = getRequiredString(formData, "workspaceId");
  const redirectPath = getOptionalString(formData, "redirectPath");
  let destination = buildProjectsRedirect(workspaceId, redirectPath);

  try {
    const projectId = getRequiredString(formData, "projectId");
    await archiveProject(projectId);

    destination = buildProjectsRedirect(workspaceId, redirectPath, {
      notice: "archived",
      message: "Project archived.",
      focusProjectId: projectId,
    });
  } catch (error) {
    destination = buildProjectsRedirect(workspaceId, redirectPath, {
      notice: "error",
      message: getErrorMessage(error),
    });
  }

  redirect(destination);
}

export async function createEnvironmentAction(formData: FormData) {
  const workspaceId = getRequiredString(formData, "workspaceId");
  const redirectPath = getOptionalString(formData, "redirectPath");
  let destination = buildProjectsRedirect(workspaceId, redirectPath);

  try {
    const environment = await createEnvironment({
      workspaceId,
      projectId: getRequiredString(formData, "projectId"),
      name: getRequiredString(formData, "name"),
      slug: getOptionalString(formData, "slug"),
      runtime: getRequiredString(formData, "runtime") as "development" | "staging" | "production",
    });

    destination = buildProjectsRedirect(workspaceId, redirectPath, {
      notice: "created",
      message: "Environment created.",
      focusEnvironmentId: environment.id,
    });
  } catch (error) {
    destination = buildProjectsRedirect(workspaceId, redirectPath, {
      notice: "error",
      message: getErrorMessage(error),
    });
  }

  redirect(destination);
}

export type CreateEnvironmentMutationActionResult =
  | {
      status: "success";
      message: string;
      environment: Awaited<ReturnType<typeof createEnvironment>>;
    }
  | {
      status: "error";
      message: string;
      environment: null;
    };

export async function createEnvironmentMutationAction(input: {
  workspaceId: string;
  projectId: string;
  name: string;
  slug?: string | null;
  runtime: "development" | "staging" | "production";
}): Promise<CreateEnvironmentMutationActionResult> {
  try {
    const environment = await createEnvironment({
      workspaceId: input.workspaceId.trim(),
      projectId: input.projectId.trim(),
      name: input.name.trim(),
      slug: input.slug?.trim() || undefined,
      runtime: input.runtime,
    });

    return {
      status: "success",
      message: "Environment created.",
      environment,
    };
  } catch (error) {
    return {
      status: "error",
      message: getErrorMessage(error),
      environment: null,
    };
  }
}

export async function updateEnvironmentAction(
  forcedStatus: "active" | "archived" | FormData,
  maybeFormData?: FormData,
) {
  const formData = forcedStatus instanceof FormData ? forcedStatus : maybeFormData;

  if (!formData) {
    throw new Error("formData is required");
  }

  const workspaceId = getRequiredString(formData, "workspaceId");
  const redirectPath = getOptionalString(formData, "redirectPath");
  let destination = buildProjectsRedirect(workspaceId, redirectPath);

  try {
    const environmentId = getRequiredString(formData, "environmentId");
    const previousStatus = getOptionalString(formData, "previousStatus");
    const nextStatus =
      forcedStatus instanceof FormData
        ? getRequiredString(formData, "status") === "archived" ? "archived" : "active"
        : forcedStatus;
    const environment = await updateEnvironment(environmentId, {
      projectId: getRequiredString(formData, "projectId"),
      name: getRequiredString(formData, "name"),
      slug: getOptionalString(formData, "slug"),
      runtime: getRequiredString(formData, "runtime") as "development" | "staging" | "production",
      status: nextStatus,
    });

    destination = buildProjectsRedirect(workspaceId, redirectPath, {
      notice:
        previousStatus === "archived" && nextStatus === "active" ? "reactivated"
        : previousStatus === "active" && nextStatus === "archived" ? "archived"
        : "updated",
      message:
        previousStatus === "archived" && nextStatus === "active" ? "Environment reactivated."
        : previousStatus === "active" && nextStatus === "archived" ? "Environment archived."
        : "Environment updated.",
      focusEnvironmentId: environment.id,
    });
  } catch (error) {
    destination = buildProjectsRedirect(workspaceId, redirectPath, {
      notice: "error",
      message: getErrorMessage(error),
    });
  }

  redirect(destination);
}

export async function archiveEnvironmentAction(formData: FormData) {
  const workspaceId = getRequiredString(formData, "workspaceId");
  const redirectPath = getOptionalString(formData, "redirectPath");
  let destination = buildProjectsRedirect(workspaceId, redirectPath);

  try {
    const environmentId = getRequiredString(formData, "environmentId");
    await archiveEnvironment(environmentId);

    destination = buildProjectsRedirect(workspaceId, redirectPath, {
      notice: "archived",
      message: "Environment archived.",
      focusEnvironmentId: environmentId,
    });
  } catch (error) {
    destination = buildProjectsRedirect(workspaceId, redirectPath, {
      notice: "error",
      message: getErrorMessage(error),
    });
  }

  redirect(destination);
}
