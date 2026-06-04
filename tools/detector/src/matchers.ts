import path from "node:path";

import {
  HEADER_SIGNAL_DEFINITIONS,
  HEALTH_SERVICE_DEFINITIONS,
  PATH_SIGNAL_DEFINITIONS,
  ROUTE_SIGNAL_DEFINITIONS,
  TEXT_SIGNAL_DEFINITIONS,
} from "./catalog.js";
import { createEvidence } from "./normalize.js";
import type {
  DetectorTargetType,
  EvidenceLocation,
  EvidenceLocationKind,
  EvidenceRecord,
  SourceSurface,
} from "./types.js";

function findLineNumber(text: string, pattern: string) {
  const index = text.indexOf(pattern);
  if (index < 0) {
    return null;
  }

  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (text.charCodeAt(cursor) === 10) {
      line += 1;
    }
  }

  return line;
}

function createLocation(kind: EvidenceLocationKind, target: string, pathName?: string | null, details?: string | null, line?: number | null): EvidenceLocation {
  return {
    kind,
    target,
    path: pathName ?? null,
    details: details ?? null,
    line: line ?? null,
  };
}

export function matchTextSignals(args: {
  text: string;
  locationKind: EvidenceLocationKind;
  target: string;
  pathName?: string | null;
  targetType?: DetectorTargetType;
}): EvidenceRecord[] {
  const evidence: EvidenceRecord[] = [];

  for (const definition of TEXT_SIGNAL_DEFINITIONS) {
    for (const pattern of definition.patterns) {
      if (!args.text.includes(pattern)) {
        continue;
      }

      evidence.push(
        createEvidence({
          family: definition.family,
          signal: definition.signal,
          matchedValue: pattern,
          location: createLocation(
            args.locationKind,
            args.target,
            args.pathName,
            definition.signal,
            findLineNumber(args.text, pattern),
          ),
          strength: pattern === definition.signal ? 0.96 : 0.82,
          rarity: definition.rarity,
          tamperCost: definition.tamperCost,
          baseWeight: definition.baseWeight,
          independenceKey: definition.independenceKey,
          sourceSurface: definition.sourceSurface,
          metadata: {
            generic: definition.generic,
            matchedPattern: pattern,
            targetType: args.targetType,
          },
        }),
      );
      break;
    }
  }

  return evidence;
}

export function matchPathSignals(args: {
  absolutePath: string;
  rootTarget: string;
  targetType?: DetectorTargetType;
}): EvidenceRecord[] {
  const normalizedPath = args.absolutePath.split(path.sep).join("/");
  const evidence: EvidenceRecord[] = [];

  for (const definition of PATH_SIGNAL_DEFINITIONS) {
    const basenameMatch = definition.basenames?.some((name) => path.basename(args.absolutePath) === name) ?? false;
    const fragmentMatch = definition.pathFragments?.some((fragment) => normalizedPath.includes(fragment)) ?? false;
    if (!basenameMatch && !fragmentMatch) {
      continue;
    }

    evidence.push(
      createEvidence({
        family: definition.family,
        signal: definition.signal,
        matchedValue: basenameMatch ? path.basename(args.absolutePath) : definition.signal,
        location: createLocation("file-path", args.rootTarget, normalizedPath, definition.signal),
        strength: basenameMatch ? 0.88 : 0.84,
        rarity: definition.rarity,
        tamperCost: definition.tamperCost,
        baseWeight: definition.baseWeight,
        independenceKey: definition.independenceKey,
        sourceSurface: definition.sourceSurface,
        metadata: {
          targetType: args.targetType,
        },
      }),
    );
  }

  return evidence;
}

export function matchHeaderSignals(args: {
  headers: Headers | Record<string, string>;
  target: string;
  routePath: string;
  statusCode: number;
  targetType?: DetectorTargetType;
}): EvidenceRecord[] {
  const evidence: EvidenceRecord[] = [];
  const normalized = args.headers instanceof Headers ? args.headers : new Headers(args.headers);

  for (const definition of HEADER_SIGNAL_DEFINITIONS) {
    const value = normalized.get(definition.headerName);
    if (!value) {
      continue;
    }

    evidence.push(
      createEvidence({
        family: definition.family,
        signal: definition.signal,
        matchedValue: value,
        location: createLocation("http-header", args.target, args.routePath, definition.headerName),
        strength: 0.99,
        rarity: definition.rarity,
        tamperCost: definition.tamperCost,
        baseWeight: definition.baseWeight,
        independenceKey: definition.independenceKey,
        sourceSurface: definition.sourceSurface,
        metadata: {
          statusCode: args.statusCode,
          targetType: args.targetType,
        },
      }),
    );
  }

  return evidence;
}

export function matchHealthSignals(args: {
  payload: unknown;
  target: string;
  routePath: string;
  statusCode: number;
  targetType?: DetectorTargetType;
}): EvidenceRecord[] {
  if (!args.payload || typeof args.payload !== "object" || Array.isArray(args.payload)) {
    return [];
  }

  const service = typeof (args.payload as { service?: unknown }).service === "string"
    ? String((args.payload as { service?: unknown }).service)
    : null;

  if (!service) {
    return [];
  }

  return HEALTH_SERVICE_DEFINITIONS.filter((definition) => definition.service === service).map((definition) =>
    createEvidence({
      family: "healthIdentity",
      signal: `service=${definition.service}`,
      matchedValue: definition.service,
      location: createLocation("http-body", args.target, args.routePath, "health payload"),
      strength: 0.98,
      rarity: definition.rarity,
      tamperCost: definition.tamperCost,
      baseWeight: definition.baseWeight,
      independenceKey: "health-service-identity",
      sourceSurface: definition.sourceSurface,
      metadata: {
        statusCode: args.statusCode,
        targetType: args.targetType,
      },
    }),
  );
}

export function matchRouteSignals(args: {
  routePath: string;
  target: string;
  statusCode: number;
  locationKind?: "http-route" | "browser-request";
  targetType?: DetectorTargetType;
}): EvidenceRecord[] {
  const locationKind = args.locationKind ?? "http-route";

  return ROUTE_SIGNAL_DEFINITIONS.filter((definition) => args.routePath.includes(definition.route))
    .filter(() => args.statusCode !== 404)
    .map((definition) =>
      createEvidence({
        family: "routeTopology",
        signal: definition.signal,
        matchedValue: args.routePath,
        location: createLocation(locationKind, args.target, args.routePath, `status=${args.statusCode}`),
        strength: args.statusCode >= 200 && args.statusCode < 500 ? 0.74 : 0.52,
        rarity: definition.rarity,
        tamperCost: definition.tamperCost,
        baseWeight: definition.baseWeight,
        independenceKey: definition.independenceKey,
        sourceSurface: definition.sourceSurface,
        metadata: {
          statusCode: args.statusCode,
          targetType: args.targetType,
        },
      }),
    );
}

export function inferSurfaceFromUrl(urlString: string): SourceSurface {
  for (const definition of ROUTE_SIGNAL_DEFINITIONS) {
    if (urlString.includes(definition.route)) {
      return definition.sourceSurface;
    }
  }

  return "unknown";
}
