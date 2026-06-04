import test from "node:test";
import assert from "node:assert/strict";

import { buildGatewayResponseHeaders, buildUpstreamResponseHeaders, mergeResponseHeaders } from "./response-headers.js";

test("buildGatewayResponseHeaders includes base request and protocol headers", () => {
  assert.deepEqual(
    buildGatewayResponseHeaders({
      requestId: "req_123",
      protocol: "anthropic",
    }),
    {
      "cache-control": "no-store",
      vary: "authorization, accept, x-provider-connection-id, x-provider-kind, x-teamops-provider",
      "x-content-type-options": "nosniff",
      "x-teamops-request-id": "req_123",
      "x-teamops-gateway-protocol": "anthropic",
    },
  );
});

test("buildGatewayResponseHeaders includes provider and demo headers when available", () => {
  assert.deepEqual(
    buildGatewayResponseHeaders({
      requestId: "req_456",
      protocol: "openai-compatible",
      provider: "openai-compatible",
      providerConnectionId: "conn_456",
      demoMode: true,
    }),
    {
      "cache-control": "no-store",
      vary: "authorization, accept, x-provider-connection-id, x-provider-kind, x-teamops-provider",
      "x-content-type-options": "nosniff",
      "x-teamops-request-id": "req_456",
      "x-teamops-gateway-protocol": "openai-compatible",
      "x-teamops-provider": "openai-compatible",
      "x-teamops-provider-connection-id": "conn_456",
      "x-teamops-demo-mode": "1",
    },
  );
});

test("mergeResponseHeaders prefers later headers", () => {
  assert.deepEqual(
    mergeResponseHeaders(
      {
        "content-type": "application/json",
        "x-teamops-demo-mode": "0",
        vary: "accept, x-provider-kind",
      },
      {
        "x-teamops-demo-mode": "1",
        "x-teamops-request-id": "req_789",
        vary: "authorization, accept",
      },
    ),
    {
      "content-type": "application/json",
      "x-teamops-demo-mode": "1",
      "x-teamops-request-id": "req_789",
      vary: "accept, x-provider-kind, authorization",
    },
  );
});

test("buildUpstreamResponseHeaders exposes normalized upstream debug headers", () => {
  assert.deepEqual(
    buildUpstreamResponseHeaders({
      upstreamStatusCode: 429,
      upstreamRequestId: "req_up_1",
      providerRequestId: "msg_1",
      upstreamContentType: "application/json",
    }),
    {
      "x-teamops-upstream-status": "429",
      "x-teamops-upstream-request-id": "req_up_1",
      "x-teamops-provider-request-id": "msg_1",
      "x-teamops-upstream-content-type": "application/json",
    },
  );
});
