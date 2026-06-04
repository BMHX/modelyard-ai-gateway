export type DeliveryMode = {
  slug: "cloud" | "hybrid" | "self-host-preview";
  name: string;
  commercialStatus: string;
  summary: string;
  userValue: string;
  operatorMotion: string;
  controlPlane: string;
  gateway: string;
  credentials: string;
  upgrades: string;
  support: string;
  bestFit: string;
};

export type DeliveryOwnershipRow = {
  area: string;
  cloud: string;
  hybrid: string;
  selfHostPreview: string;
};

export type ProviderNarrative = {
  name: string;
  summary: string;
  deepUserValue: string;
  operatorGuidance: string;
  operatorSequence: string;
  promiseBoundary: string;
};

export type DeliveryDecisionRow = {
  question: string;
  cloud: string;
  hybrid: string;
  selfHostPreview: string;
};

export type OperatorExperiencePrinciple = {
  title: string;
  summary: string;
  operatorSignal: string;
};

export type ProviderWorkflowStep = {
  title: string;
  summary: string;
};

export type DeliveryReadinessItem = {
  title: string;
  status: "ready" | "watch" | "gap";
  owner: string;
  summary: string;
  nextStep: string;
};

export type DeliveryExecutionTrack = {
  audience: string;
  title: string;
  summary: string;
  destination: "dashboard" | "providers" | "exports" | "organizations" | "workspaces";
  ctaLabel: string;
  tone: "resolved" | "warning" | "critical";
};

export type DeliveryDecisionPrompt = {
  question: string;
  recommendedMode: DeliveryMode["slug"];
  reason: string;
};

export const enterpriseNarrative = {
  categoryLabel: "Delivery models",
  consoleName: "Routing model",
  headline: "Deployment models for routing, access, and operations.",
  positioningPoints: [
    "Lead with Cloud as the default deployment.",
    "Use Hybrid when the gateway or traffic path must be customer-run.",
    "Keep Self-host Preview limited to qualified evaluation.",
  ],
  say: [
    "Default deployment is Cloud with BYOK routing and governance.",
    "Hybrid keeps control hosted and gateway customer-run.",
    "Self-host Preview is for qualified evaluation only.",
  ],
  avoid: [
    "Do not present self-host as GA by default.",
    "Do not promise SSO, SCIM, KMS, or upgrade guarantees that are not ready.",
    "Do not describe the product as only a proxy dashboard.",
  ],
  hardeningGates: [
    "OIDC or SSO login",
    "RBAC lifecycle consistency",
    "SCIM-ready identity mapping",
    "GA runtime packaging",
    "Native KMS integration",
    "Support SLA and version policy",
  ],
} as const;

export const deliveryModes: DeliveryMode[] = [
  {
    slug: "cloud",
    name: "Cloud",
    commercialStatus: "Standard offer",
    summary: "Fastest managed deployment.",
    userValue: "Fast setup for routing, spend, and audit.",
    operatorMotion: "Use as the default deployment.",
    controlPlane: "Vendor-hosted",
    gateway: "Vendor-hosted",
    credentials: "BYOK stored in the control plane",
    upgrades: "Vendor-managed",
    support: "Standard supportable product",
    bestFit: "Teams that need fast setup",
  },
  {
    slug: "hybrid",
    name: "Hybrid",
    commercialStatus: "Target enterprise shape",
    summary: "Hosted control with customer-run gateway.",
    userValue: "One hosted admin surface with customer-side traffic control.",
    operatorMotion: "Use when traffic or credentials must stay customer-side.",
    controlPlane: "Vendor-hosted",
    gateway: "Customer-hosted optional gateway or routing layer",
    credentials: "Prefer customer-managed inside the customer network",
    upgrades: "Shared account plan",
    support: "Scoped support",
    bestFit: "Teams that need customer-side traffic control",
  },
  {
    slug: "self-host-preview",
    name: "Self-host Preview",
    commercialStatus: "Qualified preview only",
    summary: "Preview for full customer-owned runtime.",
    userValue: "Validate full runtime ownership.",
    operatorMotion: "Use only when evaluation requires full ownership.",
    controlPlane: "Customer-hosted",
    gateway: "Customer-hosted",
    credentials: "Customer-managed",
    upgrades: "Customer-operated, policy still being hardened",
    support: "Preview support",
    bestFit: "Evaluations that require full customer ownership",
  },
];

export const deliveryOwnershipRows: DeliveryOwnershipRow[] = [
  {
    area: "Control plane",
    cloud: "Vendor-hosted.",
    hybrid: "Vendor-hosted.",
    selfHostPreview: "Customer-hosted.",
  },
  {
    area: "Gateway",
    cloud: "Vendor-hosted.",
    hybrid: "Customer-hosted option.",
    selfHostPreview: "Customer-hosted.",
  },
  {
    area: "Provider credentials",
    cloud: "BYOK in hosted control plane.",
    hybrid: "Prefer customer-managed in customer network.",
    selfHostPreview: "Customer-managed.",
  },
  {
    area: "Upgrades",
    cloud: "Vendor-managed.",
    hybrid: "Shared plan.",
    selfHostPreview: "Customer-managed in preview.",
  },
];

