import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  AttestationBundleSchema,
  BuildDescriptorResponseSchema,
  FingerprintLookupQuerySchema,
  FingerprintKeyVersionListQuerySchema,
  IssueFingerprintInputSchema,
  LineageIssuanceSchema,
  LineageKeyVersionSchema,
  LineageKeyVersionListQuerySchema,
  LineageListResponseSchema,
  LineageLookupQuerySchema,
  IssueLineageInputSchema,
  RevokeFingerprintInputSchema,
  RevokeLineageInputSchema,
  RotateFingerprintKeyVersionInputSchema,
  RotateLineageKeyVersionInputSchema,
  VerifyLineageArtifactsInputSchema,
  VerifyLineageArtifactsResponseSchema,
} from "@teamops/contracts";
import {
  appendEvidenceChainRecord,
  getEvidenceBundleById,
  getLineageBuildDescriptor,
  getFingerprintById,
  issueFingerprint,
  listEvidenceBundlesForFingerprint,
  listFingerprintKeyVersions,
  lookupFingerprintIssuances,
  revokeFingerprint,
  rotateFingerprintKeyVersion,
  verifyLineageArtifacts,
} from "@teamops/database";

import { appendRequestAuditLog } from "../audit.js";
import type { ControlApiContext } from "../context.js";
import { hasAdminAccess, requireAdminAccess, requireOrganizationOwnerAccess } from "../permissions.js";
import { getRequestScopedEmail } from "../request-auth.js";
import { requireOrganization } from "../resource-guards.js";

function getFingerprintKeyEncryptionKey(context: ControlApiContext) {
  return context.env.FINGERPRINT_KEY_ENCRYPTION_KEY_BASE64 ?? context.env.ENCRYPTION_KEY_BASE64;
}

async function requireFingerprintAccess(
  context: ControlApiContext,
  request: FastifyRequest,
  reply: FastifyReply,
  organizationId: string | null,
) {
  if (hasAdminAccess(context, request)) {
    return null;
  }

  if (!organizationId) {
    return requireAdminAccess(context, request, reply);
  }

  return requireOrganizationOwnerAccess(context, request, reply, organizationId);
}

function serializeLineageKeyVersion(keyVersion: Awaited<ReturnType<typeof listFingerprintKeyVersions>>[number]) {
  return LineageKeyVersionSchema.parse(keyVersion);
}

function serializeAttestationBundle(bundle: Awaited<ReturnType<typeof listEvidenceBundlesForFingerprint>>[number]) {
  return AttestationBundleSchema.parse({
    ...bundle,
    attestationBundleId: bundle.evidenceBundleId,
    lineageId: bundle.fingerprintId,
  });
}

function serializeLineageIssuance(issuance: NonNullable<Awaited<ReturnType<typeof getFingerprintById>>>) {
  return LineageIssuanceSchema.parse({
    ...issuance,
    lineageId: issuance.fingerprintId,
    lineageToken: issuance.fingerprintToken,
    attestationBundleId: issuance.evidenceBundleId,
    attestationRootHash: issuance.evidenceRootHash,
    artifactAttestations: issuance.artifacts,
  });
}

function translateLineageLookupQuery(query: ReturnType<typeof LineageLookupQuerySchema.parse>) {
  return FingerprintLookupQuerySchema.parse({
    fingerprintId: query.lineageId,
    fingerprintToken: query.lineageToken,
    customerId: query.customerId,
    deploymentId: query.deploymentId,
    releaseId: query.releaseId,
    manifestHash: query.manifestHash,
    status: query.status,
    limit: query.limit,
    offset: query.offset,
  });
}

