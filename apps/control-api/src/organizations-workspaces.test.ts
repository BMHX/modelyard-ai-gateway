import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { buildControlApi } from "./app.js";

type DbRow = Record<string, unknown>;

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, " ").trim().toLowerCase();
}

function sortRowsByCreatedAtDesc(rows: DbRow[]) {
  return [...rows].sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)));
}

function sortWorkspaceOptionRows(workspaces: DbRow[], organizations: DbRow[]) {
  return [...workspaces].sort((left, right) => {
    const leftOrganizationCreatedAt =
      organizations.find((organization) => String(organization.id) === String(left.organization_id))?.created_at ?? "";
    const rightOrganizationCreatedAt =
      organizations.find((organization) => String(organization.id) === String(right.organization_id))?.created_at ?? "";

    const organizationOrder = String(rightOrganizationCreatedAt).localeCompare(String(leftOrganizationCreatedAt));
    if (organizationOrder !== 0) {
      return organizationOrder;
    }

    return String(right.created_at).localeCompare(String(left.created_at));
  });
}

function matchesActiveMember(row: DbRow, email: string) {
  return String(row.email).toLowerCase() === email.toLowerCase() && String(row.status) === "active";
}

function createFakeControlApiContext(seed?: {
  organizations?: DbRow[];
  workspaces?: DbRow[];
  members?: DbRow[];
  auditLogs?: DbRow[];
}) {
  const state = {
    organizations: [...(seed?.organizations ?? [])] as DbRow[],
    workspaces: [...(seed?.workspaces ?? [])] as DbRow[],
    members: [...(seed?.members ?? [])] as DbRow[],
    auditLogs: [...(seed?.auditLogs ?? [])] as DbRow[],
  };

  const db = {
    async query(sql: string, values: unknown[] = []) {
      const normalized = normalizeSql(sql);

      if (normalized === "begin" || normalized === "commit" || normalized === "rollback") {
        return {
          rowCount: 0,
          rows: [],
        };
      }

      if (
        normalized.includes("count(w.id)::int as workspace_count") &&
        normalized.includes("from organizations o") &&
        normalized.includes("left join workspaces w on w.organization_id = o.id")
      ) {
        const rows = sortRowsByCreatedAtDesc(state.organizations).map((organization) => ({
          ...organization,
          workspace_count: state.workspaces.filter(
            (workspace) => String(workspace.organization_id) === String(organization.id),
          ).length,
        }));

        return {
          rowCount: rows.length,
          rows,
        };
      }

      if (
        normalized.includes("count(distinct w.id)::int as workspace_count") &&
        normalized.includes("from organizations o") &&
        normalized.includes("inner join workspaces w on w.organization_id = o.id") &&
        normalized.includes("inner join members m on m.workspace_id = w.id")
      ) {
        const memberEmail = String(values[0]);
        const rows = sortRowsByCreatedAtDesc(state.organizations)
          .map((organization) => {
            const visibleWorkspaceCount = state.workspaces.filter((workspace) => {
              if (String(workspace.organization_id) !== String(organization.id)) {
                return false;
              }

              return state.members.some(
                (member) =>
                  String(member.workspace_id) === String(workspace.id) && matchesActiveMember(member, memberEmail),
              );
            }).length;

            return visibleWorkspaceCount
              ? {
                  ...organization,
                  workspace_count: visibleWorkspaceCount,
                }
              : null;
          })
          .filter((row): row is NonNullable<typeof row> => row !== null);

        return {
          rowCount: rows.length,
          rows,
        };
      }

      if (normalized.includes("select * from organizations where id = $1 limit 1")) {
        const organizationId = String(values[0]);
        const row = state.organizations.find((organization) => String(organization.id) === organizationId) ?? null;

        return {
          rowCount: row ? 1 : 0,
          rows: row ? [row] : [],
        };
      }

      if (
        normalized.includes("select m.id from members m") &&
        normalized.includes("inner join workspaces w on w.id = m.workspace_id") &&
        normalized.includes("where w.organization_id = $1") &&
        normalized.includes("and lower(m.email) = lower($2)") &&
        normalized.includes("and m.status = 'active'") &&
        normalized.includes("and m.role = 'organization_owner'") &&
        normalized.includes("limit 1")
      ) {
        const organizationId = String(values[0]);
        const memberEmail = String(values[1]);
        const row =
          state.members.find((member) => {
            if (!matchesActiveMember(member, memberEmail)) {
              return false;
            }

            if (String(member.role) !== "organization_owner") {
              return false;
            }

            const workspace =
              state.workspaces.find((item) => String(item.id) === String(member.workspace_id)) ?? null;

            return workspace ? String(workspace.organization_id) === organizationId : false;
          }) ?? null;

        return {
          rowCount: row ? 1 : 0,
          rows: row ? [{ id: row.id }] : [],
        };
      }

      if (normalized.includes("insert into organizations (name, slug)")) {
        const row = {
          id: randomUUID(),
          name: String(values[0]),
          slug: String(values[1]),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } satisfies DbRow;

        state.organizations.unshift(row);
        return {
          rowCount: 1,
          rows: [row],
        };
      }

      if (
        normalized.includes("update organizations") &&
        normalized.includes("set name = $1, slug = $2, updated_at = now()") &&
        normalized.includes("returning *")
      ) {
        const organizationId = String(values[2]);
        const row = state.organizations.find((organization) => String(organization.id) === organizationId) ?? null;
        if (!row) {
          return {
            rowCount: 0,
            rows: [],
          };
        }

        row.name = String(values[0]);
        row.slug = String(values[1]);
        row.updated_at = new Date().toISOString();

        return {
          rowCount: 1,
          rows: [row],
        };
      }

      if (normalized.includes("delete from organizations") && normalized.includes("returning *")) {
        const organizationId = String(values[0]);
        const rowIndex = state.organizations.findIndex((organization) => String(organization.id) === organizationId);
        if (rowIndex === -1) {
          return {
            rowCount: 0,
            rows: [],
          };
        }

        const [row] = state.organizations.splice(rowIndex, 1);
        state.workspaces = state.workspaces.filter(
          (workspace) => String(workspace.organization_id) !== organizationId,
        );
        state.members = state.members.filter((member) => {
          const workspace = state.workspaces.find((item) => String(item.id) === String(member.workspace_id));
          return workspace !== undefined;
        });

        return {
          rowCount: 1,
          rows: [row],
        };
      }

      if (
        normalized.includes("select w.*, o.name as organization_name from workspaces w") &&
        normalized.includes("inner join organizations o on o.id = w.organization_id") &&
        normalized.includes("order by o.created_at desc, w.created_at desc")
      ) {
        const rows = sortWorkspaceOptionRows(state.workspaces, state.organizations).map((workspace) => {
          const organization =
            state.organizations.find((item) => String(item.id) === String(workspace.organization_id)) ?? null;

          return {
            ...workspace,
            organization_name: organization ? String(organization.name) : "",
          };
        });

        return {
          rowCount: rows.length,
          rows,
        };
      }

      if (
        normalized.includes("select distinct w.*, o.name as organization_name from workspaces w") &&
        normalized.includes("inner join organizations o on o.id = w.organization_id") &&
        normalized.includes("inner join members m on m.workspace_id = w.id") &&
        normalized.includes("order by o.created_at desc, w.created_at desc")
      ) {
        const memberEmail = String(values[0]);
        const rows = sortWorkspaceOptionRows(
          state.workspaces.filter((workspace) =>
            state.members.some(
              (member) =>
                String(member.workspace_id) === String(workspace.id) && matchesActiveMember(member, memberEmail),
            ),
          ),
          state.organizations,
        ).map((workspace) => {
          const organization =
            state.organizations.find((item) => String(item.id) === String(workspace.organization_id)) ?? null;

          return {
            ...workspace,
            organization_name: organization ? String(organization.name) : "",
          };
        });

        return {
          rowCount: rows.length,
          rows,
        };
      }

      if (
        normalized.includes("select * from workspaces where organization_id = $1 order by created_at desc")
      ) {
        const organizationId = String(values[0]);
        const rows = sortRowsByCreatedAtDesc(
          state.workspaces.filter((workspace) => String(workspace.organization_id) === organizationId),
        );

        return {
          rowCount: rows.length,
          rows,
        };
      }

      if (
        normalized.includes("select w.* from workspaces w") &&
        normalized.includes("inner join members m on m.workspace_id = w.id") &&
        normalized.includes("where w.organization_id = $1")
      ) {
        const organizationId = String(values[0]);
        const memberEmail = String(values[1]);
        const rows = sortRowsByCreatedAtDesc(
          state.workspaces.filter((workspace) => {
            if (String(workspace.organization_id) !== organizationId) {
              return false;
            }

            return state.members.some(
              (member) =>
                String(member.workspace_id) === String(workspace.id) && matchesActiveMember(member, memberEmail),
            );
          }),
        );

        return {
          rowCount: rows.length,
          rows,
        };
      }

      if (normalized.includes("select * from workspaces where id = $1 limit 1")) {
        const workspaceId = String(values[0]);
        const row = state.workspaces.find((workspace) => String(workspace.id) === workspaceId) ?? null;

        return {
          rowCount: row ? 1 : 0,
          rows: row ? [row] : [],
        };
      }

      if (normalized.includes("insert into workspaces (organization_id, name, slug)")) {
        const row = {
          id: randomUUID(),
          organization_id: String(values[0]),
          name: String(values[1]),
          slug: String(values[2]),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } satisfies DbRow;

        state.workspaces.unshift(row);
        return {
          rowCount: 1,
          rows: [row],
        };
      }

      if (
        normalized.includes("update workspaces") &&
        normalized.includes("set name = $1, slug = $2, updated_at = now()") &&
        normalized.includes("returning *")
      ) {
        const workspaceId = String(values[2]);
        const row = state.workspaces.find((workspace) => String(workspace.id) === workspaceId) ?? null;
        if (!row) {
          return {
            rowCount: 0,
            rows: [],
          };
        }

        row.name = String(values[0]);
        row.slug = String(values[1]);
        row.updated_at = new Date().toISOString();

        return {
          rowCount: 1,
          rows: [row],
        };
      }

      if (normalized.includes("delete from workspaces") && normalized.includes("returning *")) {
        const workspaceId = String(values[0]);
        const rowIndex = state.workspaces.findIndex((workspace) => String(workspace.id) === workspaceId);
        if (rowIndex === -1) {
          return {
            rowCount: 0,
            rows: [],
          };
        }

        const [row] = state.workspaces.splice(rowIndex, 1);
        state.members = state.members.filter((member) => String(member.workspace_id) !== workspaceId);

        return {
          rowCount: 1,
          rows: [row],
        };
      }

      if (normalized.includes("insert into audit_logs")) {
        const row = {
          id: randomUUID(),
          workspace_id: values[0],
          project_id: values[1],
          environment_id: values[2],
          actor_type: values[3],
          actor_id: values[4],
          action: values[5],
          subject_type: values[6],
          subject_id: values[7],
          payload: JSON.parse(String(values[8])),
          created_at: new Date().toISOString(),
        } satisfies DbRow;

        state.auditLogs.unshift(row);
        return {
          rowCount: 1,
          rows: [row],
        };
      }

      throw new Error(`Unhandled fake DB query in organizations-workspaces.test.ts: ${normalized}`);
    },
  };

  return {
    state,
    context: {
      env: {
        CONTROL_API_ADMIN_TOKEN: "test-admin-token",
      },
      db,
    } as Parameters<typeof buildControlApi>[0],
  };
}

