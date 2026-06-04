import assert from "node:assert/strict";
import test from "node:test";

import { exportJWK, generateKeyPair, SignJWT } from "jose";

import {
  createDatabase,
  runMigrations,
  upsertIdentityProvider,
  type Database,
} from "@teamops/database";

import { buildControlApi } from "./app.js";

type MemoryValkey = {
  store: Map<string, string>;
  get(key: string): Promise<string | null>;
  setEx(key: string, seconds: number, value: string): Promise<void>;
  del(key: string): Promise<void>;
  quit(): Promise<void>;
};

function createMemoryValkey(): MemoryValkey {
  const store = new Map<string, string>();
  return {
    store,
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async setEx(key: string, _seconds: number, value: string) {
      store.set(key, value);
    },
    async del(key: string) {
      store.delete(key);
    },
    async quit() {},
  };
}

async function createSeededAuthContext(args: {
  includeActiveMember: boolean;
}) {
  const db = createDatabase("pglite://memory");
  await runMigrations(db);

  const organizationId = "11111111-1111-4111-8111-111111111111";
  const workspaceId = "22222222-2222-4222-8222-222222222222";
  const encryptionKeyBase64 = Buffer.alloc(32, 7).toString("base64");
  const valkey = createMemoryValkey();

  await db.query(
    `
      insert into organizations (id, slug, name)
      values ($1, $2, $3)
    `,
    [organizationId, "pilot-customer-demo", "Pilot Customer Demo"],
  );
  await db.query(
    `
      insert into workspaces (id, organization_id, slug, name)
      values ($1, $2, $3, $4)
    `,
    [workspaceId, organizationId, "finance-audit-pilot", "Finance Audit Pilot"],
  );

  if (args.includeActiveMember) {
    await db.query(
      `
        insert into members (workspace_id, email, name, role, status)
        values ($1, $2, $3, $4, 'active')
      `,
      [workspaceId, "owner@example.com", "Owner", "organization_owner"],
    );
  }

  await upsertIdentityProvider(
    db,
    organizationId,
    {
      providerType: "generic-oidc",
      issuer: "https://id.example.com",
      authorizationEndpoint: "https://id.example.com/oauth2/v1/authorize",
      tokenEndpoint: "https://id.example.com/oauth2/v1/token",
      userinfoEndpoint: null,
      jwksUri: "https://id.example.com/oauth2/v1/keys",
      clientId: "teamops-control-plane",
      clientSecret: "super-secret-client",
      scopes: ["openid", "email", "profile"],
      domainHint: null,
      status: "active",
    },
    encryptionKeyBase64,
  );

  return {
    app: await buildControlApi({
      env: {
        CONTROL_API_ADMIN_TOKEN: "test-admin-token",
        ENCRYPTION_KEY_BASE64: encryptionKeyBase64,
      },
      db,
      valkey,
    } as Parameters<typeof buildControlApi>[0]),
    db,
    organizationId,
    workspaceId,
    valkey,
  };
}

