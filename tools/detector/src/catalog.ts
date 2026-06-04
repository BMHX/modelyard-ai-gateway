import type { EvidenceFamily, SourceSurface } from "./types.js";

export interface TextSignalDefinition {
  signal: string;
  family: EvidenceFamily;
  patterns: string[];
  baseWeight: number;
  rarity: number;
  tamperCost: number;
  independenceKey: string;
  sourceSurface: SourceSurface;
  generic?: boolean;
}

export interface HeaderSignalDefinition {
  signal: string;
  headerName: string;
  family: EvidenceFamily;
  baseWeight: number;
  rarity: number;
  tamperCost: number;
  independenceKey: string;
  sourceSurface: SourceSurface;
}

export interface PathSignalDefinition {
  signal: string;
  family: EvidenceFamily;
  basenames?: string[];
  pathFragments?: string[];
  baseWeight: number;
  rarity: number;
  tamperCost: number;
  independenceKey: string;
  sourceSurface: SourceSurface;
}

export interface HealthServiceDefinition {
  service: "gateway" | "control-api" | "web-admin";
  baseWeight: number;
  rarity: number;
  tamperCost: number;
  sourceSurface: SourceSurface;
}

export interface RouteSignalDefinition {
  signal: string;
  route: string;
  baseWeight: number;
  rarity: number;
  tamperCost: number;
  independenceKey: string;
  sourceSurface: SourceSurface;
}

export const FAMILY_CAPS: Record<EvidenceFamily, number> = {
  runtimeHeader: 35,
  healthIdentity: 15,
  containerMetadata: 20,
  manifestFingerprint: 10,
  routeTopology: 10,
  semanticWatermark: 10,
};

export const STRONG_FAMILIES = new Set<EvidenceFamily>([
  "runtimeHeader",
  "healthIdentity",
  "containerMetadata",
]);

const gatewayHeaderSignals = [
  "x-teamops-request-id",
  "x-teamops-gateway-protocol",
  "x-teamops-provider",
  "x-teamops-provider-connection-id",
  "x-teamops-demo-mode",
  "x-teamops-upstream-status",
  "x-teamops-upstream-request-id",
  "x-teamops-provider-request-id",
  "x-teamops-upstream-content-type",
] as const;

const controlApiHeaderSignals = [
  "x-teamops-report-approval-status",
  "x-teamops-report-approval-mode",
  "x-teamops-report-signed-snapshot",
  "x-teamops-report-watermark",
  "x-teamops-report-retention-days",
  "x-teamops-private-attestation",
  "x-teamops-attestation-bundle-id",
  "x-teamops-attestation-bundle-sha256",
  "x-teamops-lineage-id",
] as const;

export const HEADER_SIGNAL_DEFINITIONS: HeaderSignalDefinition[] = [
  ...gatewayHeaderSignals.map((headerName) => ({
    signal: headerName,
    headerName,
    family: "runtimeHeader" as const,
    baseWeight:
      headerName === "x-teamops-gateway-protocol"
        ? 28
        : headerName === "x-teamops-provider" || headerName === "x-teamops-provider-connection-id"
          ? 18
          : 16,
    rarity: 0.98,
    tamperCost: headerName === "x-teamops-gateway-protocol" ? 0.82 : 0.72,
    independenceKey: headerName,
    sourceSurface: "gateway" as const,
  })),
  ...controlApiHeaderSignals.map((headerName) => ({
    signal: headerName,
    headerName,
    family: "runtimeHeader" as const,
    baseWeight:
      headerName === "x-teamops-report-watermark" || headerName === "x-teamops-private-attestation"
        ? 20
        : headerName === "x-teamops-lineage-id" || headerName === "x-teamops-attestation-bundle-id"
          ? 16
          : 14,
    rarity: 0.97,
    tamperCost:
      headerName === "x-teamops-report-watermark" || headerName === "x-teamops-private-attestation"
        ? 0.84
        : headerName === "x-teamops-lineage-id" || headerName === "x-teamops-attestation-bundle-id"
          ? 0.78
          : 0.71,
    independenceKey: headerName,
    sourceSurface: "control-api" as const,
  })),
];

export const HEALTH_SERVICE_DEFINITIONS: HealthServiceDefinition[] = [
  {
    service: "gateway",
    baseWeight: 17,
    rarity: 0.94,
    tamperCost: 0.78,
    sourceSurface: "gateway",
  },
  {
    service: "control-api",
    baseWeight: 17,
    rarity: 0.94,
    tamperCost: 0.78,
    sourceSurface: "control-api",
  },
  {
    service: "web-admin",
    baseWeight: 15,
    rarity: 0.9,
    tamperCost: 0.7,
    sourceSurface: "web-admin",
  },
];

