"use server";

import { redirect } from "next/navigation";

import { buildActionRedirectPath } from "../lib/action-redirect";
import { createOrganization, deleteOrganization, revalidateWorkspaceOptionsCache, updateOrganization } from "../lib/control-api";
import { getUserErrorMessage } from "../lib/user-facing-error";

function getErrorMessage(error: unknown) {
  return getUserErrorMessage(error, "Can't save this organization right now.");
}

function withHash(path: string | undefined, hash: string | null) {
  if (!path || !hash) {
    return path;
  }

  const url = new URL(path, "http://localhost");
  url.hash = hash.startsWith("#") ? hash : `#${hash}`;
  return `${url.pathname}${url.search}${url.hash}`;
}

function buildOrganizationsRedirect(requestedPath?: string, options?: {
  notice?: "created" | "updated" | "deleted" | "error";
  message?: string;
  focusOrganizationId?: string;
  anchor?: string;
}) {
  const hash =
    options?.focusOrganizationId ? `organization-${options.focusOrganizationId}`
    : options?.anchor ?? null;

  return buildActionRedirectPath(`/organizations${hash ? `#${hash}` : ""}`, withHash(requestedPath, hash), {
    notice: options?.notice,
    message: options?.message,
    focusOrganizationId: options?.focusOrganizationId,
  });
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

export async function createOrganizationAction(formData: FormData) {
  const redirectPath = getOptionalString(formData, "redirectPath");
  let destination = buildOrganizationsRedirect(redirectPath);

  try {
    const organization = await createOrganization({
      name: getRequiredString(formData, "name"),
      slug: getOptionalString(formData, "slug"),
    });
    revalidateWorkspaceOptionsCache();

    destination = buildOrganizationsRedirect(redirectPath, {
      notice: "created",
      message: `Created organization ${organization.name}.`,
      focusOrganizationId: organization.id,
    });
  } catch (error) {
    destination = buildOrganizationsRedirect(redirectPath, {
      notice: "error",
      message: getErrorMessage(error),
    });
  }

  redirect(destination);
}

export type CreateOrganizationMutationActionResult =
  | {
      status: "success";
      message: string;
      organization: Awaited<ReturnType<typeof createOrganization>>;
    }
  | {
      status: "error";
      message: string;
      organization: null;
    };

export async function createOrganizationMutationAction(input: {
  name: string;
  slug?: string | null;
}): Promise<CreateOrganizationMutationActionResult> {
  try {
    const organization = await createOrganization({
      name: input.name.trim(),
      slug: input.slug?.trim() || undefined,
    });

    revalidateWorkspaceOptionsCache();

    return {
      status: "success",
      message: `Created organization ${organization.name}.`,
      organization,
    };
  } catch (error) {
    return {
      status: "error",
      message: getErrorMessage(error),
      organization: null,
    };
  }
}

export async function updateOrganizationAction(formData: FormData) {
  const redirectPath = getOptionalString(formData, "redirectPath");
  let destination = buildOrganizationsRedirect(redirectPath);

  try {
    const organizationId = getRequiredString(formData, "organizationId");
    const name = getOptionalString(formData, "name");
    const slug = getOptionalString(formData, "slug");

    const input = {
      ...(name !== undefined ? { name } : {}),
      ...(slug !== undefined ? { slug } : {}),
    };

    if (!Object.keys(input).length) {
      throw new Error("Provide a name or slug to update.");
    }

    const organization = await updateOrganization(organizationId, input);
    revalidateWorkspaceOptionsCache();
    destination = buildOrganizationsRedirect(redirectPath, {
      notice: "updated",
      message: `Updated organization ${organization.name}.`,
      focusOrganizationId: organization.id,
    });
  } catch (error) {
    destination = buildOrganizationsRedirect(redirectPath, {
      notice: "error",
      message: getErrorMessage(error),
    });
  }

  redirect(destination);
}

export async function deleteOrganizationAction(formData: FormData) {
  const redirectPath = getOptionalString(formData, "redirectPath");
  let destination = buildOrganizationsRedirect(redirectPath);

  try {
    const organizationId = getRequiredString(formData, "organizationId");
    await deleteOrganization(organizationId);
    revalidateWorkspaceOptionsCache();

    destination = buildOrganizationsRedirect(redirectPath, {
      notice: "deleted",
      message: "Deleted organization.",
      anchor: "manage-organizations",
    });
  } catch (error) {
    destination = buildOrganizationsRedirect(redirectPath, {
      notice: "error",
      message: getErrorMessage(error),
    });
  }

  redirect(destination);
}
