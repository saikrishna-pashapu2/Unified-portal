import type {
  CatalogSourceStatus,
  DriverSelectionPlan,
} from "./catalog/types";

export type EsgDriverJobStatus =
  | "queued"
  | "processing"
  | "done"
  | "error"
  | "cancelled";

export type EsgDriverActivityKind =
  | "system"
  | "selection"
  | "search"
  | "search-results"
  | "source"
  | "draft"
  | "review"
  | "fallback"
  | "accepted"
  | "omitted";

export type EsgDriverActivityOutcome =
  | "running"
  | "found"
  | "accepted"
  | "rejected"
  | "passed"
  | "failed"
  | "warning";

export interface EsgDriverActivityResult {
  title: string;
  url?: string;
  domain?: string;
  outcome?: EsgDriverActivityOutcome;
}

/** Safe, explicit process telemetry. This is never model chain-of-thought. */
export interface EsgDriverProgressDetail {
  kind: EsgDriverActivityKind;
  title?: string;
  detail?: string;
  outcome?: EsgDriverActivityOutcome;
  driverId?: string;
  driverNumber?: number;
  section?: EsgDriverSection;
  candidateId?: string;
  query?: string;
  resultCount?: number;
  results?: EsgDriverActivityResult[];
  reasons?: string[];
  score?: number;
  confidence?: number;
  budget?: {
    searchRequests: number;
    maxSearchRequests: number;
    sourceFetches: number;
    maxSourceFetches: number;
    activeDurationMs: number;
    maxDurationMs: number;
  };
}

export interface EsgDriverJobActivity {
  id: string;
  timestamp: string;
  stage: string;
  progress: number;
  status: EsgDriverJobStatus;
  detail?: EsgDriverProgressDetail;
}

export type EsgDriverSection =
  | "Global Drivers"
  | "Regulatory Requirements"
  | "Climate Risks"
  | "Capital Markets"
  | "Supply Chain";

export type EsgDriverType = "General" | "Sector-related" | "Country-related";

export interface EsgDriverSource {
  id: string;
  title: string;
  url: string;
  domain: string;
  snippet: string;
  contentSnippet: string;
  retrievalStatus: "retrieved" | "failed";
  evidenceProvenance:
    | "retrieved-page"
    | "search-snippet"
    | "approved-context";
  isContextualFallback: boolean;
  finalUrl: string | null;
  retrievalError: string | null;
  publishedDate: string | null;
  updatedDate: string | null;
  lastModified: string | null;
  retrievedAt: string;
  authorityScore: number;
  freshnessScore: number;
  relevanceScore: number;
  sourceScore: number;
  approvalId?: string;
  approvalLabel?: string;
  approvalUsage?: "direct" | "context";
  approvalCountryScope?: string[];
  approvalSectorScope?: string[];
  approvalLogicScope?: string[];
  approvalClaimTypes?: string[];
}

export interface RejectedEsgDriverSource {
  id?: string;
  title: string;
  url: string;
  domain: string;
  driverLogicId: string;
  reason:
    | "not-approved"
    | "retrieval-failed"
    | "country-mismatch"
    | "sector-mismatch"
    | "logic-mismatch"
    | "context-only";
  detail: string;
  approvalId?: string;
  rejectedAt: string;
}

export interface DriverResearchPlan {
  driverId: string;
  driverIndex: number;
  driverLogicId: string;
  queries: string[];
  rationale: string;
}

export interface DriverEvidencePack {
  driverId: string;
  driverLogicId: string;
  queries: string[];
  candidateSources: EsgDriverSource[];
  selectedSources: EsgDriverSource[];
  rejectedSources: RejectedEsgDriverSource[];
  extractedMetrics: string[];
  evidenceSummary: string;
}

export interface DriverVerificationResult {
  passed: boolean;
  score: number;
  reasons: string[];
  requiredRepairs: string[];
  unsupportedMetrics: string[];
  sourceIssues: string[];
  styleIssues: string[];
  recommendedConfidence: number;
  canRepair: boolean;
}

export interface RejectedDriverAttempt {
  driverId: string;
  driverLogicId: string;
  attempt: number;
  driver: EsgDriver;
  verification: DriverVerificationResult;
  createdAt: string;
}

export interface AcceptedDriver {
  driver: EsgDriver;
  evidencePack: DriverEvidencePack;
  verification: DriverVerificationResult;
  attempts: number;
}

export interface EsgDriverSlotFailure {
  driverId: string;
  driverNumber: number;
  originalDriverLogicId: string;
  attemptedDriverLogicIds: string[];
  reasons: string[];
  createdAt: string;
}

