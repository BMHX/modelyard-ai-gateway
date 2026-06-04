import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export type RequestTrace = {
  correlationId: string;
  requestId: string;
  sourceRequestId: string;
};

const requestTraceStorage = new AsyncLocalStorage<RequestTrace>();

function getTrimmedHeaderValue(headers: Headers, name: string) {
  const value = headers.get(name)?.trim();
  return value || null;
}

export function createRequestTrace(headers: Headers) {
  const requestId = getTrimmedHeaderValue(headers, "x-request-id") ?? `web-admin_${randomUUID()}`;
  const sourceRequestId =
    getTrimmedHeaderValue(headers, "x-source-request-id") ??
    getTrimmedHeaderValue(headers, "x-request-id") ??
    requestId;
  const correlationId =
    getTrimmedHeaderValue(headers, "x-correlation-id") ?? sourceRequestId;

  return {
    requestId,
    sourceRequestId,
    correlationId,
  } satisfies RequestTrace;
}

export function getCurrentRequestTrace() {
  return requestTraceStorage.getStore() ?? null;
}

export function runWithRequestTrace<T>(headers: Headers, run: () => Promise<T>): Promise<T>;
export function runWithRequestTrace<T>(headers: Headers, run: () => T): T;
export function runWithRequestTrace<T>(headers: Headers, run: () => Promise<T> | T) {
  return requestTraceStorage.run(createRequestTrace(headers), run);
}