function createAdminHeaders() {
  return {
    authorization: "Bearer test-admin-token",
    "x-actor-type": "service",
    "x-actor-id": "organizations-workspaces-test",
  };
}

test("organization and workspace CRUD flow returns summaries and records audit logs", async () => {
  const { state, context } = createFakeControlApiContext();
  const app = await buildControlApi(context);

  try {
    const adminHeaders = createAdminHeaders();

    const invalidWorkspaceResponse = await app.inject({
      method: "POST",
      url: "/v1/workspaces",
      headers: adminHeaders,
      payload: {
        organizationId: "not-a-uuid",
        name: "Broken Workspace",
      },
    });

    assert.equal(invalidWorkspaceResponse.statusCode, 400);
    assert.match(invalidWorkspaceResponse.json().error.message, /uuid/i);

    const missingOrganizationResponse = await app.inject({
      method: "POST",
      url: "/v1/workspaces",
      headers: adminHeaders,
      payload: {
        organizationId: randomUUID(),
        name: "Ghost Workspace",
      },
    });

    assert.equal(missingOrganizationResponse.statusCode, 404);
    assert.equal(missingOrganizationResponse.json().error.message, "Organization not found");

    const createOrganizationResponse = await app.inject({
      method: "POST",
      url: "/v1/organizations",
      headers: adminHeaders,
      payload: {
        name: "Acme China",
      },
    });

    assert.equal(createOrganizationResponse.statusCode, 201);
    const organization = createOrganizationResponse.json();
    assert.equal(organization.name, "Acme China");
    assert.equal(organization.slug, "acme-china");

    const createWorkspaceResponse = await app.inject({
      method: "POST",
      url: "/v1/workspaces",
      headers: adminHeaders,
      payload: {
        organizationId: organization.id,
        name: "Platform Team",
      },
    });

    assert.equal(createWorkspaceResponse.statusCode, 201);
    const workspace = createWorkspaceResponse.json();
    assert.equal(workspace.organizationId, organization.id);
    assert.equal(workspace.slug, "platform-team");

    const organizationSummaryResponse = await app.inject({
      method: "GET",
      url: "/v1/organizations?includeWorkspaceCounts=1",
      headers: {
        authorization: "Bearer test-admin-token",
      },
    });

    assert.equal(organizationSummaryResponse.statusCode, 200);
    const organizationSummaries = organizationSummaryResponse.json() as {
      items: Array<{ id: string; workspaceCount: number; name: string }>;
    };
    assert.equal(organizationSummaries.items.length, 1);
    assert.equal(organizationSummaries.items[0]?.id, organization.id);
    assert.equal(organizationSummaries.items[0]?.name, "Acme China");
    assert.equal(organizationSummaries.items[0]?.workspaceCount, 1);

    const workspaceOptionsResponse = await app.inject({
      method: "GET",
      url: "/v1/workspace-options",
      headers: {
        authorization: "Bearer test-admin-token",
      },
    });

    assert.equal(workspaceOptionsResponse.statusCode, 200);
    const workspaceOptions = workspaceOptionsResponse.json() as {
      items: Array<{ id: string; organizationName: string; name: string }>;
    };
    assert.equal(workspaceOptions.items.length, 1);
    assert.equal(workspaceOptions.items[0]?.id, workspace.id);
    assert.equal(workspaceOptions.items[0]?.organizationName, "Acme China");
    assert.equal(workspaceOptions.items[0]?.name, "Platform Team");

    const updateOrganizationResponse = await app.inject({
      method: "PATCH",
      url: `/v1/organizations/${organization.id}`,
      headers: adminHeaders,
      payload: {
        name: "Acme Global",
        slug: "acme-global",
      },
    });

    assert.equal(updateOrganizationResponse.statusCode, 200);
    assert.equal(updateOrganizationResponse.json().slug, "acme-global");

    const updateWorkspaceResponse = await app.inject({
      method: "PATCH",
      url: `/v1/workspaces/${workspace.id}`,
      headers: adminHeaders,
      payload: {
        name: "Operations Core",
        slug: "operations-core",
      },
    });

    assert.equal(updateWorkspaceResponse.statusCode, 200);
    assert.equal(updateWorkspaceResponse.json().name, "Operations Core");
    assert.equal(updateWorkspaceResponse.json().slug, "operations-core");

    const listWorkspacesResponse = await app.inject({
      method: "GET",
      url: `/v1/workspaces?organizationId=${organization.id}`,
      headers: {
        authorization: "Bearer test-admin-token",
      },
    });

    assert.equal(listWorkspacesResponse.statusCode, 200);
    const listedWorkspaces = listWorkspacesResponse.json() as {
      items: Array<{ id: string; name: string; slug: string }>;
    };
    assert.equal(listedWorkspaces.items.length, 1);
    assert.equal(listedWorkspaces.items[0]?.id, workspace.id);
    assert.equal(listedWorkspaces.items[0]?.name, "Operations Core");
    assert.equal(listedWorkspaces.items[0]?.slug, "operations-core");

    const deleteWorkspaceResponse = await app.inject({
      method: "DELETE",
      url: `/v1/workspaces/${workspace.id}`,
      headers: adminHeaders,
    });

    assert.equal(deleteWorkspaceResponse.statusCode, 204);

    const deleteOrganizationResponse = await app.inject({
      method: "DELETE",
      url: `/v1/organizations/${organization.id}`,
      headers: adminHeaders,
    });

    assert.equal(deleteOrganizationResponse.statusCode, 204);

    assert.equal(state.organizations.length, 0);
    assert.equal(state.workspaces.length, 0);
    assert.deepEqual(
      state.auditLogs.map((row) => row.action),
      [
        "organization.deleted",
        "workspace.deleted",
        "workspace.updated",
        "organization.updated",
        "workspace.created",
        "organization.created",
      ],
    );
    assert.equal(state.auditLogs[0]?.actor_type, "service");
    assert.equal(state.auditLogs[0]?.actor_id, "organizations-workspaces-test");
    assert.ok(typeof (state.auditLogs[0]?.payload as { requestContext?: unknown })?.requestContext === "object");
  } finally {
    await app.close();
  }
});