test("oidc login flow creates a session and logout revokes it", async () => {
  const { app, db, valkey } = await createSeededAuthContext({
    includeActiveMember: true,
  });
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const publicJwk = await exportJWK(publicKey);
  const originalFetch = globalThis.fetch;

  try {
    const startResponse = await app.inject({
      method: "POST",
      url: "/v1/auth/login/start",
      payload: {
        organizationSlug: "pilot-customer-demo",
        returnTo: "/providers?workspaceId=22222222-2222-4222-8222-222222222222",
      },
    });

    assert.equal(startResponse.statusCode, 200);
    const authorizationUrl = new URL(startResponse.json().authorizationUrl);
    const state = authorizationUrl.searchParams.get("state");
    assert.ok(state);

    const transactionValue = valkey.store.get(`teamops:oidc-auth:${state}`);
    assert.ok(transactionValue);
    const transaction = JSON.parse(transactionValue) as { nonce: string };

    const idToken = await new SignJWT({
      email: "owner@example.com",
      email_verified: true,
      name: "Owner",
      nonce: transaction.nonce,
    })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer("https://id.example.com")
      .setAudience("teamops-control-plane")
      .setSubject("external-owner-1")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);

    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      if (url === "https://id.example.com/oauth2/v1/token") {
        assert.equal(init?.method, "POST");
        return new Response(
          JSON.stringify({
            access_token: "access-token",
            id_token: idToken,
            token_type: "Bearer",
            expires_in: 300,
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          },
        );
      }

      if (url === "https://id.example.com/oauth2/v1/keys") {
        return new Response(
          JSON.stringify({
            keys: [
              {
                ...publicJwk,
                alg: "RS256",
                kid: "test-key",
                use: "sig",
              },
            ],
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          },
        );
      }

      throw new Error(`Unhandled fetch in auth-routes.test.ts: ${url}`);
    }) as typeof fetch;

    const callbackResponse = await app.inject({
      method: "POST",
      url: "/v1/auth/login/callback",
      payload: {
        code: "oidc-code-1",
        state,
      },
    });

    assert.equal(callbackResponse.statusCode, 200);
    const callbackPayload = callbackResponse.json();
    assert.equal(
      callbackPayload.returnTo,
      "/providers?workspaceId=22222222-2222-4222-8222-222222222222",
    );
    assert.equal(typeof callbackPayload.sessionHandle, "string");

    const sessionResponse = await app.inject({
      method: "GET",
      url: "/v1/auth/session",
      headers: {
        "x-teamops-web-admin-auth": `session ${callbackPayload.sessionHandle}`,
      },
    });
    assert.equal(sessionResponse.statusCode, 200);
    assert.equal(sessionResponse.json().email, "owner@example.com");
    assert.equal(sessionResponse.json().organizationSlug, "pilot-customer-demo");
    assert.deepEqual(sessionResponse.json().guideExitedWorkspaceIds, []);

    const updateGuidePreferenceResponse = await app.inject({
      method: "POST",
      url: "/v1/auth/session/guide-preferences",
      headers: {
        "x-teamops-web-admin-auth": `session ${callbackPayload.sessionHandle}`,
      },
      payload: {
        workspaceId: "22222222-2222-4222-8222-222222222222",
        exited: true,
      },
    });
    assert.equal(updateGuidePreferenceResponse.statusCode, 200);
    assert.deepEqual(updateGuidePreferenceResponse.json().guideExitedWorkspaceIds, [
      "22222222-2222-4222-8222-222222222222",
    ]);

    const updatedSessionResponse = await app.inject({
      method: "GET",
      url: "/v1/auth/session",
      headers: {
        "x-teamops-web-admin-auth": `session ${callbackPayload.sessionHandle}`,
      },
    });
    assert.equal(updatedSessionResponse.statusCode, 200);
    assert.deepEqual(updatedSessionResponse.json().guideExitedWorkspaceIds, [
      "22222222-2222-4222-8222-222222222222",
    ]);

    const logoutResponse = await app.inject({
      method: "POST",
      url: "/v1/auth/logout",
      headers: {
        "x-teamops-web-admin-auth": `session ${callbackPayload.sessionHandle}`,
      },
    });
    assert.equal(logoutResponse.statusCode, 204);

    const revokedSessionResponse = await app.inject({
      method: "GET",
      url: "/v1/auth/session",
      headers: {
        "x-teamops-web-admin-auth": `session ${callbackPayload.sessionHandle}`,
      },
    });
    assert.equal(revokedSessionResponse.statusCode, 401);
    assert.equal(revokedSessionResponse.json().error.code, "SESSION_REVOKED");
  } finally {
    globalThis.fetch = originalFetch;
    await app.close();
    await db.end();
  }
});

