import assert from "node:assert/strict";
import test from "node:test";

import {
  createDatabase,
  createWorkspace,
  runMigrations,
} from "@teamops/database";

import { buildControlApi } from "./app.js";

async function createMembersTestApp() {
  const db = createDatabase("pglite://memory");
  await runMigrations(db);

  const encryptionKeyBase64 = Buffer.alloc(32, 5).toString("base64");

  await db.query(
    `insert into organizations (id, slug, name) values ($1, $2, $3)`,
    ["11111111-1111-4111-8111-111111111111", "teamops", "TeamOps"],
  );

  const workspace = await createWorkspace(db, {
    organizationId: "11111111-1111-4111-8111-111111111111",
    slug: "workspace-a",
    name: "Workspace A",
  });

  const app = await buildControlApi({
    env: {
      CONTROL_API_ADMIN_TOKEN: "test-admin-token",
      ENCRYPTION_KEY_BASE64: encryptionKeyBase64,
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

  return {
    app,
    db,
    workspace,
  };
}

test("member routes persist multiple roles and keep the primary role aligned", async () => {
  const { app, db, workspace } = await createMembersTestApp();

  try {
    const createResponse = await app.inject({
      method: "POST",
      url: "/v1/members",
      headers: {
        authorization: "Bearer test-admin-token",
      },
      payload: {
        workspaceId: workspace.id,
        email: "member@example.com",
        name: "Member",
        role: "workspace_admin",
        roles: ["workspace_admin", "developer"],
        temporaryAccessExpiresAt: null,
      },
    });

    assert.equal(createResponse.statusCode, 201);
    assert.equal(createResponse.json().role, "workspace_admin");
    assert.deepEqual(createResponse.json().roles, ["workspace_admin", "developer"]);

    const updateResponse = await app.inject({
      method: "PATCH",
      url: `/v1/members/${createResponse.json().id}`,
      headers: {
        authorization: "Bearer test-admin-token",
      },
      payload: {
        role: "developer",
        roles: ["developer", "workspace_admin"],
      },
    });

    assert.equal(updateResponse.statusCode, 200);
    assert.equal(updateResponse.json().role, "developer");
    assert.deepEqual(updateResponse.json().roles, ["developer", "workspace_admin"]);

    const listResponse = await app.inject({
      method: "GET",
      url: `/v1/members?workspaceId=${workspace.id}`,
      headers: {
        authorization: "Bearer test-admin-token",
      },
    });

    assert.equal(listResponse.statusCode, 200);
    assert.equal(listResponse.json().items.length, 1);
    assert.equal(listResponse.json().items[0].role, "developer");
    assert.deepEqual(listResponse.json().items[0].roles, ["developer", "workspace_admin"]);
  } finally {
    await app.close();
    await db.end();
  }
});

test("workspace member routes reject organization_owner when it appears in roles", async () => {
  const { app, db, workspace } = await createMembersTestApp();

  try {
    const response = await app.inject({
      method: "POST",
      url: "/v1/members",
      headers: {
        authorization: "Bearer test-admin-token",
      },
      payload: {
        workspaceId: workspace.id,
        email: "owner@example.com",
        name: "Owner",
        role: "developer",
        roles: ["developer", "organization_owner"],
        temporaryAccessExpiresAt: null,
      },
    });

    assert.equal(response.statusCode, 400);
    assert.match(response.json().error.message, /organization_owner/i);
  } finally {
    await app.close();
    await db.end();
  }
});
