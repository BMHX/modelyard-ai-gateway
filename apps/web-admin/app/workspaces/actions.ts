"use server";

import { redirect } from "next/navigation";

import { buildActionRedirectPath } from "../lib/action-redirect";
import { createWorkspace, deleteWorkspace, revalidateWorkspaceOptionsCache, updateWorkspace } from "../lib/control-api";
import { getUserErrorMessage } from "../lib/user-facing-error";

function getErrorMessage(error: unknown) {
  return getUserErrorMessage(error, "Can't save this workspace right now.");
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

function getStringList(formData: FormData, key: string) {
  return formData
    .getAll(key)
    .flatMap((value) => (typeof value === "string" ? [value.trim()] : []))
    .filter(Boolean);
}

function pluralizeWorkspaces(count: number) {
  return count === 1 ? "workspace" : "workspaces";
}

function withHash(path: string | undefined, hash: string | null) {
  if (!path || !hash) {
    return path;
  }

  const url = new URL(path, "http://localhost");
  url.hash = hash.startsWith("#") ? hash : `#${hash}`;
  return `${url.pathname}${url.search}${url.hash}`;
}

function buildWorkspacesRedirect(
  organizationId: string,
  requestedPath?: string,
  options?: {
    focusWorkspaceId?: string;
    anchor?: string;
  },
) {
  const hash =
    options?.focusWorkspaceId ? `workspace-${options.focusWorkspaceId}`
    : options?.anchor ?? null;

  return buildActionRedirectPath(
    `/workspaces?organizationId=${encodeURIComponent(organizationId)}${hash ? `#${hash}` : ""}`,
    withHash(requestedPath, hash),
    {
      focusWorkspaceId: options?.focusWorkspaceId,
    },
  );
}

function buildWorkspacesRedirectWithNotice(
  organizationId: string,
  requestedPath?: string,
  options?: {
    notice?: "created" | "updated" | "deleted" | "error";
    message?: string;
    focusWorkspaceId?: string;
    anchor?: string;
  },
) {
  const hash =
    options?.focusWorkspaceId ? `workspace-${options.focusWorkspaceId}`
    : options?.anchor ?? null;

  return buildActionRedirectPath(
    `/workspaces?organizationId=${encodeURIComponent(organizationId)}${hash ? `#${hash}` : ""}`,
    withHash(requestedPath, hash),
    {
      notice: options?.notice,
      message: options?.message,
      focusWorkspaceId: options?.focusWorkspaceId,
    },
  );
}

export async function createWorkspaceAction(formData: FormData) {
  const organizationId = getRequiredString(formData, "organizationId");
  const redirectPath = getOptionalString(formData, "redirectPath");
  let destination = buildWorkspacesRedirect(organizationId, redirectPath);

  try {
    const workspace = await createWorkspace({
      organizationId,
      name: getRequiredString(formData, "name"),
      slug: getOptionalString(formData, "slug"),
    });
    revalidateWorkspaceOptionsCache();

    destination = buildWorkspacesRedirectWithNotice(organizationId, redirectPath, {
      notice: "created",
      message: `Created workspace ${workspace.name}.`,
      focusWorkspaceId: workspace.id,
    });
  } catch (error) {
    destination = buildWorkspacesRedirectWithNotice(organizationId, redirectPath, {
      notice: "error",
      message: getErrorMessage(error),
    });
  }

  redirect(destination);
}

export async function updateWorkspaceAction(formData: FormData) {
  const organizationId = getRequiredString(formData, "organizationId");
  const redirectPath = getOptionalString(formData, "redirectPath");
  let destination = buildWorkspacesRedirect(organizationId, redirectPath);

  try {
    const workspaceId = getRequiredString(formData, "workspaceId");
    const name = getOptionalString(formData, "name");
    const slug = getOptionalString(formData, "slug");

    const input = {
      ...(name !== undefined ? { name } : {}),
      ...(slug !== undefined ? { slug } : {}),
    };

    if (!Object.keys(input).length) {
      throw new Error("Provide a name or slug to update.");
    }

    const workspace = await updateWorkspace(workspaceId, input);
    revalidateWorkspaceOptionsCache();
    destination = buildWorkspacesRedirectWithNotice(organizationId, redirectPath, {
      notice: "updated",
      message: `Updated workspace ${workspace.name}.`,
      focusWorkspaceId: workspace.id,
    });
  } catch (error) {
    destination = buildWorkspacesRedirectWithNotice(organizationId, redirectPath, {
      notice: "error",
      message: getErrorMessage(error),
    });
  }

  redirect(destination);
}

export async function deleteWorkspaceAction(formData: FormData) {
  const organizationId = getRequiredString(formData, "organizationId");
  const redirectPath = getOptionalString(formData, "redirectPath");
  let destination = buildWorkspacesRedirect(organizationId, redirectPath);

  try {
    const workspaceId = getRequiredString(formData, "workspaceId");
    await deleteWorkspace(workspaceId);
    revalidateWorkspaceOptionsCache();

    destination = buildWorkspacesRedirectWithNotice(organizationId, redirectPath, {
      notice: "deleted",
      message: "Deleted workspace.",
      anchor: "workspace-directory",
    });
  } catch (error) {
    destination = buildWorkspacesRedirectWithNotice(organizationId, redirectPath, {
      notice: "error",
      message: getErrorMessage(error),
    });
  }

  redirect(destination);
}

export async function bulkDeleteWorkspacesAction(formData: FormData) {
  const organizationId = getRequiredString(formData, "organizationId");
  const redirectPath = getOptionalString(formData, "redirectPath");
  let destination = buildWorkspacesRedirect(organizationId, redirectPath);

  try {
    const workspaceIds = [...new Set(getStringList(formData, "workspaceIds"))];

    if (!workspaceIds.length) {
      throw new Error("Select at least one workspace.");
    }

    const results = await Promise.allSettled(workspaceIds.map((workspaceId) => deleteWorkspace(workspaceId)));
    const deletedCount = results.filter((result) => result.status === "fulfilled").length;
    const failureCount = results.length - deletedCount;

    if (!deletedCount) {
      const firstFailure = results.find((result) => result.status === "rejected");
      throw (firstFailure?.status === "rejected" ? firstFailure.reason : new Error("Unable to delete the selected workspaces."));
    }

    revalidateWorkspaceOptionsCache();

    destination = buildWorkspacesRedirectWithNotice(organizationId, redirectPath, {
      notice: failureCount ? "error" : "deleted",
      message: failureCount
        ? `Deleted ${deletedCount} ${pluralizeWorkspaces(deletedCount)}; ${failureCount} ${pluralizeWorkspaces(failureCount)} still need review.`
        : `Deleted ${deletedCount} ${pluralizeWorkspaces(deletedCount)}.`,
      anchor: "workspace-directory",
    });
  } catch (error) {
    destination = buildWorkspacesRedirectWithNotice(organizationId, redirectPath, {
      notice: "error",
      message: getErrorMessage(error),
    });
  }

  redirect(destination);
}