test("oidc callback is denied when the organization has no active member for the resolved email", async () => {
  const { app, db, valkey } = await createSeededAuthContext({
    includeActiveMember: false,
  });
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const publicJwk = await exportJWK(publicKey);
  const originalFetch = globalThis.fetch;

  try {
    const startResponse = await app.inject({
      method: "POST",
      url: "/v1/auth/login/start",
      payload: {
        organizationSlug: "pilot-customer-demo",
        returnTo: "/",
      },
    });
    assert.equal(startResponse.statusCode, 200);

    const state = new URL(startResponse.json().authorizationUrl).searchParams.get("state");
    assert.ok(state);

    const transactionValue = valkey.store.get(`teamops:oidc-auth:${state}`);
    assert.ok(transactionValue);
    const transaction = JSON.parse(transactionValue) as { nonce: string };

    const idToken = await new SignJWT({
      email: "owner@example.com",
      email_verified: true,
      name: "Owner",
      nonce: transaction.nonce,
    })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer("https://id.example.com")
      .setAudience("teamops-control-plane")
      .setSubject("external-owner-2")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);

    globalThis.fetch = (async (input) => {
      const url = String(input);
      if (url === "https://id.example.com/oauth2/v1/token") {
        return new Response(
          JSON.stringify({
            access_token: "access-token",
            id_token: idToken,
            token_type: "Bearer",
            expires_in: 300,
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          },
        );
      }

      if (url === "https://id.example.com/oauth2/v1/keys") {
        return new Response(
          JSON.stringify({
            keys: [
              {
                ...publicJwk,
                alg: "RS256",
                kid: "test-key",
                use: "sig",
              },
            ],
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          },
        );
      }

      throw new Error(`Unhandled fetch in auth-routes.test.ts: ${url}`);
    }) as typeof fetch;

    const callbackResponse = await app.inject({
      method: "POST",
      url: "/v1/auth/login/callback",
      payload: {
        code: "oidc-code-2",
        state,
      },
    });

    assert.equal(callbackResponse.statusCode, 403);
    assert.equal(callbackResponse.json().error.code, "OIDC_NO_ACTIVE_MEMBERSHIP");
    assert.equal(callbackResponse.json().error.details.authStage, "oidc_callback");
    assert.equal(callbackResponse.json().error.details.organizationSlug, "pilot-customer-demo");
  } finally {
    globalThis.fetch = originalFetch;
    await app.close();
    await db.end();
  }
});

test("oidc start is denied when the organization only has the synthetic test identity provider", async () => {
  const { app, db, organizationId } = await createSeededAuthContext({
    includeActiveMember: true,
  });
  const encryptionKeyBase64 = Buffer.alloc(32, 7).toString("base64");

  try {
    await upsertIdentityProvider(
      db,
      organizationId,
      {
        providerType: "generic-oidc",
        issuer: "https://teamops.test.local/oidc",
        authorizationEndpoint: "https://teamops.test.local/oidc/authorize",
        tokenEndpoint: "https://teamops.test.local/oidc/token",
        userinfoEndpoint: null,
        jwksUri: "https://teamops.test.local/oidc/keys",
        clientId: "teamops-test-login",
        clientSecret: null,
        scopes: ["openid", "email", "profile"],
        domainHint: null,
        status: "active",
      },
      encryptionKeyBase64,
    );

    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/login/start",
      payload: {
        organizationSlug: "pilot-customer-demo",
        returnTo: "/",
      },
    });

    assert.equal(response.statusCode, 403);
    assert.equal(response.json().error.code, "OIDC_TEST_LOGIN_ONLY");
    assert.equal(
      response.json().error.message,
      "This organization only has development test sign-in. Use a test login preset instead of OIDC.",
    );
    assert.equal(response.json().error.details.authStage, "oidc_start");
  } finally {
    await app.close();
    await db.end();
  }
});

test("oidc callback returns a stable error code when the login transaction is missing", async () => {
  const { app, db } = await createSeededAuthContext({
    includeActiveMember: true,
  });

  try {
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/login/callback",
      payload: {
        code: "oidc-code-missing",
        state: "missing-state",
      },
    });

    assert.equal(response.statusCode, 401);
    assert.equal(response.json().error.code, "LOGIN_TRANSACTION_EXPIRED");
    assert.equal(response.json().error.details.authStage, "oidc_callback");
  } finally {
    await app.close();
    await db.end();
  }
});

test("oidc callback returns a stable error code when token exchange fails", async () => {
  const { app, db, valkey } = await createSeededAuthContext({
    includeActiveMember: true,
  });
  const originalFetch = globalThis.fetch;

  try {
    const startResponse = await app.inject({
      method: "POST",
      url: "/v1/auth/login/start",
      payload: {
        organizationSlug: "pilot-customer-demo",
        returnTo: "/",
      },
    });

    const state = new URL(startResponse.json().authorizationUrl).searchParams.get("state");
    assert.ok(state);
    assert.ok(valkey.store.get(`teamops:oidc-auth:${state}`));

    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: "invalid_grant" }), {
        status: 401,
        headers: {
          "content-type": "application/json",
        },
      })) as typeof fetch;

    const callbackResponse = await app.inject({
      method: "POST",
      url: "/v1/auth/login/callback",
      payload: {
        code: "oidc-code-invalid",
        state,
      },
    });

    assert.equal(callbackResponse.statusCode, 401);
    assert.equal(callbackResponse.json().error.code, "OIDC_TOKEN_EXCHANGE_FAILED");
    assert.equal(callbackResponse.json().error.details.authStage, "oidc_callback");
    assert.equal(callbackResponse.json().error.details.upstreamStatus, 401);
  } finally {
    globalThis.fetch = originalFetch;
    await app.close();
    await db.end();
  }
});