export async function registerFingerprintRoutes(app: FastifyInstance, context: ControlApiContext) {
  const listKeyVersions = async (request: FastifyRequest, reply: FastifyReply) => {
    const permissionError = requireAdminAccess(context, request, reply);
    if (permissionError) {
      return permissionError;
    }

    const query = FingerprintKeyVersionListQuerySchema.parse(request.query);
    return {
      items: await listFingerprintKeyVersions(context.db, query),
    };
  };

  app.get("/v1/fingerprint-key-versions", listKeyVersions);
  app.get("/v1/lineage-key-versions", async (request, reply) => {
    const permissionError = requireAdminAccess(context, request, reply);
    if (permissionError) {
      return permissionError;
    }

    const query = LineageKeyVersionListQuerySchema.parse(request.query);
    const items = await listFingerprintKeyVersions(context.db, {
      purpose: query.purpose,
    });
    return {
      items: items.map(serializeLineageKeyVersion),
    };
  });

  const rotateKeyVersion = async (request: FastifyRequest, reply: FastifyReply) => {
    const permissionError = requireAdminAccess(context, request, reply);
    if (permissionError) {
      return permissionError;
    }

    const input = RotateFingerprintKeyVersionInputSchema.parse(request.body);
    const rotatedKey = await rotateFingerprintKeyVersion(context.db, {
      purpose: input.purpose,
      createdByType: "admin",
      createdById: "control-api-admin",
      encryptionKeyBase64: getFingerprintKeyEncryptionKey(context),
    });

    const auditLog = await appendRequestAuditLog(context.db, request, {
      workspaceId: null,
      action: "fingerprint.key.rotated",
      subjectType: "fingerprint-key",
      subjectId: rotatedKey.keyId,
      payload: {
        keyId: rotatedKey.keyId,
        purpose: rotatedKey.purpose,
        algorithm: rotatedKey.algorithm,
        status: rotatedKey.status,
      },
    });

    await appendEvidenceChainRecord(context.db, {
      chainScope: `fingerprint-key:${rotatedKey.purpose}`,
      auditLogId: auditLog.id,
      eventType: "fingerprint.key.rotated",
      actorType: auditLog.actorType,
      actorId: auditLog.actorId,
      payload: {
        keyId: rotatedKey.keyId,
        purpose: rotatedKey.purpose,
        algorithm: rotatedKey.algorithm,
      },
      encryptionKeyBase64: getFingerprintKeyEncryptionKey(context),
    });

    reply.code(201);
    return rotatedKey;
  };

  app.post("/v1/fingerprint-key-versions/rotate", rotateKeyVersion);
  app.post("/v1/lineage-key-versions/rotate", async (request, reply) => {
    const permissionError = requireAdminAccess(context, request, reply);
    if (permissionError) {
      return permissionError;
    }

    const input = RotateLineageKeyVersionInputSchema.parse(request.body);
    const rotatedKey = await rotateFingerprintKeyVersion(context.db, {
      purpose: input.purpose,
      createdByType: "admin",
      createdById: "control-api-admin",
      encryptionKeyBase64: getFingerprintKeyEncryptionKey(context),
    });

    const auditLog = await appendRequestAuditLog(context.db, request, {
      workspaceId: null,
      action: "lineage.key.rotated",
      subjectType: "lineage-key",
      subjectId: rotatedKey.keyId,
      payload: {
        keyId: rotatedKey.keyId,
        purpose: rotatedKey.purpose,
        algorithm: rotatedKey.algorithm,
        status: rotatedKey.status,
      },
    });

    await appendEvidenceChainRecord(context.db, {
      chainScope: `lineage-key:${rotatedKey.purpose}`,
      auditLogId: auditLog.id,
      eventType: "lineage.key.rotated",
      actorType: auditLog.actorType,
      actorId: auditLog.actorId,
      payload: {
        keyId: rotatedKey.keyId,
        purpose: rotatedKey.purpose,
        algorithm: rotatedKey.algorithm,
      },
      encryptionKeyBase64: getFingerprintKeyEncryptionKey(context),
    });

    reply.code(201);
    return serializeLineageKeyVersion(rotatedKey);
  });

  const issueFingerprintRoute = async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as { organizationId: string };
    const organization = await requireOrganization(context.db, reply, params.organizationId);
    if ("error" in organization) {
      return organization;
    }

    const permissionError = await requireOrganizationOwnerAccess(context, request, reply, organization.id);
    if (permissionError) {
      return permissionError;
    }

    const input = IssueFingerprintInputSchema.parse(request.body);
    const actorEmail = await getRequestScopedEmail(context, request);
    const issuance = await issueFingerprint(context.db, organization.id, input, {
      issuedByType: hasAdminAccess(context, request) ? "admin" : "operator",
      issuedById: hasAdminAccess(context, request) ? "control-api-admin" : actorEmail ?? "organization-owner",
      encryptionKeyBase64: getFingerprintKeyEncryptionKey(context),
    });

    const auditLog = await appendRequestAuditLog(context.db, request, {
      workspaceId: null,
      customerId: issuance.customerId,
      deploymentId: issuance.deploymentId,
      releaseId: issuance.releaseId,
      fingerprintId: issuance.fingerprintId,
      action: "fingerprint.issued",
      subjectType: "fingerprint",
      subjectId: issuance.fingerprintId,
      payload: {
        organizationId: organization.id,
        customerId: issuance.customerId,
        deploymentId: issuance.deploymentId,
        releaseId: issuance.releaseId,
        manifestHash: issuance.manifestHash,
        evidenceBundleId: issuance.evidenceBundleId,
      },
    });

    await appendEvidenceChainRecord(context.db, {
      chainScope: `fingerprint:${issuance.fingerprintId}`,
      fingerprintId: issuance.fingerprintId,
      auditLogId: auditLog.id,
      eventType: "fingerprint.issued",
      actorType: auditLog.actorType,
      actorId: auditLog.actorId,
      payload: {
        customerId: issuance.customerId,
        deploymentId: issuance.deploymentId,
        releaseId: issuance.releaseId,
        manifestHash: issuance.manifestHash,
        evidenceBundleId: issuance.evidenceBundleId,
      },
      encryptionKeyBase64: getFingerprintKeyEncryptionKey(context),
    });

    reply.code(201);
    return issuance;
  };

  app.post("/v1/organizations/:organizationId/fingerprints/issue", issueFingerprintRoute);
  app.post("/v1/organizations/:organizationId/lineage/issue", async (request, reply) => {
    const params = request.params as { organizationId: string };
    const organization = await requireOrganization(context.db, reply, params.organizationId);
    if ("error" in organization) {
      return organization;
    }

    const permissionError = await requireOrganizationOwnerAccess(context, request, reply, organization.id);
    if (permissionError) {
      return permissionError;
    }

    const input = IssueLineageInputSchema.parse(request.body);
    const actorEmail = await getRequestScopedEmail(context, request);
    const issuance = await issueFingerprint(context.db, organization.id, input, {
      issuedByType: hasAdminAccess(context, request) ? "admin" : "operator",
      issuedById: hasAdminAccess(context, request) ? "control-api-admin" : actorEmail ?? "organization-owner",
      encryptionKeyBase64: getFingerprintKeyEncryptionKey(context),
    });

    const auditLog = await appendRequestAuditLog(context.db, request, {
      workspaceId: null,
      customerId: issuance.customerId,
      deploymentId: issuance.deploymentId,
      releaseId: issuance.releaseId,
      fingerprintId: issuance.fingerprintId,
      action: "lineage.issued",
      subjectType: "lineage",
      subjectId: issuance.fingerprintId,
      payload: {
        organizationId: organization.id,
        customerId: issuance.customerId,
        deploymentId: issuance.deploymentId,
        releaseId: issuance.releaseId,
        manifestHash: issuance.manifestHash,
        attestationBundleId: issuance.evidenceBundleId,
      },
    });

    await appendEvidenceChainRecord(context.db, {
      chainScope: `lineage:${issuance.fingerprintId}`,
      fingerprintId: issuance.fingerprintId,
      auditLogId: auditLog.id,
      eventType: "lineage.issued",
      actorType: auditLog.actorType,
      actorId: auditLog.actorId,
      payload: {
        customerId: issuance.customerId,
        deploymentId: issuance.deploymentId,
        releaseId: issuance.releaseId,
        manifestHash: issuance.manifestHash,
        attestationBundleId: issuance.evidenceBundleId,
      },
      encryptionKeyBase64: getFingerprintKeyEncryptionKey(context),
    });

    reply.code(201);
    return LineageIssuanceSchema.parse({
      ...serializeLineageIssuance(issuance),
      buildDescriptor: await getLineageBuildDescriptor(context.db, issuance.fingerprintId),
    });
  });

  app.get("/v1/fingerprints/lookup", async (request, reply) => {
    const permissionError = requireAdminAccess(context, request, reply);
    if (permissionError) {
      return permissionError;
    }

    const query = FingerprintLookupQuerySchema.parse(request.query);
    return lookupFingerprintIssuances(context.db, query);
  });

  app.get("/v1/lineage/lookup", async (request, reply) => {
    const permissionError = requireAdminAccess(context, request, reply);
    if (permissionError) {
      return permissionError;
    }

    const query = translateLineageLookupQuery(LineageLookupQuerySchema.parse(request.query));
    const result = await lookupFingerprintIssuances(context.db, query);
    return LineageListResponseSchema.parse({
      total: result.total,
      items: result.items.map(serializeLineageIssuance),
    });
  });

  app.get("/v1/fingerprints/:fingerprintId", async (request, reply) => {
    const params = request.params as { fingerprintId: string };
    const issuance = await getFingerprintById(context.db, params.fingerprintId);
    if (!issuance) {
      reply.code(404);
      return {
        error: {
          message: "Fingerprint not found",
        },
      };
    }

    const permissionError = await requireFingerprintAccess(context, request, reply, issuance.organizationId);
    if (permissionError) {
      return permissionError;
    }

    const auditLog = await appendRequestAuditLog(context.db, request, {
      workspaceId: null,
      customerId: issuance.customerId,
      deploymentId: issuance.deploymentId,
      releaseId: issuance.releaseId,
      fingerprintId: issuance.fingerprintId,
      action: "fingerprint.lookup",
      subjectType: "fingerprint",
      subjectId: issuance.fingerprintId,
      payload: {
        manifestHash: issuance.manifestHash,
      },
    });

    await appendEvidenceChainRecord(context.db, {
      chainScope: `fingerprint:${issuance.fingerprintId}`,
      fingerprintId: issuance.fingerprintId,
      auditLogId: auditLog.id,
      eventType: "fingerprint.lookup",
      actorType: auditLog.actorType,
      actorId: auditLog.actorId,
      payload: {
        manifestHash: issuance.manifestHash,
      },
      encryptionKeyBase64: getFingerprintKeyEncryptionKey(context),
    });

    return issuance;
  });

  app.get("/v1/lineage/:lineageId", async (request, reply) => {
    const params = request.params as { lineageId: string };
    const issuance = await getFingerprintById(context.db, params.lineageId);
    if (!issuance) {
      reply.code(404);
      return {
        error: {
          message: "Lineage not found",
        },
      };
    }

    const permissionError = await requireFingerprintAccess(context, request, reply, issuance.organizationId);
    if (permissionError) {
      return permissionError;
    }

    const auditLog = await appendRequestAuditLog(context.db, request, {
      workspaceId: null,
      customerId: issuance.customerId,
      deploymentId: issuance.deploymentId,
      releaseId: issuance.releaseId,
      fingerprintId: issuance.fingerprintId,
      action: "lineage.lookup",
      subjectType: "lineage",
      subjectId: issuance.fingerprintId,
      payload: {
        manifestHash: issuance.manifestHash,
      },
    });

    await appendEvidenceChainRecord(context.db, {
      chainScope: `lineage:${issuance.fingerprintId}`,
      fingerprintId: issuance.fingerprintId,
      auditLogId: auditLog.id,
      eventType: "lineage.lookup",
      actorType: auditLog.actorType,
      actorId: auditLog.actorId,
      payload: {
        manifestHash: issuance.manifestHash,
      },
      encryptionKeyBase64: getFingerprintKeyEncryptionKey(context),
    });

    return LineageIssuanceSchema.parse({
      ...serializeLineageIssuance(issuance),
      buildDescriptor: await getLineageBuildDescriptor(context.db, issuance.fingerprintId),
    });
  });

  app.get("/v1/lineage/:lineageId/build-descriptor", async (request, reply) => {
    const params = request.params as { lineageId: string };
    const issuance = await getFingerprintById(context.db, params.lineageId);
    if (!issuance) {
      reply.code(404);
      return {
        error: {
          message: "Lineage not found",
        },
      };
    }

    const permissionError = await requireFingerprintAccess(context, request, reply, issuance.organizationId);
    if (permissionError) {
      return permissionError;
    }

    const buildDescriptor = await getLineageBuildDescriptor(context.db, issuance.fingerprintId);
    if (!buildDescriptor) {
      reply.code(404);
      return {
        error: {
          message: "Build descriptor not found",
        },
      };
    }

    const auditLog = await appendRequestAuditLog(context.db, request, {
      workspaceId: null,
      customerId: issuance.customerId,
      deploymentId: issuance.deploymentId,
      releaseId: issuance.releaseId,
      fingerprintId: issuance.fingerprintId,
      action: "lineage.build-descriptor.downloaded",
      subjectType: "lineage",
      subjectId: issuance.fingerprintId,
      payload: {
        manifestHash: issuance.manifestHash,
        attestationBundleId: issuance.evidenceBundleId,
      },
    });

    await appendEvidenceChainRecord(context.db, {
      chainScope: `lineage:${issuance.fingerprintId}`,
      fingerprintId: issuance.fingerprintId,
      auditLogId: auditLog.id,
      eventType: "lineage.build-descriptor.downloaded",
      actorType: auditLog.actorType,
      actorId: auditLog.actorId,
      payload: {
        manifestHash: issuance.manifestHash,
        attestationBundleId: issuance.evidenceBundleId,
      },
      encryptionKeyBase64: getFingerprintKeyEncryptionKey(context),
    });

    return BuildDescriptorResponseSchema.parse({
      buildDescriptor,
    });
  });

  app.post("/v1/lineage/:lineageId/artifacts/verify", async (request, reply) => {
    const params = request.params as { lineageId: string };
    const issuance = await getFingerprintById(context.db, params.lineageId);
    if (!issuance) {
      reply.code(404);
      return {
        error: {
          message: "Lineage not found",
        },
      };
    }

    const permissionError = await requireFingerprintAccess(context, request, reply, issuance.organizationId);
    if (permissionError) {
      return permissionError;
    }

    const input = VerifyLineageArtifactsInputSchema.parse(request.body);
    const verification = await verifyLineageArtifacts(context.db, issuance.fingerprintId, input.extractor);
    if (!verification) {
      reply.code(404);
      return {
        error: {
          message: "Lineage not found",
        },
      };
    }

    const auditAction =
      verification.matchStatus === "mismatch"
        ? "lineage.artifacts.mismatch"
        : verification.matchStatus === "matched"
          ? "lineage.artifacts.verified"
          : "lineage.artifacts.registered";
    const evidenceEvent =
      verification.matchStatus === "mismatch"
        ? "fingerprint.artifacts.mismatch"
        : verification.matchStatus === "matched"
          ? "fingerprint.artifacts.verified"
          : "fingerprint.artifacts.registered";

    const auditLog = await appendRequestAuditLog(context.db, request, {
      workspaceId: null,
      customerId: issuance.customerId,
      deploymentId: issuance.deploymentId,
      releaseId: issuance.releaseId,
      fingerprintId: issuance.fingerprintId,
      action: auditAction,
      subjectType: "lineage",
      subjectId: issuance.fingerprintId,
      payload: {
        manifestHash: issuance.manifestHash,
        matchStatus: verification.matchStatus,
        recoveredLocator: verification.recoveredLocator,
        codewordDigest: verification.codewordDigest,
      },
    });

    await appendEvidenceChainRecord(context.db, {
      chainScope: `lineage:${issuance.fingerprintId}`,
      fingerprintId: issuance.fingerprintId,
      auditLogId: auditLog.id,
      eventType: evidenceEvent,
      actorType: auditLog.actorType,
      actorId: auditLog.actorId,
      payload: {
        manifestHash: issuance.manifestHash,
        matchStatus: verification.matchStatus,
        recoveredLocator: verification.recoveredLocator,
        codewordDigest: verification.codewordDigest,
      },
      encryptionKeyBase64: getFingerprintKeyEncryptionKey(context),
    });

    return VerifyLineageArtifactsResponseSchema.parse(verification);
  });

  app.get("/v1/fingerprints/:fingerprintId/evidence-bundles", async (request, reply) => {
    const params = request.params as { fingerprintId: string };
    const issuance = await getFingerprintById(context.db, params.fingerprintId);
    if (!issuance) {
      reply.code(404);
      return {
        error: {
          message: "Fingerprint not found",
        },
      };
    }

    const permissionError = await requireFingerprintAccess(context, request, reply, issuance.organizationId);
    if (permissionError) {
      return permissionError;
    }

    return {
      items: await listEvidenceBundlesForFingerprint(context.db, issuance.fingerprintId),
    };
  });

  app.get("/v1/lineage/:lineageId/attestation-bundles", async (request, reply) => {
    const params = request.params as { lineageId: string };
    const issuance = await getFingerprintById(context.db, params.lineageId);
    if (!issuance) {
      reply.code(404);
      return {
        error: {
          message: "Lineage not found",
        },
      };
    }

    const permissionError = await requireFingerprintAccess(context, request, reply, issuance.organizationId);
    if (permissionError) {
      return permissionError;
    }

    return {
      items: (await listEvidenceBundlesForFingerprint(context.db, issuance.fingerprintId)).map(
        serializeAttestationBundle,
      ),
    };
  });

  app.get("/v1/attestation-bundles/:attestationBundleId", async (request, reply) => {
    const params = request.params as { attestationBundleId: string };
    const bundle = await getEvidenceBundleById(context.db, params.attestationBundleId);
    if (!bundle) {
      reply.code(404);
      return {
        error: {
          message: "Attestation bundle not found",
        },
      };
    }

    const issuance = bundle.fingerprintId ? await getFingerprintById(context.db, bundle.fingerprintId) : null;
    const permissionError = await requireFingerprintAccess(context, request, reply, issuance?.organizationId ?? null);
    if (permissionError) {
      return permissionError;
    }

    return serializeAttestationBundle(bundle);
  });

  app.get("/v1/attestation-bundles/:attestationBundleId/download", async (request, reply) => {
    const params = request.params as { attestationBundleId: string };
    const bundle = await getEvidenceBundleById(context.db, params.attestationBundleId);
    if (!bundle) {
      reply.code(404);
      return {
        error: {
          message: "Attestation bundle not found",
        },
      };
    }

    const issuance = bundle.fingerprintId ? await getFingerprintById(context.db, bundle.fingerprintId) : null;
    const permissionError = await requireFingerprintAccess(context, request, reply, issuance?.organizationId ?? null);
    if (permissionError) {
      return permissionError;
    }

    const metadata = bundle.metadata as Record<string, unknown>;
    const responsePayload = {
      schema: "teamops.attestation-bundle.v1",
      bundle: serializeAttestationBundle(bundle),
      payload: metadata.payload ?? {},
      signingKeyId: typeof metadata.signingKeyId === "string" ? metadata.signingKeyId : null,
      signature: typeof metadata.signature === "string" ? metadata.signature : null,
    };

    reply.header("content-type", "application/json; charset=utf-8");
    reply.header(
      "content-disposition",
      `attachment; filename="${params.attestationBundleId}.attestation.json"`,
    );

    return responsePayload;
  });

  app.post("/v1/fingerprints/:fingerprintId/revoke", async (request, reply) => {
    const params = request.params as { fingerprintId: string };
    const existing = await getFingerprintById(context.db, params.fingerprintId);
    if (!existing) {
      reply.code(404);
      return {
        error: {
          message: "Fingerprint not found",
        },
      };
    }

    const permissionError = await requireFingerprintAccess(context, request, reply, existing.organizationId);
    if (permissionError) {
      return permissionError;
    }

    const input = RevokeFingerprintInputSchema.parse(request.body);
    const actorEmail = await getRequestScopedEmail(context, request);
    const revoked = await revokeFingerprint(context.db, existing.fingerprintId, {
      revokedByType: hasAdminAccess(context, request) ? "admin" : "operator",
      revokedById: hasAdminAccess(context, request) ? "control-api-admin" : actorEmail ?? "organization-owner",
      reason: input.reason,
    });
    if (!revoked) {
      reply.code(404);
      return {
        error: {
          message: "Fingerprint not found",
        },
      };
    }

    const auditLog = await appendRequestAuditLog(context.db, request, {
      workspaceId: null,
      customerId: revoked.customerId,
      deploymentId: revoked.deploymentId,
      releaseId: revoked.releaseId,
      fingerprintId: revoked.fingerprintId,
      action: "fingerprint.revoked",
      subjectType: "fingerprint",
      subjectId: revoked.fingerprintId,
      payload: {
        reason: input.reason,
        manifestHash: revoked.manifestHash,
      },
    });

    await appendEvidenceChainRecord(context.db, {
      chainScope: `fingerprint:${revoked.fingerprintId}`,
      fingerprintId: revoked.fingerprintId,
      auditLogId: auditLog.id,
      eventType: "fingerprint.revoked",
      actorType: auditLog.actorType,
      actorId: auditLog.actorId,
      payload: {
        reason: input.reason,
        manifestHash: revoked.manifestHash,
      },
      encryptionKeyBase64: getFingerprintKeyEncryptionKey(context),
    });

    return revoked;
  });

  app.post("/v1/lineage/:lineageId/revoke", async (request, reply) => {
    const params = request.params as { lineageId: string };
    const existing = await getFingerprintById(context.db, params.lineageId);
    if (!existing) {
      reply.code(404);
      return {
        error: {
          message: "Lineage not found",
        },
      };
    }

    const permissionError = await requireFingerprintAccess(context, request, reply, existing.organizationId);
    if (permissionError) {
      return permissionError;
    }

    const input = RevokeLineageInputSchema.parse(request.body);
    const actorEmail = await getRequestScopedEmail(context, request);
    const revoked = await revokeFingerprint(context.db, existing.fingerprintId, {
      revokedByType: hasAdminAccess(context, request) ? "admin" : "operator",
      revokedById: hasAdminAccess(context, request) ? "control-api-admin" : actorEmail ?? "organization-owner",
      reason: input.reason,
    });
    if (!revoked) {
      reply.code(404);
      return {
        error: {
          message: "Lineage not found",
        },
      };
    }

    const auditLog = await appendRequestAuditLog(context.db, request, {
      workspaceId: null,
      customerId: revoked.customerId,
      deploymentId: revoked.deploymentId,
      releaseId: revoked.releaseId,
      fingerprintId: revoked.fingerprintId,
      action: "lineage.revoked",
      subjectType: "lineage",
      subjectId: revoked.fingerprintId,
      payload: {
        reason: input.reason,
        manifestHash: revoked.manifestHash,
      },
    });

    await appendEvidenceChainRecord(context.db, {
      chainScope: `lineage:${revoked.fingerprintId}`,
      fingerprintId: revoked.fingerprintId,
      auditLogId: auditLog.id,
      eventType: "lineage.revoked",
      actorType: auditLog.actorType,
      actorId: auditLog.actorId,
      payload: {
        reason: input.reason,
        manifestHash: revoked.manifestHash,
      },
      encryptionKeyBase64: getFingerprintKeyEncryptionKey(context),
    });

    return serializeLineageIssuance(revoked);
  });
}