test("organization summaries and workspaces stay scoped to the requesting member", async () => {
  const organizationNorthAmericaId = randomUUID();
  const organizationApacId = randomUUID();
  const accessibleWorkspaceId = randomUUID();
  const hiddenWorkspaceId = randomUUID();
  const apacWorkspaceId = randomUUID();
  const memberEmail = "owner@example.com";
  const now = new Date().toISOString();

  const { context } = createFakeControlApiContext({
    organizations: [
      {
        id: organizationNorthAmericaId,
        name: "North America",
        slug: "north-america",
        created_at: "2024-01-01T00:00:00.000Z",
        updated_at: now,
      },
      {
        id: organizationApacId,
        name: "APAC",
        slug: "apac",
        created_at: "2024-02-01T00:00:00.000Z",
        updated_at: now,
      },
    ],
    workspaces: [
      {
        id: accessibleWorkspaceId,
        organization_id: organizationNorthAmericaId,
        name: "Platform",
        slug: "platform",
        created_at: "2024-01-02T00:00:00.000Z",
        updated_at: now,
      },
      {
        id: hiddenWorkspaceId,
        organization_id: organizationNorthAmericaId,
        name: "Finance",
        slug: "finance",
        created_at: "2024-01-03T00:00:00.000Z",
        updated_at: now,
      },
      {
        id: apacWorkspaceId,
        organization_id: organizationApacId,
        name: "Growth",
        slug: "growth",
        created_at: "2024-02-02T00:00:00.000Z",
        updated_at: now,
      },
    ],
    members: [
      {
        id: randomUUID(),
        workspace_id: accessibleWorkspaceId,
        email: memberEmail,
        status: "active",
      },
      {
        id: randomUUID(),
        workspace_id: hiddenWorkspaceId,
        email: memberEmail,
        status: "disabled",
      },
      {
        id: randomUUID(),
        workspace_id: apacWorkspaceId,
        email: memberEmail,
        status: "active",
      },
    ],
  });

  const app = await buildControlApi(context);

  try {
    const organizationSummaryResponse = await app.inject({
      method: "GET",
      url: "/v1/organizations?includeWorkspaceCounts=1",
      headers: {
        "x-member-email": memberEmail,
      },
    });

    assert.equal(organizationSummaryResponse.statusCode, 200);
    const payload = organizationSummaryResponse.json() as {
      items: Array<{ slug: string; workspaceCount: number }>;
    };
    assert.deepEqual(
      Object.fromEntries(payload.items.map((item) => [item.slug, item.workspaceCount])),
      {
        apac: 1,
        "north-america": 1,
      },
    );

    const visibleWorkspacesResponse = await app.inject({
      method: "GET",
      url: `/v1/workspaces?organizationId=${organizationNorthAmericaId}`,
      headers: {
        "x-member-email": memberEmail,
      },
    });

    assert.equal(visibleWorkspacesResponse.statusCode, 200);
    const visibleWorkspaces = visibleWorkspacesResponse.json() as {
      items: Array<{ id: string; slug: string }>;
    };
    assert.deepEqual(
      visibleWorkspaces.items.map((workspace) => ({
        id: workspace.id,
        slug: workspace.slug,
      })),
      [
        {
          id: accessibleWorkspaceId,
          slug: "platform",
        },
      ],
    );

    const workspaceOptionsResponse = await app.inject({
      method: "GET",
      url: "/v1/workspace-options",
      headers: {
        "x-member-email": memberEmail,
      },
    });

    assert.equal(workspaceOptionsResponse.statusCode, 200);
    const workspaceOptions = workspaceOptionsResponse.json() as {
      items: Array<{ id: string; organizationName: string; slug: string }>;
    };
    assert.deepEqual(
      workspaceOptions.items.map((workspace) => ({
        id: workspace.id,
        organizationName: workspace.organizationName,
        slug: workspace.slug,
      })),
      [
        {
          id: apacWorkspaceId,
          organizationName: "APAC",
          slug: "growth",
        },
        {
          id: accessibleWorkspaceId,
          organizationName: "North America",
          slug: "platform",
        },
      ],
    );
  } finally {
    await app.close();
  }
});