test("oidc callback returns a stable error code when the stored client secret cannot be decrypted", async () => {
  const { app, db, valkey } = await createSeededAuthContext({
    includeActiveMember: true,
  });

  try {
    await db.query(
      `
        update identity_providers
        set encrypted_client_secret = $1
        where organization_id = $2
      `,
      ["broken-secret-payload", "11111111-1111-4111-8111-111111111111"],
    );

    const startResponse = await app.inject({
      method: "POST",
      url: "/v1/auth/login/start",
      payload: {
        organizationSlug: "pilot-customer-demo",
        returnTo: "/",
      },
    });

    const state = new URL(startResponse.json().authorizationUrl).searchParams.get("state");
    assert.ok(state);
    assert.ok(valkey.store.get(`teamops:oidc-auth:${state}`));

    const callbackResponse = await app.inject({
      method: "POST",
      url: "/v1/auth/login/callback",
      payload: {
        code: "oidc-code-secret",
        state,
      },
    });

    assert.equal(callbackResponse.statusCode, 500);
    assert.equal(callbackResponse.json().error.code, "OIDC_PROVIDER_SECRET_INVALID");
    assert.equal(callbackResponse.json().error.details.authStage, "oidc_callback");
  } finally {
    await app.close();
    await db.end();
  }
});

test("test login creates a control-plane session in non-production environments", async () => {
  const { app, db } = await createSeededAuthContext({
    includeActiveMember: true,
  });

  try {
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/test-login",
      payload: {
        organizationSlug: "pilot-customer-demo",
        email: "owner@example.com",
        returnTo: "/",
      },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(typeof response.json().sessionHandle, "string");

    const sessionResponse = await app.inject({
      method: "GET",
      url: "/v1/auth/session",
      headers: {
        "x-teamops-web-admin-auth": `session ${response.json().sessionHandle}`,
      },
    });
    assert.equal(sessionResponse.statusCode, 200);
    assert.equal(sessionResponse.json().email, "owner@example.com");
    assert.equal(typeof sessionResponse.json().activeMembershipId, "string");
    assert.equal(sessionResponse.json().activeRole, "organization_owner");

    const identitiesResponse = await app.inject({
      method: "GET",
      url: "/v1/auth/session/identities",
      headers: {
        "x-teamops-web-admin-auth": `session ${response.json().sessionHandle}`,
      },
    });
    assert.equal(identitiesResponse.statusCode, 200);
    assert.equal(identitiesResponse.json().length, 1);
    assert.deepEqual(identitiesResponse.json()[0].roles, ["organization_owner"]);

    const switchResponse = await app.inject({
      method: "POST",
      url: "/v1/auth/session/active-identity",
      headers: {
        "x-teamops-web-admin-auth": `session ${response.json().sessionHandle}`,
      },
      payload: {
        membershipId: identitiesResponse.json()[0].membershipId,
        role: "organization_owner",
      },
    });
    assert.equal(switchResponse.statusCode, 204);
  } finally {
    await app.close();
    await db.end();
  }
});

test("test login is blocked when the active membership has no assigned roles", async () => {
  const { app, db, workspaceId } = await createSeededAuthContext({
    includeActiveMember: true,
  });

  try {
    await db.query(
      `
        update members
        set roles = array['__none__']::text[]
        where workspace_id = $1
          and lower(email) = lower($2)
      `,
      [workspaceId, "owner@example.com"],
    );

    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/test-login",
      payload: {
        organizationSlug: "pilot-customer-demo",
        email: "owner@example.com",
        returnTo: "/",
      },
    });

    assert.equal(response.statusCode, 403);
    assert.equal(response.json().error.code, "OIDC_MEMBERSHIP_NO_ROLES");
    assert.equal(response.json().error.message, "No permission is assigned to this account");
  } finally {
    await app.close();
    await db.end();
  }
});

