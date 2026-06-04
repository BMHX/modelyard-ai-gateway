import assert from "node:assert/strict";
import test from "node:test";

import { buildPromptInspectionRelationshipModel } from "./prompt-inspection-relationships";

test("relationship helper builds one-hop investigation nodes with stable links", () => {
  const result = buildPromptInspectionRelationshipModel({
    locale: "en",
    inspection: {
      id: "inspection-1",
      requestId: "req_123",
      workspaceId: "workspace_1",
      projectId: "project_1",
      environmentId: "environment_1",
      virtualKeyId: "key_1",
      providerConnectionId: "provider_connection_1",
    },
    linkedUsageEvent: {
      id: "usage_1",
    },
    projectName: "Payments API",
    environmentName: "Production",
    environmentRuntime: "nodejs20",
    virtualKeyLabel: "Production deploy key",
    providerConnectionLabel: "Anthropic primary",
    returnTo: "/prompt-inspections?workspaceId=workspace_1&inspectionId=inspection-1",
  });

  assert.equal(result.center.kind, "inspection");
  assert.equal(result.center.value, "req_123");

  assert.deepEqual(
    result.nodes.map((node) => node.kind),
    ["usage-event", "virtual-key", "provider-connection", "project", "environment"],
  );

  assert.equal(
    result.nodes[0]?.href,
    "/usage-events/usage_1?returnTo=%2Fprompt-inspections%3FworkspaceId%3Dworkspace_1%26inspectionId%3Dinspection-1",
  );
  assert.equal(
    result.nodes[1]?.href,
    "/usage-events?workspaceId=workspace_1&virtualKeyId=key_1&returnTo=%2Fprompt-inspections%3FworkspaceId%3Dworkspace_1%26inspectionId%3Dinspection-1",
  );
  assert.equal(
    result.nodes[2]?.href,
    "/usage-events?workspaceId=workspace_1&providerConnectionId=provider_connection_1&returnTo=%2Fprompt-inspections%3FworkspaceId%3Dworkspace_1%26inspectionId%3Dinspection-1",
  );
  assert.equal(result.nodes[3]?.value, "Payments API");
  assert.equal(result.nodes[3]?.meta, "project_1");
  assert.equal(result.nodes[4]?.value, "Production");
  assert.equal(result.nodes[4]?.meta, "nodejs20");
});

test("relationship helper falls back to ids and omits missing nodes", () => {
  const result = buildPromptInspectionRelationshipModel({
    locale: "zh",
    inspection: {
      id: "inspection-2",
      requestId: "req_456",
      workspaceId: "workspace_2",
      projectId: null,
      environmentId: "environment_2",
      virtualKeyId: null,
      providerConnectionId: "provider_connection_2",
    },
    linkedUsageEvent: null,
    environmentName: null,
    providerConnectionLabel: "",
    returnTo: "/prompt-inspections?workspaceId=workspace_2&inspectionId=inspection-2",
  });

  assert.deepEqual(
    result.nodes.map((node) => node.kind),
    ["provider-connection", "environment"],
  );
  assert.equal(result.nodes[0]?.value, "provider_connection_2");
  assert.equal(result.nodes[0]?.meta, null);
  assert.equal(result.nodes[1]?.value, "environment_2");
});
