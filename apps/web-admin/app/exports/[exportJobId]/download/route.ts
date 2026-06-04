import { type NextRequest } from "next/server";

import { buildControlApiHeaders, getControlApiBaseUrl } from "../../../lib/control-api";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    exportJobId: string;
  }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  const { exportJobId } = await context.params;
  const upstreamResponse = await fetch(`${getControlApiBaseUrl()}/v1/export-jobs/${exportJobId}/download`, {
    headers: await buildControlApiHeaders(),
    cache: "no-store",
  });

  if (!upstreamResponse.ok) {
    const errorBody = await upstreamResponse.text();
    return new Response(errorBody, {
      status: upstreamResponse.status,
      headers: {
        "content-type": upstreamResponse.headers.get("content-type") ?? "text/plain; charset=utf-8",
      },
    });
  }

  const responseHeaders = new Headers();
  const contentType = upstreamResponse.headers.get("content-type");
  const contentDisposition = upstreamResponse.headers.get("content-disposition");
  const contentLength = upstreamResponse.headers.get("content-length");
  const approvalMode = upstreamResponse.headers.get("x-teamops-report-approval-mode");
  const approvalStatus = upstreamResponse.headers.get("x-teamops-report-approval-status");
  const watermarkLabel = upstreamResponse.headers.get("x-teamops-report-watermark");
  const retentionDays = upstreamResponse.headers.get("x-teamops-report-retention-days");
  const signedSnapshot = upstreamResponse.headers.get("x-teamops-report-signed-snapshot");
  const evidenceBundleId =
    upstreamResponse.headers.get("x-teamops-attestation-bundle-id") ??
    upstreamResponse.headers.get("x-teamops-evidence-bundle-id");
  const evidenceBundleSha256 =
    upstreamResponse.headers.get("x-teamops-attestation-bundle-sha256") ??
    upstreamResponse.headers.get("x-teamops-evidence-bundle-sha256");
  const evidenceRootHash = upstreamResponse.headers.get("x-teamops-evidence-root-hash");
  const fingerprintId =
    upstreamResponse.headers.get("x-teamops-lineage-id") ??
    upstreamResponse.headers.get("x-teamops-fingerprint-id");
  const deploymentId = upstreamResponse.headers.get("x-teamops-deployment-id");
  const releaseId = upstreamResponse.headers.get("x-teamops-release-id");
  const signingKeyId = upstreamResponse.headers.get("x-teamops-signing-key-id");

  if (contentType) {
    responseHeaders.set("content-type", contentType);
  }

  if (contentDisposition) {
    responseHeaders.set("content-disposition", contentDisposition);
  }

  if (contentLength) {
    responseHeaders.set("content-length", contentLength);
  }
  if (approvalMode) {
    responseHeaders.set("x-teamops-report-approval-mode", approvalMode);
  }
  if (approvalStatus) {
    responseHeaders.set("x-teamops-report-approval-status", approvalStatus);
  }
  if (watermarkLabel) {
    responseHeaders.set("x-teamops-report-watermark", watermarkLabel);
  }
  if (retentionDays) {
    responseHeaders.set("x-teamops-report-retention-days", retentionDays);
  }
  if (signedSnapshot) {
    responseHeaders.set("x-teamops-report-signed-snapshot", signedSnapshot);
  }
  if (evidenceBundleId) {
    responseHeaders.set("x-teamops-evidence-bundle-id", evidenceBundleId);
    responseHeaders.set("x-teamops-attestation-bundle-id", evidenceBundleId);
  }
  if (evidenceBundleSha256) {
    responseHeaders.set("x-teamops-evidence-bundle-sha256", evidenceBundleSha256);
    responseHeaders.set("x-teamops-attestation-bundle-sha256", evidenceBundleSha256);
  }
  if (evidenceRootHash) {
    responseHeaders.set("x-teamops-evidence-root-hash", evidenceRootHash);
  }
  if (fingerprintId) {
    responseHeaders.set("x-teamops-fingerprint-id", fingerprintId);
    responseHeaders.set("x-teamops-lineage-id", fingerprintId);
  }
  if (deploymentId) {
    responseHeaders.set("x-teamops-deployment-id", deploymentId);
  }
  if (releaseId) {
    responseHeaders.set("x-teamops-release-id", releaseId);
  }
  if (signingKeyId) {
    responseHeaders.set("x-teamops-signing-key-id", signingKeyId);
  }

  responseHeaders.set("cache-control", "no-store");

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: responseHeaders,
  });
}