test("active session role changes workspace overview permissions", async () => {
  const { app, db, workspaceId } = await createSeededAuthContext({
    includeActiveMember: true,
  });

  try {
    await db.query(
      `
        update members
        set role = 'workspace_admin',
            roles = array['workspace_admin', 'developer']
        where workspace_id = $1
          and lower(email) = lower($2)
      `,
      [workspaceId, "owner@example.com"],
    );

    const loginResponse = await app.inject({
      method: "POST",
      url: "/v1/auth/test-login",
      payload: {
        organizationSlug: "pilot-customer-demo",
        email: "owner@example.com",
        returnTo: "/",
      },
    });

    assert.equal(loginResponse.statusCode, 200);
    const sessionHandle = loginResponse.json().sessionHandle as string;

    const identitiesResponse = await app.inject({
      method: "GET",
      url: "/v1/auth/session/identities",
      headers: {
        "x-teamops-web-admin-auth": `session ${sessionHandle}`,
      },
    });

    assert.equal(identitiesResponse.statusCode, 200);
    assert.deepEqual(identitiesResponse.json()[0].roles, ["workspace_admin", "developer"]);

    const switchResponse = await app.inject({
      method: "POST",
      url: "/v1/auth/session/active-identity",
      headers: {
        "x-teamops-web-admin-auth": `session ${sessionHandle}`,
      },
      payload: {
        membershipId: identitiesResponse.json()[0].membershipId,
        role: "developer",
      },
    });

    assert.equal(switchResponse.statusCode, 204);

    const overviewResponse = await app.inject({
      method: "GET",
      url: `/v1/workspaces/${workspaceId}/home-overview`,
      headers: {
        "x-teamops-web-admin-auth": `session ${sessionHandle}`,
      },
    });

    assert.equal(overviewResponse.statusCode, 200);
    assert.equal(overviewResponse.json().permissions.providers, false);
    assert.equal(overviewResponse.json().permissions.members, false);
    assert.equal(overviewResponse.json().permissions.selfServeVirtualKeys, true);
  } finally {
    await app.close();
    await db.end();
  }
});

test("workspace access returns 403 and preserves the active identity when the workspace does not match", async () => {
  const { app, db, workspaceId, organizationId } = await createSeededAuthContext({
    includeActiveMember: true,
  });
  const secondWorkspaceId = "33333333-3333-4333-8333-333333333333";

  try {
    await db.query(
      `
        insert into workspaces (id, organization_id, slug, name)
        values ($1, $2, $3, $4)
      `,
      [secondWorkspaceId, organizationId, "platform-ops", "Platform Ops"],
    );
    await db.query(
      `
        insert into members (workspace_id, email, name, role, status)
        values ($1, $2, $3, $4, 'active')
      `,
      [secondWorkspaceId, "owner@example.com", "Owner", "workspace_admin"],
    );

    const loginResponse = await app.inject({
      method: "POST",
      url: "/v1/auth/test-login",
      payload: {
        organizationSlug: "pilot-customer-demo",
        email: "owner@example.com",
        returnTo: "/",
      },
    });

    assert.equal(loginResponse.statusCode, 200);
    const sessionHandle = loginResponse.json().sessionHandle as string;

    const identitiesResponse = await app.inject({
      method: "GET",
      url: "/v1/auth/session/identities",
      headers: {
        "x-teamops-web-admin-auth": `session ${sessionHandle}`,
      },
    });

    assert.equal(identitiesResponse.statusCode, 200);
    const identities = identitiesResponse.json() as Array<{
      membershipId: string;
      workspaceId: string;
      roles: string[];
    }>;
    const firstIdentity = identities.find((identity) => identity.workspaceId === workspaceId);
    const secondIdentity = identities.find((identity) => identity.workspaceId === secondWorkspaceId);
    assert.ok(firstIdentity);
    assert.ok(secondIdentity);

    const switchResponse = await app.inject({
      method: "POST",
      url: "/v1/auth/session/active-identity",
      headers: {
        "x-teamops-web-admin-auth": `session ${sessionHandle}`,
      },
      payload: {
        membershipId: firstIdentity.membershipId,
        role: firstIdentity.roles[0],
      },
    });

    assert.equal(switchResponse.statusCode, 204);

    const overviewResponse = await app.inject({
      method: "GET",
      url: `/v1/workspaces/${secondWorkspaceId}/home-overview`,
      headers: {
        "x-teamops-web-admin-auth": `session ${sessionHandle}`,
      },
    });

    assert.equal(overviewResponse.statusCode, 403);

    const sessionResponse = await app.inject({
      method: "GET",
      url: "/v1/auth/session",
      headers: {
        "x-teamops-web-admin-auth": `session ${sessionHandle}`,
      },
    });

    assert.equal(sessionResponse.statusCode, 200);
    assert.equal(sessionResponse.json().activeMembershipId, firstIdentity.membershipId);
    assert.equal(sessionResponse.json().activeRole, firstIdentity.roles[0]);
  } finally {
    await app.close();
    await db.end();
  }
});