export const providerNarratives: ProviderNarrative[] = [
  {
    name: "Managed route",
    summary: "Public provider route managed in this workspace.",
    deepUserValue: "Fastest setup for shared public models.",
    operatorGuidance: "Use for default public coverage.",
    operatorSequence: "Test, set default, review fallback.",
    promiseBoundary: "Use as a managed route, not raw key storage.",
  },
  {
    name: "Customer gateway",
    summary: "Customer-managed gateway route with shared control plane.",
    deepUserValue: "Keeps one routing workflow across hosted and customer edges.",
    operatorGuidance: "Use when traffic or credentials stay in the customer network.",
    operatorSequence: "Test gateway, confirm default, review exceptions.",
    promiseBoundary: "Gateway runtime is customer-owned; this console manages routing state.",
  },
  {
    name: "Private model route",
    summary: "Private model endpoint behind a customer boundary.",
    deepUserValue: "Keeps private routes visible and easy to review.",
    operatorGuidance: "Use for private models, regulated workloads, or internal endpoints.",
    operatorSequence: "Name route, set rules, confirm fallback.",
    promiseBoundary: "Runtime packaging and support still depend on deployment mode.",
  },
];

export const deliveryDecisionRows: DeliveryDecisionRow[] = [
  {
    question: "What does the buyer need to keep inside their own network boundary?",
    cloud: "Hosted control plane and gateway are acceptable.",
    hybrid: "Traffic path, gateway runtime, or credentials must stay customer-controlled.",
    selfHostPreview: "Full runtime must be customer-operated.",
  },
  {
    question: "How much operational ownership can the customer take on today?",
    cloud: "Minimal. Fastest path to governed usage.",
    hybrid: "Shared. Customer runs the gateway boundary.",
    selfHostPreview: "High. Customer runs infra and upgrades.",
  },
  {
    question: "What keeps daily operations predictable after rollout?",
    cloud: "One managed model for routes, budgets, usage, and exports.",
    hybrid: "Same hosted workflow with customer-edge boundary mapping.",
    selfHostPreview: "Validates the final ownership model before broader support exists.",
  },
];

export const operatorExperiencePrinciples: OperatorExperiencePrinciple[] = [
  {
    title: "One routing model",
    summary: "Use the same route model across Cloud, Hybrid, and Preview.",
    operatorSignal: "Keep routing concepts the same across deployment modes.",
  },
  {
    title: "Health before defaults",
    summary: "Review route health and test status before editing defaults.",
    operatorSignal: "Retest first, then update defaults.",
  },
  {
    title: "Clear route names",
    summary: "Use names like Customer gateway, Qwen cluster, or Internal endpoint.",
    operatorSignal: "Prefer route intent over protocol jargon.",
  },
];

export const deliveryReadinessItems: DeliveryReadinessItem[] = [
  {
    title: "Preview runtime packaging",
    status: "ready",
    owner: "Product delivery",
    summary: "Preview runtime image and compose topology are defined.",
    nextStep: "Use the preview stack for validation.",
  },
  {
    title: "Upgrade and rollback policy",
    status: "ready",
    owner: "Delivery + customer ops",
    summary: "Preview installs have a runbook and rollback path.",
    nextStep: "Keep pilots on adjacent release upgrades.",
  },
  {
    title: "Health, logs, and operating signals",
    status: "ready",
    owner: "Customer ops",
    summary: "Health and logs are available for core services.",
    nextStep: "Wire logs and health into the customer sink.",
  },
  {
    title: "Environment matrix",
    status: "ready",
    owner: "Delivery",
    summary: "Environment and port settings live in one reference.",
    nextStep: "Use the matrix during setup and upgrades.",
  },
  {
    title: "Identity hardening",
    status: "gap",
    owner: "Product",
    summary: "Preview auth works, but enterprise sign-in and SCIM are missing.",
    nextStep: "Do not present Self-host Preview as GA yet.",
  },
  {
    title: "Native KMS feature",
    status: "gap",
    owner: "Product",
    summary: "Current preview uses customer-managed secret injection.",
    nextStep: "Be explicit about secret ownership and KMS gaps.",
  },
];

export const deliveryExecutionTracks: DeliveryExecutionTrack[] = [
  {
    audience: "Account team",
    title: "Start with Cloud",
    summary: "Use Cloud first. Escalate only when traffic path, credentials, or runtime ownership require it.",
    destination: "dashboard",
    ctaLabel: "Open control center",
    tone: "resolved",
  },
  {
    audience: "Solution architect",
    title: "Validate route ownership",
    summary: "Use providers to show managed routes, customer gateways, and private routes.",
    destination: "providers",
    ctaLabel: "Open providers",
    tone: "warning",
  },
  {
    audience: "Pilot",
    title: "Close with evidence",
    summary: "Finish with exports, audit evidence, and an upgrade path.",
    destination: "exports",
    ctaLabel: "Open exports",
    tone: "critical",
  },
];

export const deliveryDecisionPrompts: DeliveryDecisionPrompt[] = [
  {
    question: "The buyer wants governed usage quickly and does not need infra ownership on day one.",
    recommendedMode: "cloud",
    reason: "Cloud keeps routing and daily operations in one managed deployment.",
  },
  {
    question: "The buyer accepts a hosted control plane but insists that traffic or credentials stay inside their network.",
    recommendedMode: "hybrid",
    reason: "Hybrid keeps control hosted and moves the gateway boundary to the customer side.",
  },
  {
    question: "The evaluation cannot proceed unless the customer owns the full runtime, upgrade flow, and incident response path.",
    recommendedMode: "self-host-preview",
    reason: "Self-host Preview is for evaluations that require full runtime ownership.",
  },
];

export const providerWorkflowSteps: ProviderWorkflowStep[] = [
  {
    title: "Check route health first",
    summary: "Retest active routes and clear stale checks before editing rules.",
  },
  {
    title: "Use clear route names",
    summary: "Use names like Customer gateway, Private cluster, or Qwen.",
  },
  {
    title: "Keep related pages close",
    summary: "Move from providers into usage, keys, audit, and exports without losing context.",
  },
];
