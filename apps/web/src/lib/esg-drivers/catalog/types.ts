import type {
  EsgDriverSection,
  EsgDriverType,
  GenerateEsgDriversInput,
} from "../types";

export type CatalogRecordOrigin = "master" | "specialist";

export type CatalogEvidenceCategory =
  | "regulation"
  | "policy"
  | "forecast"
  | "market-metric"
  | "standard"
  | "evergreen-framework"
  | "risk"
  | "other";

export type CatalogSourceStatus =
  | "reviewed-seed"
  | "reviewed-guidance-only"
  | "missing";

export type CatalogSectorFamily =
  | "All"
  | "Financial Services"
  | "Built Environment"
  | "Energy"
  | "Other";

export interface CatalogDocumentReference {
  title: string;
  url: string;
  version: string | null;
  pageReferences: string[];
  inheritedUrl: boolean;
}

export interface DriverArchetype {
  id: string;
  catalogOrder: number;
  origin: CatalogRecordOrigin;
  sourceSheet: string;
  sourceRow: number;
  specialistLibrary: string | null;
  activeForSectors: string[];
  section: EsgDriverSection;
  type: EsgDriverType;
  name: string;
  countryScopes: string[];
  sectorScopes: string[];
  sectorFamilies: CatalogSectorFamily[];
  logic: string;
  preciseQuestion: string;
  evidenceTarget: string;
  /** Workbook examples are discovery/writing guidance only. They are never evidence. */
  exampleGuidance: string;
  keyPublishers: string[];
  workbookUrls: string[];
  /** Exact URLs whose publisher already belongs to the reviewed runtime registry. */
  seedUrls: string[];
  guidanceOnlyUrls: string[];
  sourceStatus: CatalogSourceStatus;
  document: CatalogDocumentReference | null;
  evidenceCategory: CatalogEvidenceCategory;
  registryLogicIds: string[];
}

export interface CatalogSource {
  exactUrl: string;
  domain: string;
  publisherId: string;
  publisherLabel: string;
  registryApprovalIds: string[];
  archetypeIds: string[];
  countryScopes: string[];
  sectorScopes: string[];
  registryLogicIds: string[];
}

export interface EsgDriverCatalogManifest {
  schemaVersion: string;
  catalogVersion: string;
  workbookFile: string;
  workbookSha256: string;
  /** Hash of the generator and reviewed source-policy inputs. */
  pipelineSha256: string;
  generatedAt: string;
  counts: {
    master: number;
    specialist: number;
    total: number;
    seedSources: number;
  };
  exposedCountries: string[];
  exposedSectors: string[];
  reviewedDirectDomains: string[];
  reviewedGuidanceDomains: string[];
}

export interface EsgDriverCatalog {
  manifest: EsgDriverCatalogManifest;
  archetypes: DriverArchetype[];
  seedSources: CatalogSource[];
}

export interface CandidateScoreBreakdown {
  countryFit: number;
  sectorFit: number;
  specialistFit: number;
  directSourceAvailability: number;
  evidenceSpecificity: number;
  freshness: number;
  typeBalance: number;
  duplicationRisk: number;
}

export interface RankedDriverCandidate {
  id: string;
  archetypeId: string;
  score: number;
  scoreBreakdown: CandidateScoreBreakdown;
  scoreReasons: string[];
  sourceStatus: CatalogSourceStatus;
  seedUrls: string[];
  registryLogicIds: string[];
  archetype: DriverArchetype;
}

export interface DriverSlot {
  id: string;
  driverId: string;
  driverNumber: number;
  section: EsgDriverSection;
  candidateQueue: RankedDriverCandidate[];
}

export interface DriverSelectionPlan {
  mode: "catalog" | "legacy";
  catalogVersion: string;
  input: GenerateEsgDriversInput;
  sectionQuotas: Record<EsgDriverSection, number>;
  backupTargetPerSection: number;
  maxCandidatePreflights: number;
  slots: DriverSlot[];
}
