export type DetectorMode = "offline" | "online";

export type DetectorTargetType =
  | "source-tree"
  | "bundle-dir"
  | "deploy-dir"
  | "docker-image"
  | "docker-tar"
  | "url"
  | "running-instance";

export type EvidenceFamily =
  | "runtimeHeader"
  | "healthIdentity"
  | "containerMetadata"
  | "manifestFingerprint"
  | "routeTopology"
  | "semanticWatermark";

export type SourceSurface =
  | "gateway"
  | "control-api"
  | "web-admin"
  | "infra/demo"
  | "infra/preview"
  | "repo/shared"
  | "unknown";

export type EvidenceLocationKind =
  | "file-text"
  | "file-path"
  | "http-header"
  | "http-body"
  | "http-route"
  | "docker-inspect"
  | "docker-history"
  | "browser-dom"
  | "browser-request";

export type Verdict =
  | "unlikely"
  | "weak-signal"
  | "possible-match"
  | "likely-match"
  | "high-confidence-match";

export type ConfidenceBand = "low" | "medium" | "high" | "very-high";

export interface DetectorTarget {
  type: DetectorTargetType;
  value: string;
}

export interface DetectorOptions {
  enableActiveProbes: boolean;
  captureScreenshots: boolean;
  headlessBrowser: boolean;
  maxDepth: number;
  strictFalsePositiveMode: boolean;
  outputDir: string | null;
  timeoutMs: number;
}

export interface DetectionTask {
  caseId: string;
  mode: DetectorMode;
  targets: DetectorTarget[];
  options: DetectorOptions;
}

export interface EvidenceLocation {
  kind: EvidenceLocationKind;
  target: string;
  path?: string | null;
  line?: number | null;
  details?: string | null;
}

export interface EvidenceMetadata {
  generic?: boolean;
  statusCode?: number;
  targetType?: DetectorTargetType;
  matchedPattern?: string;
}

export interface EvidenceRecord {
  id: string;
  family: EvidenceFamily;
  signal: string;
  matchedValue: string;
  location: EvidenceLocation;
  strength: number;
  rarity: number;
  tamperCost: number;
  baseWeight: number;
  independenceKey: string;
  sourceSurface: SourceSurface;
  metadata?: EvidenceMetadata;
}

export interface ExtractionResult {
  target: DetectorTarget;
  evidence: EvidenceRecord[];
  errors: string[];
  artifacts: string[];
}

export interface FamilyScoreMap {
  runtimeHeader: number;
  healthIdentity: number;
  containerMetadata: number;
  manifestFingerprint: number;
  routeTopology: number;
  semanticWatermark: number;
}

export interface ScoreBreakdown extends FamilyScoreMap {
  crossSignalBonus: number;
  falsePositivePenalty: number;
  total: number;
}

export interface LikelySource {
  surface: SourceSurface;
  confidence: number;
}

export interface DetectionSummary {
  matchedFamilies: EvidenceFamily[];
  likelySources: LikelySource[];
  partialRemovalSuspected: boolean;
}

export interface DetectionReport {
  caseId: string;
  generatedAt: string;
  verdict: Verdict;
  confidence: number;
  band: ConfidenceBand;
  summary: DetectionSummary;
  scores: ScoreBreakdown;
  evidence: EvidenceRecord[];
  errors: string[];
  reviewActions: string[];
  task: DetectionTask;
  artifacts: string[];
}
