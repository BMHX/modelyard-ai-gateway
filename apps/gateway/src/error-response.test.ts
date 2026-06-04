import test from "node:test";
import assert from "node:assert/strict";

import { buildGatewayErrorBody } from "./error-response.js";

test("buildGatewayErrorBody returns Anthropic-compatible error payloads", () => {
  assert.deepEqual(
    buildGatewayErrorBody({
      protocol: "anthropic",
      statusCode: 401,
      message: "Invalid virtual key",
      requestId: "req_123",
      reason: "invalid_virtual_key",
    }),
    {
      type: "error",
      error: {
        type: "authentication_error",
        code: "teamops_invalid_virtual_key",
        message: "Invalid virtual key",
      },
      request_id: "req_123",
    },
  );
});

test("buildGatewayErrorBody returns OpenAI-compatible error payloads", () => {
  assert.deepEqual(
    buildGatewayErrorBody({
      protocol: "openai-compatible",
      statusCode: 403,
      message: "Budget exceeded",
      requestId: "req_456",
      reason: "budget_hard_limit_exceeded",
    }),
    {
      error: {
        message: "Budget exceeded",
        type: "permission_error",
        param: null,
        code: "teamops_budget_hard_limit_exceeded",
      },
    },
  );
});
