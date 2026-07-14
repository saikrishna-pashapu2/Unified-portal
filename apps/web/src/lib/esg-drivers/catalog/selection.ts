import {
  DRIVER_LOGIC_LIBRARY,
  selectLegacyDriverLogics,
  type EsgDriverLogic,
} from "../logic";
import type {
  EsgDriverSection,
  GenerateEsgDriversInput,
} from "../types";
import { ESG_DRIVER_CATALOG, getCatalogVersion } from "./data";
import type {
  CandidateScoreBreakdown,
  DriverArchetype,
  DriverSelectionPlan,
  RankedDriverCandidate,
} from "./types";

export const ESG_DRIVER_SECTION_QUOTAS: Record<EsgDriverSection, number> = {
  "Global Drivers": 3,
  "Regulatory Requirements": 3,
  "Climate Risks": 2,
  "Capital Markets": 2,
  "Supply Chain": 2,
};

const SECTION_ORDER = Object.keys(ESG_DRIVER_SECTION_QUOTAS) as EsgDriverSection[];
const BACKUP_TARGET_PER_SECTION = 2;
const MAX_CANDIDATE_PREFLIGHTS = 30;
const ARCHETYPE_NAME_COUNTS = ESG_DRIVER_CATALOG.archetypes.reduce<Map<string, number>>(
  (counts, archetype) => {
    const key = archetype.name.trim().toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
    return counts;
  },
  new Map(),
);

export function buildDriverSelectionPlan(
  input: GenerateEsgDriversInput,
): DriverSelectionPlan {
  const normalizedInput = normalizeSelectionInput(input);
  const rankedBySection = new Map<EsgDriverSection, RankedDriverCandidate[]>();
  for (const section of SECTION_ORDER) {
    const ranked = ESG_DRIVER_CATALOG.archetypes
      .filter((archetype) => archetype.section === section)
      .map((archetype) => scoreArchetype(archetype, normalizedInput))
      .filter((candidate): candidate is RankedDriverCandidate => Boolean(candidate))
      .sort(compareRankedCandidates);
    const required = ESG_DRIVER_SECTION_QUOTAS[section];
    if (ranked.length < required) {
      throw new Error(
        `Catalog has only ${ranked.length} eligible ${section} candidates; ${required} are required.`,
      );
    }
    rankedBySection.set(section, ranked);
  }

  let driverNumber = 1;
  const slots: DriverSelectionPlan["slots"] = [];
  for (const section of SECTION_ORDER) {
    const ranked = rankedBySection.get(section) ?? [];
    const quota = ESG_DRIVER_SECTION_QUOTAS[section];
    const sharedBackups = ranked.slice(quota);
    for (let sectionIndex = 0; sectionIndex < quota; sectionIndex += 1) {
      const primary = ranked[sectionIndex];
      const otherPrimaries = ranked
        .slice(0, quota)
        .filter((candidate) => candidate.id !== primary.id);
      const driverId = `D${driverNumber}`;
      slots.push({
        id: driverId,
        driverId,
        driverNumber,
        section,
        candidateQueue: [primary, ...sharedBackups, ...otherPrimaries],
      });
      driverNumber += 1;
    }
  }

  return {
    mode: "catalog",
    catalogVersion: getCatalogVersion(),
    input: normalizedInput,
    sectionQuotas: { ...ESG_DRIVER_SECTION_QUOTAS },
    backupTargetPerSection: BACKUP_TARGET_PER_SECTION,
    maxCandidatePreflights: MAX_CANDIDATE_PREFLIGHTS,
    slots,
  };
}

export function buildLegacyDriverSelectionPlan(
  input: GenerateEsgDriversInput,
): DriverSelectionPlan {
  const normalizedInput = normalizeSelectionInput(input);
  const primaryLogics = selectLegacyDriverLogics(normalizedInput);
  const candidates = new Map(
    DRIVER_LOGIC_LIBRARY.map((logic, index) => [
      logic.id,
      legacyLogicToCandidate(logic, index),
    ]),
  );
  const slots = primaryLogics.map((logic, index) => {
    const primary = candidates.get(logic.id);
    if (!primary) throw new Error(`Missing legacy ESG driver logic: ${logic.id}`);
    const backups = DRIVER_LOGIC_LIBRARY.filter(
      (candidate) => candidate.section === logic.section && candidate.id !== logic.id,
    ).map((candidate) => candidates.get(candidate.id) as RankedDriverCandidate);
    const driverId = `D${index + 1}`;
    return {
      id: driverId,
      driverId,
      driverNumber: index + 1,
      section: logic.section,
      candidateQueue: [primary, ...backups],
    };
  });
  return {
    mode: "legacy",
    catalogVersion: getCatalogVersion(),
    input: normalizedInput,
    sectionQuotas: { ...ESG_DRIVER_SECTION_QUOTAS },
    backupTargetPerSection: BACKUP_TARGET_PER_SECTION,
    maxCandidatePreflights: MAX_CANDIDATE_PREFLIGHTS,
    slots,
  };
}

