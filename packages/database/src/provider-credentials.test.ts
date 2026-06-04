import assert from "node:assert/strict";
import test from "node:test";

import {
  ProviderConnectionCredentialKeyMismatchError,
  createDatabase,
  createProviderConnection,
  createWorkspace,
  createProject,
  createMember,
  deriveCredentialKeyFingerprint,
  replaceMemberProjectAssignments,
  resolveProviderCredentialsByConnectionId,
  runMigrations,
  updateProviderConnection,
} from "./index.js";

async function createSeededDatabase() {
  const db = createDatabase("pglite://memory");
  await runMigrations(db);
  await db.query(
    `insert into organizations (id, slug, name) values ($1, $2, $3)`,
    ["11111111-1111-4111-8111-111111111111", "teamops", "TeamOps"],
  );

  const workspace = await createWorkspace(db, {
    organizationId: "11111111-1111-4111-8111-111111111111",
    slug: "workspace-a",
    name: "Workspace A",
  });
  const project = await createProject(db, {
    workspaceId: workspace.id,
    slug: "project-a",
    name: "Project A",
  });
  const member = await createMember(db, {
    workspaceId: workspace.id,
    email: "dev@example.com",
    name: "Dev",
    role: "developer",
    roles: ["developer"],
    temporaryAccessExpiresAt: null,
  });
  await db.query(`update members set status = 'active' where id = $1`, [member.id]);
  await replaceMemberProjectAssignments(db, member.id, {
    projectIds: [project.id],
  });

  return { db, workspace };
}

test("provider connections store credential key fingerprint on create and rotate", async () => {
  const { db, workspace } = await createSeededDatabase();
  const encryptionKeyBase64 = Buffer.alloc(32, 9).toString("base64");
  const expectedFingerprint = deriveCredentialKeyFingerprint(encryptionKeyBase64);

  try {
    const provider = await createProviderConnection(
      db,
      {
        workspaceId: workspace.id,
        provider: "openai-compatible",
        label: "Relay",
        apiKey: "sk-test-primary-12345678",
        metadata: {
          baseUrl: "https://relay.example.com",
        },
        pricingConfig: null,
      },
      encryptionKeyBase64,
    );

    const createdRow = await db.query<{ credential_key_fingerprint: string | null }>(
      "select credential_key_fingerprint from provider_connections where id = $1",
      [provider.id],
    );
    assert.equal(createdRow.rows[0]?.credential_key_fingerprint, expectedFingerprint);

    await updateProviderConnection(
      db,
      provider.id,
      {
        apiKey: "sk-test-rotated-12345678",
      },
      encryptionKeyBase64,
    );

    const updatedRow = await db.query<{ credential_key_fingerprint: string | null }>(
      "select credential_key_fingerprint from provider_connections where id = $1",
      [provider.id],
    );
    assert.equal(updatedRow.rows[0]?.credential_key_fingerprint, expectedFingerprint);
  } finally {
    await db.end();
  }
});

test("resolving provider credentials throws a key mismatch error when runtime fingerprint differs", async () => {
  const { db, workspace } = await createSeededDatabase();
  const encryptionKeyBase64 = Buffer.alloc(32, 9).toString("base64");

  try {
    const provider = await createProviderConnection(
      db,
      {
        workspaceId: workspace.id,
        provider: "openai-compatible",
        label: "Relay",
        apiKey: "sk-test-primary-12345678",
        metadata: {
          baseUrl: "https://relay.example.com",
        },
        pricingConfig: null,
      },
      encryptionKeyBase64,
    );

    await assert.rejects(
      () =>
        resolveProviderCredentialsByConnectionId(
          db,
          provider.id,
          Buffer.alloc(32, 7).toString("base64"),
        ),
      (error: unknown) => error instanceof ProviderConnectionCredentialKeyMismatchError,
    );
  } finally {
    await db.end();
  }
});