test("session identity switching can move across organizations", async () => {
  const { app, db, organizationId, workspaceId } = await createSeededAuthContext({
    includeActiveMember: true,
  });
  const secondOrganizationId = "44444444-4444-4444-8444-444444444444";
  const secondWorkspaceId = "55555555-5555-4555-8555-555555555555";

  try {
    await db.query(
      `
        insert into organizations (id, slug, name)
        values ($1, $2, $3)
      `,
      [secondOrganizationId, "qa-delete-org", "QA Delete Org"],
    );
    await db.query(
      `
        insert into workspaces (id, organization_id, slug, name)
        values ($1, $2, $3, $4)
      `,
      [secondWorkspaceId, secondOrganizationId, "qa-double-ws", "QA Double WS"],
    );
    await db.query(
      `
        insert into members (workspace_id, email, name, role, status)
        values ($1, $2, $3, $4, 'active')
      `,
      [secondWorkspaceId, "owner@example.com", "Owner", "workspace_admin"],
    );

    const loginResponse = await app.inject({
      method: "POST",
      url: "/v1/auth/test-login",
      payload: {
        organizationSlug: "pilot-customer-demo",
        email: "owner@example.com",
        returnTo: "/",
      },
    });

    assert.equal(loginResponse.statusCode, 200);
    const sessionHandle = loginResponse.json().sessionHandle as string;

    const workspaceOptionsResponse = await app.inject({
      method: "GET",
      url: "/v1/workspace-options",
      headers: {
        "x-teamops-web-admin-auth": `session ${sessionHandle}`,
      },
    });

    assert.equal(workspaceOptionsResponse.statusCode, 200);
    const workspaceOptions = workspaceOptionsResponse.json() as {
      items: Array<{ id: string; organizationName: string; name: string }>;
    };

    assert.deepEqual(
      workspaceOptions.items.map((workspace) => ({
        id: workspace.id,
        organizationName: workspace.organizationName,
        name: workspace.name,
      })),
      [
        {
          id: secondWorkspaceId,
          organizationName: "QA Delete Org",
          name: "QA Double WS",
        },
        {
          id: workspaceId,
          organizationName: "Pilot Customer Demo",
          name: "Finance Audit Pilot",
        },
      ],
    );

    const identitiesResponse = await app.inject({
      method: "GET",
      url: "/v1/auth/session/identities",
      headers: {
        "x-teamops-web-admin-auth": `session ${sessionHandle}`,
      },
    });

    assert.equal(identitiesResponse.statusCode, 200);
    const identities = identitiesResponse.json() as Array<{
      membershipId: string;
      workspaceId: string;
      roles: string[];
    }>;
    const secondIdentity = identities.find((identity) => identity.workspaceId === secondWorkspaceId);
    assert.ok(secondIdentity);

    const switchResponse = await app.inject({
      method: "POST",
      url: "/v1/auth/session/active-identity",
      headers: {
        "x-teamops-web-admin-auth": `session ${sessionHandle}`,
      },
      payload: {
        membershipId: secondIdentity.membershipId,
        role: secondIdentity.roles[0],
      },
    });

    assert.equal(switchResponse.statusCode, 204);

    const sessionResponse = await app.inject({
      method: "GET",
      url: "/v1/auth/session",
      headers: {
        "x-teamops-web-admin-auth": `session ${sessionHandle}`,
      },
    });

    assert.equal(sessionResponse.statusCode, 200);
    assert.equal(sessionResponse.json().organizationSlug, "qa-delete-org");
    assert.equal(sessionResponse.json().activeMembershipId, secondIdentity.membershipId);

    const repeatedSessionResponse = await app.inject({
      method: "GET",
      url: "/v1/auth/session",
      headers: {
        "x-teamops-web-admin-auth": `session ${sessionHandle}`,
      },
    });

    assert.equal(repeatedSessionResponse.statusCode, 200);
    assert.equal(repeatedSessionResponse.json().organizationSlug, "qa-delete-org");
    assert.equal(repeatedSessionResponse.json().activeMembershipId, secondIdentity.membershipId);
    assert.notEqual(organizationId, secondOrganizationId);
  } finally {
    await app.close();
    await db.end();
  }
});