export interface EsgDriverCandidateTrace {
  slotId: string;
  driverId: string;
  candidateId: string;
  score: number;
  scoreReasons: string[];
  sourceStatus: CatalogSourceStatus;
  attempts: number;
  status: "preflight-rejected" | "rejected" | "accepted";
  rejectionReason: string | null;
  createdAt: string;
}

export interface HarnessTrace {
  mode: "research-grade";
  catalogVersion: string;
  selectionPlan: DriverSelectionPlan;
  model: string;
  startedAt: string;
  completedAt: string;
  limits: {
    maxQueriesPerDriver: number;
    maxCandidateSourcesPerDriver: number;
    maxFinalSourceLinksPerDriver: number;
    maxRewriteAttemptsPerDriver: number;
    minimumConfidenceTarget: number;
  };
  researchBudget: EsgDriverProgressDetail["budget"] | null;
  driverPlans: DriverResearchPlan[];
  evidencePacks: DriverEvidencePack[];
  acceptedDrivers: Array<{
    driverId: string;
    driverLogicId: string;
    attempts: number;
    verificationScore: number;
    confidence: number;
  }>;
  rejectedAttempts: RejectedDriverAttempt[];
  rejectedSources: RejectedEsgDriverSource[];
  candidateAttempts: EsgDriverCandidateTrace[];
  slotFailures?: EsgDriverSlotFailure[];
  logicReplacements: Array<{
    driverId: string;
    originalDriverLogicId: string;
    replacementDriverLogicId: string;
    reason: string;
    createdAt: string;
  }>;
  deckReview: {
    passed: boolean;
    score: number;
    warnings: string[];
  } | null;
  warnings: string[];
}

export interface EsgDriver {
  id: string;
  driverSection: EsgDriverSection;
  driverType: EsgDriverType;
  driverTitle: string;
  driverText: string;
  countrySectorRelevance: string;
  evidenceKpi: string;
  keySources: string[];
  sourceLinks: string[];
  confidence: number;
  lastChecked: string;
  sourceRefs: string[];
  driverLogicId?: string;
  driverLogic?: string;
  validationWarnings?: string[];
}

export interface EsgDriverResult {
  country: string;
  sector: string;
  language: string;
  catalogVersion: string;
  generatedAt: string;
  drivers: EsgDriver[];
  evidence: EsgDriverSource[];
  warnings: string[];
  /** Absent on legacy saved packs created before partial completion support. */
  completion?: "complete" | "partial";
  expectedDriverCount?: number;
  slotFailures?: EsgDriverSlotFailure[];
  trace?: HarnessTrace;
}

export interface EsgDriverCheckpointSlotState {
  slotId: string;
  driverId: string;
  candidateId: string;
  status: "accepted" | "exhausted";
  driver?: EsgDriver;
  evidencePack?: DriverEvidencePack;
  verification?: DriverVerificationResult;
  attempts?: number;
  researchPlan?: DriverResearchPlan;
  rejectedAttempts?: RejectedDriverAttempt[];
  attemptedCandidateIds: string[];
  failure?: EsgDriverSlotFailure;
}

export interface EsgDriverCheckpoint {
  version: 1;
  catalogVersion: string;
  selectionPlan: DriverSelectionPlan;
  canonicalDrivers: EsgDriver[];
  evidencePacks: DriverEvidencePack[];
  completedSlotIds: string[];
  failedSlots: EsgDriverSlotFailure[];
  attemptedCandidateIds: string[];
  /** Optional for compatibility with checkpoints created before trace persistence. */
  candidateAttempts?: EsgDriverCandidateTrace[];
  slotStates: EsgDriverCheckpointSlotState[];
  updatedAt: string;
  resume?: {
    parentJobId: string;
    requestedAt: string;
    revalidateAcceptedSources: true;
  };
}

export interface GenerateEsgDriverHarnessOptions {
  onProgress?: (
    stage: string,
    progress: number,
    detail?: EsgDriverProgressDetail,
  ) => void | Promise<void>;
  checkpoint?: EsgDriverCheckpoint;
  onCheckpoint?: (checkpoint: EsgDriverCheckpoint) => Promise<void>;
}

export interface EsgDriverJob {
  id: string;
  userId: number | null;
  country: string;
  sector: string;
  language: string;
  status: EsgDriverJobStatus;
  progress: number;
  stage: string;
  error: string | null;
  result: EsgDriverResult | null;
  evidence: EsgDriverSource[];
  checkpoint: EsgDriverCheckpoint | null;
  catalogVersion: string | null;
  parentJobId: string | null;
  activity: EsgDriverJobActivity[];
  createdAt: string | null;
  updatedAt: string | null;
  completedAt: string | null;
}

export interface GenerateEsgDriversInput {
  country: string;
  sector: string;
  language: string;
}
