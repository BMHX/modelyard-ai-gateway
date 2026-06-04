"use server";

import { redirect } from "next/navigation";

import type { SavedViewSurface } from "@teamops/contracts";

import { buildActionRedirectPath } from "../lib/action-redirect";
import { createSavedView, deleteSavedView, updateSavedView } from "../lib/control-api";
import { getUserErrorMessage } from "../lib/user-facing-error";

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
    return null;
  }

  const value = rawValue.trim();
  return value.length ? value : null;
}

function getSurface(surface: string): SavedViewSurface {
  if (surface === "usage-events" || surface === "audit-logs") {
    return surface;
  }

  throw new Error("surface is required");
}

function getSurfaceFallback(surface: SavedViewSurface, workspaceId: string) {
  if (surface === "audit-logs") {
    return `/audit-logs?workspaceId=${encodeURIComponent(workspaceId)}`;
  }

  return `/usage-events?workspaceId=${encodeURIComponent(workspaceId)}`;
}

function getErrorMessage(error: unknown, fallback: string) {
  return getUserErrorMessage(error, fallback);
}

function parseFiltersJson(value: string, key: string) {
  try {
    const parsed = JSON.parse(value) as unknown;

    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
      throw new Error(`${key} must be a JSON object`);
    }

    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof Error && error.message === `${key} must be a JSON object`) {
      throw error;
    }

    throw new Error(`${key} must be valid JSON`);
  }
}

type SavedViewRedirectState = {
  savedViewId?: string;
  savedViewNotice: "success" | "error";
  savedViewMessage: string;
};

function redirectToSavedViews(
  surface: SavedViewSurface,
  workspaceId: string,
  redirectPath: string | undefined,
  state: SavedViewRedirectState,
) {
  redirect(buildActionRedirectPath(getSurfaceFallback(surface, workspaceId), redirectPath, state));
}

export async function createSavedViewAction(formData: FormData) {
  const workspaceId = getRequiredString(formData, "workspaceId");
  const surface = getSurface(getRequiredString(formData, "surface"));
  const redirectPath = getOptionalString(formData, "redirectPath") ?? undefined;
  const name = getRequiredString(formData, "name");
  const filtersJson = getRequiredString(formData, "filtersJson");

  let redirectState: SavedViewRedirectState;

  try {
    const savedView = await createSavedView({
      workspaceId,
      surface,
      name,
      filters: parseFiltersJson(filtersJson, "filtersJson"),
    });

    redirectState = {
      savedViewId: savedView.id,
      savedViewNotice: "success",
      savedViewMessage: `Saved view "${savedView.name}" is ready.`,
    };
  } catch (error) {
    redirectState = {
      savedViewNotice: "error",
      savedViewMessage: getErrorMessage(error, "Unable to save this view right now."),
    };
  }

  redirectToSavedViews(surface, workspaceId, redirectPath, redirectState);
}

export async function deleteSavedViewAction(formData: FormData) {
  const workspaceId = getRequiredString(formData, "workspaceId");
  const surface = getSurface(getRequiredString(formData, "surface"));
  const redirectPath = getOptionalString(formData, "redirectPath") ?? undefined;
  const savedViewId = getRequiredString(formData, "savedViewId");
  const savedViewName = getOptionalString(formData, "savedViewName");

  let redirectState: SavedViewRedirectState;

  try {
    await deleteSavedView(savedViewId);

    redirectState = {
      savedViewNotice: "success",
      savedViewMessage: savedViewName
        ? `Deleted saved view "${savedViewName}".`
        : "Deleted the saved view.",
    };
  } catch (error) {
    redirectState = {
      savedViewNotice: "error",
      savedViewMessage: getErrorMessage(error, "Unable to delete this saved view right now."),
    };
  }

  redirectToSavedViews(surface, workspaceId, redirectPath, redirectState);
}

export async function updateSavedViewAction(formData: FormData) {
  const workspaceId = getRequiredString(formData, "workspaceId");
  const surface = getSurface(getRequiredString(formData, "surface"));
  const redirectPath = getOptionalString(formData, "redirectPath") ?? undefined;
  const savedViewId = getRequiredString(formData, "savedViewId");
  const name = getRequiredString(formData, "name");
  const filtersJson = getRequiredString(formData, "filtersJson");

  let redirectState: SavedViewRedirectState;

  try {
    const savedView = await updateSavedView(savedViewId, {
      name,
      filters: parseFiltersJson(filtersJson, "filtersJson"),
    });

    redirectState = {
      savedViewId: savedView.id,
      savedViewNotice: "success",
      savedViewMessage: `Updated saved view "${savedView.name}".`,
    };
  } catch (error) {
    redirectState = {
      savedViewId,
      savedViewNotice: "error",
      savedViewMessage: getErrorMessage(error, "Unable to update this saved view right now."),
    };
  }

  redirectToSavedViews(surface, workspaceId, redirectPath, redirectState);
}