test("developer-scoped home and usage routes only expose the member's own data", async () => {
  const { app, db, workspaceId } = await createSeededAuthContext({
    includeActiveMember: false,
  });
  const developerMemberId = "6b6b6b6b-1111-4111-8111-111111111111";
  const teammateMemberId = "6b6b6b6b-2222-4222-8222-222222222222";
  const projectId = "7c7c7c7c-1111-4111-8111-111111111111";
  const ownVirtualKeyId = "8d8d8d8d-1111-4111-8111-111111111111";
  const teammateVirtualKeyId = "8d8d8d8d-2222-4222-8222-222222222222";
  const ownUsageEventId = "9e9e9e9e-1111-4111-8111-111111111111";
  const teammateUsageEventId = "9e9e9e9e-2222-4222-8222-222222222222";
  const now = Date.now();
  const ownCreatedAt = new Date(now - 60 * 60 * 1000).toISOString();
  const teammateCreatedAt = new Date(now - 2 * 60 * 60 * 1000).toISOString();
  const expiresAt = new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString();

  try {
    await db.query(
      `
        insert into members (id, workspace_id, email, name, role, status)
        values
          ($1, $2, $3, $4, 'developer', 'active'),
          ($5, $2, $6, $7, 'developer', 'active')
      `,
      [
        developerMemberId,
        workspaceId,
        "developer@example.com",
        "Developer",
        teammateMemberId,
        "teammate@example.com",
        "Teammate",
      ],
    );
    await db.query(
      `
        insert into projects (id, workspace_id, slug, name)
        values ($1, $2, $3, $4)
      `,
      [projectId, workspaceId, "developer-project", "Developer Project"],
    );
    await db.query(
      `
        insert into member_project_assignments (member_id, project_id)
        values ($1, $2), ($3, $2)
      `,
      [developerMemberId, projectId, teammateMemberId],
    );
    await db.query(
      `
        insert into virtual_keys (
          id,
          workspace_id,
          project_id,
          label,
          owner,
          key_prefix,
          key_hash,
          scopes,
          expires_at,
          issuance_mode,
          issued_by_member_id,
          created_at
        )
        values
          ($1, $2, $3, $4, $5, $6, $7, '[]'::jsonb, $8::timestamptz, 'self_serve', $9, $10::timestamptz),
          ($11, $2, $3, $12, $13, $14, $15, '[]'::jsonb, $8::timestamptz, 'self_serve', $16, $17::timestamptz)
      `,
      [
        ownVirtualKeyId,
        workspaceId,
        projectId,
        "developer-key",
        "developer@example.com",
        "teamops_vk_dev_own",
        "hash_dev_own",
        expiresAt,
        developerMemberId,
        ownCreatedAt,
        teammateVirtualKeyId,
        "teammate-key",
        "teammate@example.com",
        "teamops_vk_dev_team",
        "hash_dev_team",
        teammateMemberId,
        teammateCreatedAt,
      ],
    );
    await db.query(
      `
        insert into usage_events (
          id,
          workspace_id,
          project_id,
          virtual_key_id,
          provider,
          model,
          prompt_tokens,
          completion_tokens,
          cost_usd,
          status,
          metadata,
          created_at
        )
        values
          ($1, $2, $3, $4, 'openai', 'gpt-4.1-mini', 120, 30, 1.25, 'success', '{}'::jsonb, $5::timestamptz),
          ($6, $2, $3, $7, 'openai', 'gpt-4.1-mini', 300, 90, 3.5, 'success', '{}'::jsonb, $8::timestamptz)
      `,
      [
        ownUsageEventId,
        workspaceId,
        projectId,
        ownVirtualKeyId,
        ownCreatedAt,
        teammateUsageEventId,
        teammateVirtualKeyId,
        teammateCreatedAt,
      ],
    );
    await db.query(
      `
        insert into audit_logs (
          workspace_id,
          project_id,
          actor_type,
          actor_id,
          action,
          subject_type,
          subject_id,
          payload,
          created_at
        )
        values
          ($1, $2, 'member', $3, 'virtual-key.created', 'virtual-key', $4, '{}'::jsonb, $5::timestamptz),
          ($1, $2, 'member', $6, 'virtual-key.created', 'virtual-key', $7, '{}'::jsonb, $8::timestamptz)
      `,
      [
        workspaceId,
        projectId,
        "developer@example.com",
        ownVirtualKeyId,
        ownCreatedAt,
        "teammate@example.com",
        teammateVirtualKeyId,
        teammateCreatedAt,
      ],
    );

    const loginResponse = await app.inject({
      method: "POST",
      url: "/v1/auth/test-login",
      payload: {
        organizationSlug: "pilot-customer-demo",
        email: "developer@example.com",
        returnTo: "/",
      },
    });

    assert.equal(loginResponse.statusCode, 200);
    const sessionHandle = loginResponse.json().sessionHandle as string;
    const sessionHeaders = {
      "x-teamops-web-admin-auth": `session ${sessionHandle}`,
    };

    const homeSnapshotResponse = await app.inject({
      method: "GET",
      url: `/v1/workspaces/${workspaceId}/home-snapshot`,
      headers: sessionHeaders,
    });
    assert.equal(homeSnapshotResponse.statusCode, 200);
    assert.equal(homeSnapshotResponse.json().overview.usageSummary.totalEvents, 1);
    assert.equal(homeSnapshotResponse.json().overview.usageSummary.totalCostUsd, 1.25);
    assert.equal(homeSnapshotResponse.json().virtualKeys.summary.active, 1);
    assert.equal(homeSnapshotResponse.json().recentUsage.items.length, 1);
    assert.equal(homeSnapshotResponse.json().recentUsage.items[0].id, ownUsageEventId);
    assert.equal(homeSnapshotResponse.json().recentAudit.items.length, 1);
    assert.equal(homeSnapshotResponse.json().recentAudit.items[0].actorId, "developer@example.com");

    const usageSummaryResponse = await app.inject({
      method: "GET",
      url: `/v1/usage-events/summary?workspaceId=${workspaceId}`,
      headers: sessionHeaders,
    });
    assert.equal(usageSummaryResponse.statusCode, 200);
    assert.equal(usageSummaryResponse.json().totalEvents, 1);
    assert.equal(usageSummaryResponse.json().totalCostUsd, 1.25);

    const usageListResponse = await app.inject({
      method: "GET",
      url: `/v1/usage-events?workspaceId=${workspaceId}&limit=10&offset=0`,
      headers: sessionHeaders,
    });
    assert.equal(usageListResponse.statusCode, 200);
    assert.equal(usageListResponse.json().items.length, 1);
    assert.equal(usageListResponse.json().items[0].id, ownUsageEventId);

    const teammateUsageDetailResponse = await app.inject({
      method: "GET",
      url: `/v1/usage-events/${teammateUsageEventId}`,
      headers: sessionHeaders,
    });
    assert.equal(teammateUsageDetailResponse.statusCode, 403);

    const virtualKeysResponse = await app.inject({
      method: "GET",
      url: `/v1/virtual-keys?workspaceId=${workspaceId}&limit=10&offset=0`,
      headers: sessionHeaders,
    });
    assert.equal(virtualKeysResponse.statusCode, 200);
    assert.equal(virtualKeysResponse.json().items.length, 1);
    assert.equal(virtualKeysResponse.json().items[0].id, ownVirtualKeyId);

    const auditLogsResponse = await app.inject({
      method: "GET",
      url: `/v1/audit-logs?workspaceId=${workspaceId}&limit=10&offset=0`,
      headers: sessionHeaders,
    });
    assert.equal(auditLogsResponse.statusCode, 200);
    assert.equal(auditLogsResponse.json().items.length, 1);
    assert.equal(auditLogsResponse.json().items[0].actorId, "developer@example.com");
  } finally {
    await app.close();
    await db.end();
  }
});
