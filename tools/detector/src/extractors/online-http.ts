import { matchHeaderSignals, matchHealthSignals, matchRouteSignals, matchTextSignals } from "../matchers.js";
import type { DetectorTarget, ExtractionResult } from "../types.js";

type ProbeDefinition = {
  routePath: string;
  init?: RequestInit;
};

const probeDefinitions: ProbeDefinition[] = [
  { routePath: "/" },
  { routePath: "/api/healthz" },
  { routePath: "/healthz" },
  { routePath: "/v1/models" },
  { routePath: "/v1/messages", init: { method: "OPTIONS" } },
];

async function readResponsePayload(response: Response) {
  const text = await response.text();
  let json: unknown = null;

  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  return {
    text,
    json,
  };
}

function buildUrl(baseUrl: string, routePath: string) {
  return routePath === "/" ? `${baseUrl}/` : `${baseUrl}${routePath}`;
}

export async function extractOnlineHttp(target: DetectorTarget, timeoutMs: number): Promise<ExtractionResult> {
  const evidence: ExtractionResult["evidence"] = [];
  const errors: string[] = [];

  for (const probe of probeDefinitions) {
    const url = buildUrl(target.value, probe.routePath);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        redirect: "manual",
        signal: controller.signal,
        ...probe.init,
      });
      const payload = await readResponsePayload(response);

      evidence.push(
        ...matchRouteSignals({
          routePath: probe.routePath,
          target: target.value,
          statusCode: response.status,
          targetType: target.type,
        }),
      );
      evidence.push(
        ...matchHeaderSignals({
          headers: response.headers,
          target: target.value,
          routePath: probe.routePath,
          statusCode: response.status,
          targetType: target.type,
        }),
      );
      evidence.push(
        ...matchHealthSignals({
          payload: payload.json,
          target: target.value,
          routePath: probe.routePath,
          statusCode: response.status,
          targetType: target.type,
        }),
      );

      if (payload.text) {
        evidence.push(
          ...matchTextSignals({
            text: payload.text,
            locationKind: "http-body",
            target: target.value,
            pathName: probe.routePath,
            targetType: target.type,
          }),
        );
      }
    } catch (error) {
      errors.push(
        `${probe.routePath} probe failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    target,
    evidence,
    errors,
    artifacts: [],
  };
}