export const ROUTE_SIGNAL_DEFINITIONS: RouteSignalDefinition[] = [
  {
    signal: "/v1/messages",
    route: "/v1/messages",
    baseWeight: 3,
    rarity: 0.58,
    tamperCost: 0.55,
    independenceKey: "gateway-route-family",
    sourceSurface: "gateway",
  },
  {
    signal: "/v1/chat/completions",
    route: "/v1/chat/completions",
    baseWeight: 2,
    rarity: 0.42,
    tamperCost: 0.4,
    independenceKey: "gateway-route-family",
    sourceSurface: "gateway",
  },
  {
    signal: "/v1/responses",
    route: "/v1/responses",
    baseWeight: 4,
    rarity: 0.76,
    tamperCost: 0.62,
    independenceKey: "gateway-route-family",
    sourceSurface: "gateway",
  },
  {
    signal: "/v1/models",
    route: "/v1/models",
    baseWeight: 2,
    rarity: 0.32,
    tamperCost: 0.35,
    independenceKey: "gateway-route-family",
    sourceSurface: "gateway",
  },
  {
    signal: "/v1/provider-connections",
    route: "/v1/provider-connections",
    baseWeight: 4,
    rarity: 0.82,
    tamperCost: 0.6,
    independenceKey: "control-api-resource-routes",
    sourceSurface: "control-api",
  },
  {
    signal: "/v1/export-jobs",
    route: "/v1/export-jobs",
    baseWeight: 4,
    rarity: 0.8,
    tamperCost: 0.6,
    independenceKey: "control-api-resource-routes",
    sourceSurface: "control-api",
  },
  {
    signal: "/api/console/",
    route: "/api/console/",
    baseWeight: 4,
    rarity: 0.82,
    tamperCost: 0.58,
    independenceKey: "web-admin-api-console",
    sourceSurface: "web-admin",
  },
  {
    signal: "/api/healthz",
    route: "/api/healthz",
    baseWeight: 3,
    rarity: 0.7,
    tamperCost: 0.55,
    independenceKey: "web-admin-api-console",
    sourceSurface: "web-admin",
  },
];

export const PATH_SIGNAL_DEFINITIONS: PathSignalDefinition[] = [
  {
    signal: "app-build-manifest.json",
    family: "manifestFingerprint",
    basenames: ["app-build-manifest.json"],
    baseWeight: 4,
    rarity: 0.85,
    tamperCost: 0.54,
    independenceKey: "web-admin-manifest-paths",
    sourceSurface: "web-admin",
  },
  {
    signal: "server-reference-manifest.json",
    family: "manifestFingerprint",
    basenames: ["server-reference-manifest.json"],
    baseWeight: 4,
    rarity: 0.85,
    tamperCost: 0.54,
    independenceKey: "web-admin-manifest-paths",
    sourceSurface: "web-admin",
  },
  {
    signal: "/var/lib/teamops/exports",
    family: "containerMetadata",
    pathFragments: ["/var/lib/teamops/exports"],
    baseWeight: 7,
    rarity: 0.95,
    tamperCost: 0.74,
    independenceKey: "teamops-export-dir",
    sourceSurface: "infra/preview",
  },
  {
    signal: "docker-compose.demo.yml",
    family: "containerMetadata",
    basenames: ["docker-compose.demo.yml"],
    baseWeight: 4,
    rarity: 0.88,
    tamperCost: 0.65,
    independenceKey: "teamops-compose-shape",
    sourceSurface: "infra/demo",
  },
  {
    signal: "docker-compose.preview.yml",
    family: "containerMetadata",
    basenames: ["docker-compose.preview.yml"],
    baseWeight: 4,
    rarity: 0.88,
    tamperCost: 0.65,
    independenceKey: "teamops-compose-shape",
    sourceSurface: "infra/preview",
  },
];

