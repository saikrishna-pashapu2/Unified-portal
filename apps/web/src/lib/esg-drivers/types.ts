import type {
  CatalogSourceStatus,
  DriverSelectionPlan,
} from "./catalog/types";
import type { WorkbookDriver, WorkbookSource } from './workbook-types';

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
  section?: string;
  driverPlan?: Array<{ id: string; number: number; title: string; section: string }>;
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
  /** Date of this document/page itself, with evidence; never an incidental event or HTTP timestamp. */
  sourceDate?: { value: string; kind: 'published' | 'updated' | 'version-issued'; evidence: string; location: string } | null;
  authorityScore: number;
  freshnessScore: number;
  relevanceScore: number;
  sourceScore: number;
  passages?: Array<{ id: string; text: string; location: string }>;
  documentDates?: import('./excel-source-metadata').SourceDocumentDate[];
  retrievalMethod?: 'direct' | 'tavily-extract';
  directRetrievalError?: string;
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

export type DriverRelevanceDimension = 'country' | 'sector' | 'businessImpact' | 'urgency';
export interface DriverRelevance {
  assessmentVersion?: 'driver-specific-v2';
  review?: {
    reviewer: { model: string; responseId: string | null };
    checks: { exactDriverSupport: boolean; noBorrowedObligations: boolean; urgencySupported: boolean; ratingsProportionate: boolean };
  };
  policyVersion: 'relevance-top15-v1';
  score: number;
  band: 'high' | 'medium' | 'low';
  dimensions: Record<DriverRelevanceDimension, { rating: number; reason: string; passageIds: string[] }>;
  rationale: string;
  assessedAt: string;
  evidenceFingerprint: string;
  assessor: { model: string; responseId: string | null };
}

export interface DriverSelection {
  policyVersion: 'relevance-top15-v1';
  requestedCount: 15;
  minimumScore: 50;
  candidateCount: number;
  supportedCandidateCount: number;
  eligibleCandidateCount: number;
  publishedDriverIds: string[];
  excluded: Array<{ driverId: string; reason: 'unavailable' | 'unscored' | 'below-threshold' | 'duplicate' | 'below-cutoff'; duplicateOf?: string }>;
  assessedAt: string;
}

export interface EsgDriver {
  id: string;
  driverSection: string;
  driverType: string;
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
  generationStatus?: 'verified' | 'unavailable';
  evidenceStatus?: import('./quality-policy').DriverEvidenceStatus;
  evidenceDate?: string | null;
  evidenceLimitation?: string;
  relevance?: DriverRelevance;
  relevanceFailure?: { assessment: DriverRelevance; reasons: string[] };
  statusReason?: string;
  workbookRow?: number;
  workbookSheet?: string;
  baseline?: { logic: string; evidenceKpi: string; keySources: string };
  citations?: Array<{ sourceId: string; passageId: string; quote: string; location: string }>;
  verification?: {
    contract: 'excel-evidence-v3';
    writer: { model: string; responseId: string | null };
    reviewer: { model: string; responseId: string | null };
    reviewedAt: string;
    citedPassagesOnly: true;
    checks: { supported: boolean; directDriverEvidence: boolean; sameDriver: boolean; correctLanguage: boolean; allClaimsSupported: boolean; metricsMatchScopeUnitAndPeriod: boolean; usesLatestSupportedInformation: boolean };
    editorial?: {
      policyVersion: '2026-09-editorial-v1' | '2026-09-editorial-v2';
      reviewer: { model: string; responseId: string | null };
      consideredPassageIds: string[];
      checks: { factualEvidenceKpi: boolean; latestRelevantEvidenceUsed: boolean; countrySectorGrounded: boolean; coherentDriver: boolean; evidenceStatusAccurate: boolean };
    };
  };
}

export interface EsgDriverResult {
  country: string;
  sector: string;
  language: string;
  catalogVersion: string;
  generatedAt: string;
  drivers: EsgDriver[];
  /** Ranked reports publish drivers above; the immutable full workbook assessment remains in original order here. */
  candidatePool?: EsgDriver[];
  selection?: DriverSelection;
  evidence: EsgDriverSource[];
  warnings: string[];
  /** Absent on legacy saved packs created before partial completion support. */
  completion?: "complete" | "partial";
  expectedDriverCount?: number;
  slotFailures?: EsgDriverSlotFailure[];
  trace?: HarnessTrace;
  workflow?: 'excel-sources';
  workbook?: string;
  verifiedDriverCount?: number;
  provenance?: { contract: 'excel-evidence-v3'; configuredModel: string; actualModels: string[] };
  sourceChecks?: Array<{ url: string; status: 'retrieved' | 'unavailable'; reason?: string }>;
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

export interface EsgWorkbookCheckpoint {
  version: 2;
  evidenceContract?: 'excel-evidence-v3';
  qualityPolicy?: '2026-09-editorial-v1' | '2026-09-editorial-v2';
  /** Absent on existing full-workbook jobs; new jobs explicitly opt into the ranked report contract. */
  selectionPolicy?: 'relevance-top15-v1';
  workflow: 'excel-sources';
  catalogVersion: string;
  workbook: string;
  workbookSha256: string;
  input: GenerateEsgDriversInput;
  definitions: WorkbookDriver[];
  allowedSources: WorkbookSource[];
  slots: Array<{ driver: EsgDriver; sources: EsgDriverSource[] }>;
  sourceChecks?: EsgDriverResult['sourceChecks'];
  updatedAt: string;
  resume?: { parentJobId: string; requestedAt: string; revalidateAcceptedSources: true };
}

export type AnyEsgDriverCheckpoint = EsgDriverCheckpoint | EsgWorkbookCheckpoint;

export interface GenerateEsgDriverOptions {
  onProgress?: GenerateEsgDriverHarnessOptions['onProgress'];
  checkpoint?: AnyEsgDriverCheckpoint;
  onCheckpoint?: (checkpoint: AnyEsgDriverCheckpoint) => Promise<void>;
}

export interface EsgDriverJob {
  id: string;
  selectionPolicy?: 'relevance-top15-v1';
  candidateCount?: number;
  candidateAssessedCount?: number;
  publishedDriverCount?: number;
  expectedDriverCount?: number;
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
  checkpoint: AnyEsgDriverCheckpoint | null;
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