test("organization owners can update organization records", async () => {
  const organizationId = randomUUID();
  const workspaceId = randomUUID();
  const memberId = randomUUID();
  const memberEmail = "owner@example.com";
  const now = new Date().toISOString();

  const { state, context } = createFakeControlApiContext({
    organizations: [
      {
        id: organizationId,
        name: "North America",
        slug: "north-america",
        created_at: "2024-01-01T00:00:00.000Z",
        updated_at: now,
      },
    ],
    workspaces: [
      {
        id: workspaceId,
        organization_id: organizationId,
        name: "Platform",
        slug: "platform",
        created_at: "2024-01-02T00:00:00.000Z",
        updated_at: now,
      },
    ],
    members: [
      {
        id: memberId,
        workspace_id: workspaceId,
        email: memberEmail,
        role: "organization_owner",
        status: "active",
        created_at: now,
      },
    ],
  });

  const app = await buildControlApi(context);

  try {
    const response = await app.inject({
      method: "PATCH",
      url: `/v1/organizations/${organizationId}`,
      headers: {
        "x-member-email": memberEmail,
      },
      payload: {
        name: "Global Operations",
        slug: "global-operations",
      },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().name, "Global Operations");
    assert.equal(response.json().slug, "global-operations");
    assert.equal(state.organizations[0]?.name, "Global Operations");
    assert.equal(state.organizations[0]?.slug, "global-operations");
  } finally {
    await app.close();
  }
});