export function rankedCandidateToDriverLogic(
  candidate: RankedDriverCandidate,
): EsgDriverLogic {
  const archetype = candidate.archetype;
  return {
    id: archetype.id,
    section: archetype.section,
    type: archetype.type,
    logic: archetype.logic,
    preciseQuestion: archetype.preciseQuestion,
    evidenceTarget: archetype.evidenceTarget,
    sourcePriorities: archetype.keyPublishers,
    registryLogicIds: archetype.registryLogicIds,
    seedUrls: archetype.seedUrls,
    catalogArchetypeId: archetype.id,
    catalogName: archetype.name,
    catalogCountryScopes: archetype.countryScopes,
    catalogSectorScopes: archetype.sectorScopes,
    catalogSectorFamilies: archetype.sectorFamilies,
    catalogSourceStatus: archetype.sourceStatus,
    exampleGuidance: archetype.exampleGuidance,
    catalogEvidenceCategory: archetype.evidenceCategory,
    specialistLibrary: archetype.specialistLibrary,
    documentVersion: archetype.document?.version ?? null,
    pageReferences: archetype.document?.pageReferences ?? [],
  };
}

function normalizeSelectionInput(input: GenerateEsgDriversInput): GenerateEsgDriversInput {
  const countryAliases: Record<string, string> = {
    uae: "UAE",
    "united arab emirates": "UAE",
    ksa: "Saudi Arabia",
    "saudi arabia": "Saudi Arabia",
    kazakhstan: "Kazakhstan",
  };
  const sectorAliases: Record<string, string> = {
    banking: "Banking",
    bank: "Banking",
    "financial services": "Banking",
    construction: "Construction",
    cement: "Construction",
    "real estate": "Real Estate",
    property: "Real Estate",
    "oil & gas": "Oil & Gas",
    "oil and gas": "Oil & Gas",
  };
  const country = countryAliases[input.country.trim().toLowerCase()];
  const sector = sectorAliases[input.sector.trim().toLowerCase()];
  if (!country || !ESG_DRIVER_CATALOG.manifest.exposedCountries.includes(country)) {
    throw new Error(`Unsupported ESG catalog country: ${input.country}`);
  }
  if (!sector || !ESG_DRIVER_CATALOG.manifest.exposedSectors.includes(sector)) {
    throw new Error(`Unsupported ESG catalog sector: ${input.sector}`);
  }
  return { ...input, country, sector };
}

function scoreArchetype(
  archetype: DriverArchetype,
  input: GenerateEsgDriversInput,
): RankedDriverCandidate | null {
  const countryFit = getCountryFit(archetype, input.country);
  if (countryFit === null) return null;
  const sectorFit = getSectorFit(archetype, input.sector);
  if (sectorFit === null) return null;
  const specialistFit = archetype.activeForSectors.includes(input.sector) ? 12 : 0;
  const directSourceAvailability = archetype.seedUrls.length > 0 ? 18 : 0;
  const evidenceSpecificity = getEvidenceSpecificity(archetype.evidenceTarget);
  const freshness = getFreshnessSignal(archetype);
  const typeBalance =
    archetype.type === "Country-related" && archetype.countryScopes.includes(input.country)
      ? 4
      : archetype.type === "Sector-related" && sectorFit >= 24
        ? 4
        : archetype.type === "General"
          ? 1
          : 0;
  const sameNameCount = ARCHETYPE_NAME_COUNTS.get(archetype.name.trim().toLowerCase()) ?? 1;
  const duplicationRisk = /^(esg|sustainability|climate change)$/i.test(archetype.name.trim())
    ? -6
    : -Math.min(6, Math.max(0, sameNameCount - 1) * 2);
  const scoreBreakdown: CandidateScoreBreakdown = {
    countryFit,
    sectorFit,
    specialistFit,
    directSourceAvailability,
    evidenceSpecificity,
    freshness,
    typeBalance,
    duplicationRisk,
  };
  const score = Object.values(scoreBreakdown).reduce((sum, value) => sum + value, 0);
  const scoreReasons = [
    countryFit >= 30 ? `exact country fit: ${input.country}` : "global country scope",
    specialistFit > 0
      ? `active specialist library: ${archetype.specialistLibrary}`
      : sectorFit >= 30
        ? `exact sector fit: ${input.sector}`
        : "sector-family or all-sector fit",
    archetype.seedUrls.length > 0
      ? `${archetype.seedUrls.length} reviewed exact seed URL(s)`
      : "publisher guidance requires approved-source discovery",
    `evidence category: ${archetype.evidenceCategory}`,
  ];
  return {
    id: archetype.id,
    archetypeId: archetype.id,
    score,
    scoreBreakdown,
    scoreReasons,
    sourceStatus: archetype.sourceStatus,
    seedUrls: [...archetype.seedUrls],
    registryLogicIds: [...archetype.registryLogicIds],
    archetype,
  };
}

