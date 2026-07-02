export type EsgDriverJobStatus = "queued" | "processing" | "done" | "error";

export interface EsgDriverJobActivity {
  id: string;
  timestamp: string;
  stage: string;
  progress: number;
  status: EsgDriverJobStatus;
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
  publishedDate: string | null;
  updatedDate: string | null;
  lastModified: string | null;
  retrievedAt: string;
  authorityScore: number;
  freshnessScore: number;
  relevanceScore: number;
  sourceScore: number;
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

export interface HarnessTrace {
  mode: "research-grade";
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
  generatedAt: string;
  drivers: EsgDriver[];
  evidence: EsgDriverSource[];
  warnings: string[];
  trace?: HarnessTrace;
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