export const TEXT_SIGNAL_DEFINITIONS: TextSignalDefinition[] = [
  ...HEADER_SIGNAL_DEFINITIONS.map((definition) => ({
    signal: definition.signal,
    family: definition.family,
    patterns: [definition.headerName],
    baseWeight: Math.max(4, definition.baseWeight - 2),
    rarity: definition.rarity,
    tamperCost: definition.tamperCost,
    independenceKey: definition.independenceKey,
    sourceSurface: definition.sourceSurface,
  })),
  {
    signal: "@teamops/gateway",
    family: "manifestFingerprint",
    patterns: ["@teamops/gateway"],
    baseWeight: 6,
    rarity: 0.95,
    tamperCost: 0.67,
    independenceKey: "@teamops-packages",
    sourceSurface: "gateway",
  },
  {
    signal: "@teamops/contracts",
    family: "manifestFingerprint",
    patterns: ["@teamops/contracts"],
    baseWeight: 5,
    rarity: 0.94,
    tamperCost: 0.65,
    independenceKey: "@teamops-packages",
    sourceSurface: "repo/shared",
  },
  {
    signal: "@teamops/database",
    family: "manifestFingerprint",
    patterns: ["@teamops/database"],
    baseWeight: 5,
    rarity: 0.94,
    tamperCost: 0.65,
    independenceKey: "@teamops-packages",
    sourceSurface: "repo/shared",
  },
  {
    signal: "teamops-demo-app",
    family: "containerMetadata",
    patterns: ["teamops-demo-app", "teamops-demo"],
    baseWeight: 20,
    rarity: 0.98,
    tamperCost: 0.82,
    independenceKey: "teamops-image-names",
    sourceSurface: "infra/demo",
  },
  {
    signal: "teamops-preview-runtime",
    family: "containerMetadata",
    patterns: ["teamops-preview-runtime", "teamops-preview"],
    baseWeight: 20,
    rarity: 0.98,
    tamperCost: 0.82,
    independenceKey: "teamops-image-names",
    sourceSurface: "infra/preview",
  },
  {
    signal: "/var/lib/teamops/exports",
    family: "containerMetadata",
    patterns: ["/var/lib/teamops/exports", "EXPORT_JOBS_DIR=/var/lib/teamops/exports"],
    baseWeight: 18,
    rarity: 0.96,
    tamperCost: 0.78,
    independenceKey: "teamops-export-dir",
    sourceSurface: "infra/preview",
  },
  {
    signal: "service: gateway",
    family: "healthIdentity",
    patterns: ['service: "gateway"', '"service":"gateway"'],
    baseWeight: 7,
    rarity: 0.9,
    tamperCost: 0.76,
    independenceKey: "health-service-identity",
    sourceSurface: "gateway",
  },
  {
    signal: "service: control-api",
    family: "healthIdentity",
    patterns: ['service: "control-api"', '"service":"control-api"'],
    baseWeight: 7,
    rarity: 0.9,
    tamperCost: 0.76,
    independenceKey: "health-service-identity",
    sourceSurface: "control-api",
  },
  {
    signal: "service: web-admin",
    family: "healthIdentity",
    patterns: ['service: "web-admin"', '"service":"web-admin"'],
    baseWeight: 6,
    rarity: 0.86,
    tamperCost: 0.72,
    independenceKey: "health-service-identity",
    sourceSurface: "web-admin",
  },
  {
    signal: "AI Access & Governance Infrastructure",
    family: "semanticWatermark",
    patterns: ["AI Access & Governance Infrastructure"],
    baseWeight: 6,
    rarity: 0.92,
    tamperCost: 0.58,
    independenceKey: "positioning-copy",
    sourceSurface: "repo/shared",
  },
  {
    signal: "Cloud / Hybrid / Self-host Preview",
    family: "semanticWatermark",
    patterns: ["Cloud first, Hybrid and Self-host Preview", "Self-host Preview is for qualified evaluation only."],
    baseWeight: 5,
    rarity: 0.88,
    tamperCost: 0.56,
    independenceKey: "deployment-posture-copy",
    sourceSurface: "repo/shared",
  },
  {
    signal: "workspace.onboarding.first_provider_connected",
    family: "semanticWatermark",
    patterns: ["workspace.onboarding.first_provider_connected"],
    baseWeight: 6,
    rarity: 0.95,
    tamperCost: 0.66,
    independenceKey: "audit-action-watermarks",
    sourceSurface: "control-api",
  },
  {
    signal: "workspace.onboarding.first_provider_tested",
    family: "semanticWatermark",
    patterns: ["workspace.onboarding.first_provider_tested"],
    baseWeight: 6,
    rarity: 0.95,
    tamperCost: 0.66,
    independenceKey: "audit-action-watermarks",
    sourceSurface: "control-api",
  },
  {
    signal: "workspace.onboarding.first_export_requested",
    family: "semanticWatermark",
    patterns: ["workspace.onboarding.first_export_requested"],
    baseWeight: 6,
    rarity: 0.96,
    tamperCost: 0.68,
    independenceKey: "audit-action-watermarks",
    sourceSurface: "control-api",
  },
  {
    signal: "BYOK routing",
    family: "semanticWatermark",
    patterns: ["BYOK routing", "BYOK provider routing"],
    baseWeight: 2,
    rarity: 0.36,
    tamperCost: 0.22,
    independenceKey: "generic-governance-copy",
    sourceSurface: "repo/shared",
    generic: true,
  },
  {
    signal: "Virtual keys",
    family: "semanticWatermark",
    patterns: ["Virtual keys", "virtual keys"],
    baseWeight: 2,
    rarity: 0.34,
    tamperCost: 0.2,
    independenceKey: "generic-governance-copy",
    sourceSurface: "repo/shared",
    generic: true,
  },
  {
    signal: "Control plane",
    family: "semanticWatermark",
    patterns: ["Control plane", "control plane"],
    baseWeight: 2,
    rarity: 0.3,
    tamperCost: 0.18,
    independenceKey: "generic-governance-copy",
    sourceSurface: "repo/shared",
    generic: true,
  },
];
