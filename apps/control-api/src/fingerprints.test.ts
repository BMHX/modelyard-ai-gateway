import assert from "node:assert/strict";
import test from "node:test";

import {
  createDatabase,
  runMigrations,
} from "@teamops/database";

import { buildControlApi } from "./app.js";

async function createFingerprintApp() {
  const db = createDatabase("pglite://memory");
  await runMigrations(db);

  await db.query(
    `insert into organizations (id, slug, name) values ($1, $2, $3)`,
    ["11111111-1111-4111-8111-111111111111", "teamops", "TeamOps"],
  );

  const encryptionKeyBase64 = Buffer.alloc(32, 7).toString("base64");
  const app = await buildControlApi({
    env: {
      CONTROL_API_ADMIN_TOKEN: "test-admin-token",
      ENCRYPTION_KEY_BASE64: encryptionKeyBase64,
      FINGERPRINT_KEY_ENCRYPTION_KEY_BASE64: encryptionKeyBase64,
    },
    db,
    valkey: {
      async get() {
        return null;
      },
      async setEx() {},
      async del() {},
      async quit() {},
    },
  } as Parameters<typeof buildControlApi>[0]);

  return { app, db };
}

async function issueLineage(app: Awaited<ReturnType<typeof buildControlApi>>) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/organizations/11111111-1111-4111-8111-111111111111/lineage/issue",
    headers: {
      authorization: "Bearer test-admin-token",
    },
    payload: {
      deploymentName: "Preview Runtime",
      deploymentMode: "self_host_preview",
      channel: "self-host",
      version: "0.1.0",
      gitCommitSha: "abc123",
      buildSystem: "monorepo",
      artifactManifest: {
        releaseSurface: "preview-runtime",
      },
      artifacts: [
        {
          artifactRole: "server-dist",
          relativePath: "dist/server.js",
          objectKey: null,
          sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          sizeBytes: 128,
          embedLocator: {
            buildLocator: "abcdefghijklmnop",
            codewordDigest: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            candidateCount: 4,
            assignmentCount: 4,
            familySummary: [
              {
                family: "if-return",
                symbol: 1,
                hitCount: 2,
              },
            ],
            verificationSource: "declared",
            verificationStatus: "pending",
          },
        },
      ],
      metadata: {
        source: "test",
      },
    },
  });

  assert.equal(response.statusCode, 201);
  return response.json();
}

test("lineage issue returns a build descriptor", async () => {
  const { app, db } = await createFingerprintApp();

  try {
    const issued = await issueLineage(app);

    assert.equal(issued.buildDescriptor.lineageId, issued.lineageId);
    assert.equal(issued.buildDescriptor.lineageToken, issued.lineageToken);
    assert.equal(issued.buildDescriptor.manifestHash, issued.manifestHash);
    assert.equal(
      issued.buildDescriptor.watermarkProfile,
      `${issued.customerId}:${issued.deploymentId}:${issued.releaseId}:${issued.manifestHash}`,
    );
  } finally {
    await app.close();
    await db.end();
  }
});

test("lineage build descriptor route returns the reusable descriptor", async () => {
  const { app, db } = await createFingerprintApp();

  try {
    const issued = await issueLineage(app);

    const response = await app.inject({
      method: "GET",
      url: `/v1/lineage/${issued.lineageId}/build-descriptor`,
      headers: {
        authorization: "Bearer test-admin-token",
      },
    });

    assert.equal(response.statusCode, 200);
    const payload = response.json();
    assert.equal(payload.buildDescriptor.lineageId, issued.lineageId);
    assert.equal(payload.buildDescriptor.attestationBundleId, issued.attestationBundleId);
  } finally {
    await app.close();
    await db.end();
  }
});

test("lineage artifact verify marks a matching artifact as matched", async () => {
  const { app, db } = await createFingerprintApp();

  try {
    const issued = await issueLineage(app);

    const response = await app.inject({
      method: "POST",
      url: `/v1/lineage/${issued.lineageId}/artifacts/verify`,
      headers: {
        authorization: "Bearer test-admin-token",
      },
      payload: {
        extractor: {
          observedArtifacts: [
            {
              artifactRole: "server-dist",
              relativePath: "dist/server.js",
              sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              sizeBytes: 128,
              buildLocator: "abcdefghijklmnop",
              codewordDigest: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              candidateCount: 4,
              assignmentCount: 4,
              familySummary: [
                {
                  family: "if-return",
                  symbol: null,
                  hitCount: 2,
                },
              ],
            },
          ],
          recoveredLocator: "abcdefghijklmnop",
          locatorCandidates: ["abcdefghijklmnop"],
          codewordDigest: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          digestCandidates: ["bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],
          familyHitSummary: [
            {
              family: "if-return",
              symbol: null,
              hitCount: 2,
            },
          ],
          matchStatus: "partial",
        },
      },
    });

    assert.equal(response.statusCode, 200);
    const payload = response.json();
    assert.equal(payload.matchStatus, "matched");
    assert.equal(payload.artifacts[0].matchStatus, "matched");
    assert.equal(payload.artifacts[0].verificationStatus, "matched");
    assert.equal(payload.recoveredLocator, "abcdefghijklmnop");
  } finally {
    await app.close();
    await db.end();
  }
});
