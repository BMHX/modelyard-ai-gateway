"use server";

import { redirect } from "next/navigation";

import { buildActionRedirectPath } from "../lib/action-redirect";
import {
  getLineageBuildDescriptor,
  issueLineage,
  revokeLineage,
  rotateLineageKeyVersion,
  verifyLineageArtifacts,
} from "../lib/control-api";
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
    return undefined;
  }

  const value = rawValue.trim();
  return value || undefined;
}

function getNullableString(formData: FormData, key: string) {
  const rawValue = formData.get(key);
  if (typeof rawValue !== "string") {
    return null;
  }

  const value = rawValue.trim();
  return value || null;
}

function parseJsonField<T>(value: string | undefined, fallback: T): T {
  if (!value) {
    return fallback;
  }

  return JSON.parse(value) as T;
}

function buildLineageRedirect(
  requestedPath: string | undefined,
  params?: Record<string, string | undefined>,
) {
  return buildActionRedirectPath("/release-lineage", requestedPath, params);
}

export async function issueLineageAction(formData: FormData) {
  const redirectPath = getOptionalString(formData, "redirectPath");

  try {
    const organizationId = getRequiredString(formData, "organizationId");
    const issued = await issueLineage(organizationId, {
      deploymentId: getOptionalString(formData, "deploymentId"),
      deploymentName: getRequiredString(formData, "deploymentName"),
      deploymentMode:
        getRequiredString(formData, "deploymentMode") === "cloud"
          ? "cloud"
          : getRequiredString(formData, "deploymentMode") === "hybrid"
            ? "hybrid"
            : "self_host_preview",
      region: getNullableString(formData, "region"),
      installChannel: getNullableString(formData, "installChannel"),
      releaseId: getOptionalString(formData, "releaseId"),
      channel: getRequiredString(formData, "channel"),
      version: getRequiredString(formData, "version"),
      gitCommitSha: getNullableString(formData, "gitCommitSha"),
      buildSystem: getNullableString(formData, "buildSystem"),
      artifactManifest: parseJsonField(getOptionalString(formData, "artifactManifestJson"), {}),
      artifacts: parseJsonField(getOptionalString(formData, "artifactsJson"), []),
      metadata: parseJsonField(getOptionalString(formData, "metadataJson"), {}),
    });

    redirect(
      buildLineageRedirect(redirectPath, {
        notice: "created",
        message: `Issued release lineage ${issued.lineageId}.`,
        lineageId: issued.lineageId,
        selectedLineageId: issued.lineageId,
      }),
    );
  } catch (error) {
    redirect(
      buildLineageRedirect(redirectPath, {
        notice: "error",
        message: getUserErrorMessage(error, "Can't issue release lineage right now."),
      }),
    );
  }
}

export async function rotateLineageKeyVersionAction(formData: FormData) {
  const redirectPath = getOptionalString(formData, "redirectPath");

  try {
    const rotated = await rotateLineageKeyVersion({
      purpose:
        getRequiredString(formData, "purpose") === "evidence_signing"
          ? "evidence_signing"
          : "fingerprint_hmac",
    });

    redirect(
      buildLineageRedirect(redirectPath, {
        notice: "updated",
        message: `Activated ${rotated.keyId} for ${rotated.purpose}.`,
      }),
    );
  } catch (error) {
    redirect(
      buildLineageRedirect(redirectPath, {
        notice: "error",
        message: getUserErrorMessage(error, "Can't rotate lineage key right now."),
      }),
    );
  }
}

export async function revokeLineageAction(formData: FormData) {
  const redirectPath = getOptionalString(formData, "redirectPath");
  const lineageId = getRequiredString(formData, "lineageId");

  try {
    await revokeLineage(lineageId, {
      reason: getRequiredString(formData, "reason"),
    });

    redirect(
      buildLineageRedirect(redirectPath, {
        notice: "updated",
        message: `Revoked release lineage ${lineageId}.`,
        lineageId,
        selectedLineageId: lineageId,
      }),
    );
  } catch (error) {
    redirect(
      buildLineageRedirect(redirectPath, {
        notice: "error",
        message: getUserErrorMessage(error, "Can't revoke release lineage right now."),
        lineageId,
        selectedLineageId: lineageId,
      }),
    );
  }
}

export async function verifyLineageArtifactsAction(formData: FormData) {
  const redirectPath = getOptionalString(formData, "redirectPath");
  const lineageId = getRequiredString(formData, "lineageId");

  try {
    await verifyLineageArtifacts(lineageId, {
      extractor: parseJsonField(getOptionalString(formData, "extractorJson"), {
        observedArtifacts: [],
        recoveredLocator: null,
        locatorCandidates: [],
        codewordDigest: null,
        digestCandidates: [],
        familyHitSummary: [],
        matchStatus: "unverifiable",
      }),
    });

    redirect(
      buildLineageRedirect(redirectPath, {
        notice: "updated",
        message: `Verified lineage artifacts for ${lineageId}.`,
        lineageId,
        selectedLineageId: lineageId,
      }),
    );
  } catch (error) {
    redirect(
      buildLineageRedirect(redirectPath, {
        notice: "error",
        message: getUserErrorMessage(error, "Can't verify lineage artifacts right now."),
        lineageId,
        selectedLineageId: lineageId,
      }),
    );
  }
}

export async function refreshBuildDescriptorAction(formData: FormData) {
  const redirectPath = getOptionalString(formData, "redirectPath");
  const lineageId = getRequiredString(formData, "lineageId");

  try {
    await getLineageBuildDescriptor(lineageId);
    redirect(
      buildLineageRedirect(redirectPath, {
        notice: "updated",
        message: `Loaded build descriptor for ${lineageId}.`,
        lineageId,
        selectedLineageId: lineageId,
      }),
    );
  } catch (error) {
    redirect(
      buildLineageRedirect(redirectPath, {
        notice: "error",
        message: getUserErrorMessage(error, "Can't load the build descriptor right now."),
        lineageId,
        selectedLineageId: lineageId,
      }),
    );
  }
}
