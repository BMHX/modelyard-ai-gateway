import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { ControlApiContext } from "../context.js";
import { pingDatabase } from "@teamops/database";
import { getRequestCorrelationId, getRequestSourceRequestId } from "../auth.js";

function applyTracingHeaders(request: FastifyRequest, reply: FastifyReply) {
  const correlationId = getRequestCorrelationId(request.headers, request.id) ?? request.id;
  const sourceRequestId = getRequestSourceRequestId(request.headers);
  const exposeHeaders = new Set(
    String(reply.getHeader("access-control-expose-headers") ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value.length > 0),
  );

  reply.header("x-request-id", request.id);
  reply.header("x-correlation-id", correlationId);
  exposeHeaders.add("x-request-id");
  exposeHeaders.add("x-correlation-id");

  if (sourceRequestId) {
    reply.header("x-source-request-id", sourceRequestId);
    exposeHeaders.add("x-source-request-id");
  }

  reply.header("access-control-expose-headers", Array.from(exposeHeaders).join(", "));

  return {
    correlationId,
    sourceRequestId,
  };
}

export async function registerHealthRoutes(app: FastifyInstance, context: ControlApiContext) {
  app.addHook("onSend", async (request, reply, payload) => {
    applyTracingHeaders(request, reply);
    return payload;
  });

  app.get("/healthz", async (request, reply) => {
    await pingDatabase(context.db);

    const trace = applyTracingHeaders(request, reply);

    return {
      service: "control-api",
      status: "ok",
      timestamp: new Date().toISOString(),
      requestId: request.id,
      correlationId: trace.correlationId,
      sourceRequestId: trace.sourceRequestId,
    };
  });
}