function getCountryFit(archetype: DriverArchetype, country: string): number | null {
  if (archetype.countryScopes.includes(country)) return 40;
  if (archetype.countryScopes.includes("All")) return 12;
  return null;
}

function getSectorFit(archetype: DriverArchetype, sector: string): number | null {
  const family = getSectorFamily(sector);
  if (archetype.origin === "specialist") {
    if (!archetype.activeForSectors.includes(sector)) return null;
    if (archetype.sectorScopes.includes(sector)) return 34;
    if (archetype.sectorFamilies.includes(family)) return 26;
    if (archetype.sectorScopes.includes("All")) return 22;
    return 20;
  }
  if (archetype.sectorScopes.includes(sector)) return 30;
  if (archetype.sectorScopes.includes("All")) return 12;
  if (archetype.sectorFamilies.includes(family)) return 20;
  return null;
}

function getSectorFamily(sector: string) {
  if (sector === "Banking") return "Financial Services" as const;
  if (sector === "Construction" || sector === "Real Estate") return "Built Environment" as const;
  return "Energy" as const;
}

function getEvidenceSpecificity(target: string): number {
  let score = Math.min(5, Math.floor(target.length / 45));
  if (/\d/.test(target)) score += 3;
  if (/%|CO2|CO₂|USD|tonne|tCO|kWh|GW|Gt|Mt|year/i.test(target)) score += 2;
  return Math.min(score, 10);
}

function getFreshnessSignal(archetype: DriverArchetype): number {
  const hasDatedMetric = /\b(?:19|20)\d{2}\b/.test(archetype.evidenceTarget);
  switch (archetype.evidenceCategory) {
    case "regulation":
    case "policy":
    case "forecast":
    case "market-metric":
      return hasDatedMetric ? 7 : 3;
    case "standard":
      return archetype.document?.version ? 7 : 4;
    case "evergreen-framework":
      return 1;
    default:
      return hasDatedMetric ? 3 : 0;
  }
}

function compareRankedCandidates(
  left: RankedDriverCandidate,
  right: RankedDriverCandidate,
): number {
  if (left.score !== right.score) return right.score - left.score;
  if (left.archetype.catalogOrder !== right.archetype.catalogOrder) {
    return left.archetype.catalogOrder - right.archetype.catalogOrder;
  }
  return left.id.localeCompare(right.id);
}

function legacyLogicToCandidate(
  logic: EsgDriverLogic,
  catalogOrder: number,
): RankedDriverCandidate {
  const seedUrls = ESG_DRIVER_CATALOG.seedSources
    .filter((source) => source.registryLogicIds.includes(logic.id))
    .map((source) => source.exactUrl);
  const archetype: DriverArchetype = {
    id: logic.id,
    catalogOrder,
    origin: "master",
    sourceSheet: "Legacy logic library",
    sourceRow: catalogOrder + 1,
    specialistLibrary: null,
    activeForSectors: [],
    section: logic.section,
    type: logic.type,
    name: logic.id,
    countryScopes: ["All"],
    sectorScopes: ["All"],
    sectorFamilies: ["All"],
    logic: logic.logic,
    preciseQuestion: logic.preciseQuestion,
    evidenceTarget: logic.evidenceTarget,
    exampleGuidance: logic.evidenceTarget,
    keyPublishers: logic.sourcePriorities,
    workbookUrls: seedUrls,
    seedUrls,
    guidanceOnlyUrls: [],
    sourceStatus: seedUrls.length > 0 ? "reviewed-seed" : "reviewed-guidance-only",
    document: null,
    evidenceCategory: "other",
    registryLogicIds: [logic.id],
  };
  const zeroBreakdown: CandidateScoreBreakdown = {
    countryFit: 0,
    sectorFit: 0,
    specialistFit: 0,
    directSourceAvailability: 0,
    evidenceSpecificity: 0,
    freshness: 0,
    typeBalance: 0,
    duplicationRisk: 0,
  };
  return {
    id: logic.id,
    archetypeId: logic.id,
    score: 0,
    scoreBreakdown: zeroBreakdown,
    scoreReasons: ["legacy rollback order"],
    sourceStatus: archetype.sourceStatus,
    seedUrls,
    registryLogicIds: [logic.id],
    archetype,
  };
}
