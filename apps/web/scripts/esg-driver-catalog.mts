import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import * as XLSX from "xlsx";

import { APPROVED_DRIVER_SOURCES } from "../src/lib/esg-drivers/source-registry";
import {
  domainMatchesCatalogPolicy,
  normalizeCatalogHostname,
  REVIEWED_CATALOG_GUIDANCE_DOMAINS,
} from "../src/lib/esg-drivers/catalog/publisher-policy";
import type {
  CatalogEvidenceCategory,
  CatalogSectorFamily,
  CatalogSource,
  DriverArchetype,
  EsgDriverCatalog,
} from "../src/lib/esg-drivers/catalog/types";
import type { EsgDriverSection, EsgDriverType } from "../src/lib/esg-drivers/types";

const GENERATOR_PATH = fileURLToPath(import.meta.url);
const WEB_ROOT = resolve(dirname(GENERATOR_PATH), "..");
const WORKBOOK_FILE = "ESG Drivers AI tool.xlsx";
const WORKBOOK_PATH = resolve(WEB_ROOT, "data", "esg-drivers", WORKBOOK_FILE);
const OUTPUT_PATH = resolve(
  WEB_ROOT,
  "src",
  "lib",
  "esg-drivers",
  "catalog",
  "catalog.generated.json",
);
const SCHEMA_VERSION = "1.0.0";
const EXPECTED_MASTER_RECORDS = 78;
const EXPECTED_SPECIALIST_RECORDS = 161;
const PIPELINE_INPUT_PATHS = [
  GENERATOR_PATH,
  resolve(WEB_ROOT, "src", "lib", "esg-drivers", "source-registry.ts"),
  resolve(WEB_ROOT, "src", "lib", "esg-drivers", "logic.ts"),
  resolve(
    WEB_ROOT,
    "src",
    "lib",
    "esg-drivers",
    "catalog",
    "publisher-policy.ts",
  ),
];

const SPECIALIST_SHEETS = [
  {
    name: "SBTi Buildings",
    library: "SBTi Buildings",
    activeForSectors: ["Construction", "Real Estate"],
    version: "1.1",
  },
  {
    name: "SBTi Power",
    library: "SBTi Power",
    activeForSectors: [],
    version: null,
  },
  {
    name: "SBTi Oil&Gas",
    library: "SBTi Oil & Gas",
    activeForSectors: ["Oil & Gas"],
    version: null,
  },
  {
    name: "SBTi Steel",
    library: "SBTi Steel",
    activeForSectors: [],
    version: null,
  },
  {
    name: "SBTi Fin Net Zero",
    library: "SBTi Financial Institutions Net-Zero",
    activeForSectors: ["Banking"],
    version: null,
  },
  {
    name: "SBTi Fin Near Term",
    library: "SBTi Financial Institutions Near-Term",
    activeForSectors: ["Banking"],
    version: null,
  },
] as const;

type Cell = string | number | boolean | Date | null | undefined;
type Row = Cell[];

interface DirectPublisherPolicy {
  domain: string;
  publisherId: string;
  publisherLabel: string;
  registryApprovalIds: string[];
}

interface ParsedRecordBase {
  sourceSheet: string;
  sourceRow: number;
  section: EsgDriverSection;
  type: EsgDriverType;
  name: string;
  countryScopes: string[];
  sectorScopes: string[];
  sectorFamilies: CatalogSectorFamily[];
  logic: string;
  evidenceTarget: string;
  keyPublishers: string[];
  workbookUrls: string[];
}

function cellText(value: Cell): string {
  return String(value ?? "").replace(/\r\n/g, "\n").trim();
}

function normalizeHeader(value: Cell): string {
  return cellText(value).toLowerCase().replace(/\s*\/\s*/g, "/").replace(/\s+/g, " ");
}

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizeHttpsUrl(rawUrl: string): string {
  let cleaned = rawUrl
    .replace(/&amp;/g, "&")
    .replace(/[\].,;:]+$/g, "")
    .trim();
  while (
    cleaned.endsWith(")") &&
    (cleaned.match(/\)/g)?.length ?? 0) >
      (cleaned.match(/\(/g)?.length ?? 0)
  ) {
    cleaned = cleaned.slice(0, -1);
  }
  let parsed: URL;
  try {
    parsed = new URL(cleaned);
  } catch {
    throw new Error(`Invalid catalog URL: ${rawUrl}`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`Catalog URLs must use HTTPS: ${rawUrl}`);
  }
  if (parsed.username || parsed.password || !parsed.hostname) {
    throw new Error(`Malformed catalog URL: ${rawUrl}`);
  }
  return parsed.toString();
}

function extractUrls(value: Cell): string[] {
  // Parentheses are valid URL characters (and occur in the reviewed workbook).
  // Semicolons, commas, whitespace, and newlines delimit multiple URLs in a cell.
  const matches = cellText(value).match(/https:\/\/[^\s;,\]<>"']+/gi) ?? [];
  return unique(matches.map(normalizeHttpsUrl));
}

function normalizeSection(value: Cell): EsgDriverSection {
  const normalized = cellText(value).toLowerCase();
  if (normalized === "global" || normalized === "global context" || normalized === "global drivers") {
    return "Global Drivers";
  }
  if (normalized === "regulatory" || normalized === "regulatory requirements") {
    return "Regulatory Requirements";
  }
  if (normalized === "climate risks" || normalized === "climate risk") {
    return "Climate Risks";
  }
  if (normalized === "capital markets" || normalized === "capital market") {
    return "Capital Markets";
  }
  if (normalized === "supply chain" || normalized === "supply chains") {
    return "Supply Chain";
  }
  throw new Error(`Unknown ESG driver section: ${cellText(value) || "<blank>"}`);
}

function normalizeDriverType(value: Cell): EsgDriverType {
  const normalized = cellText(value).toLowerCase();
  if (normalized === "general") return "General";
  if (normalized === "sector-related" || normalized === "sector related") {
    return "Sector-related";
  }
  if (normalized === "country-related" || normalized === "country related") {
    return "Country-related";
  }
  throw new Error(`Unknown ESG driver type: ${cellText(value) || "<blank>"}`);
}

function normalizeCountries(value: Cell): string[] {
  const raw = cellText(value);
  return unique(
    splitScopeList(raw).map((part) => {
      if (/^(all|global)$/i.test(part)) return "All";
      if (/^(UAE|United Arab Emirates)$/i.test(part)) return "UAE";
      if (/^(Saudi Arabia|KSA|SA)$/i.test(part)) return "Saudi Arabia";
      if (/^(Kazakhstan|KZ)$/i.test(part)) return "Kazakhstan";
      if (/^(Uzbekistan|UZ)$/i.test(part)) return "Uzbekistan";
      return part;
    }),
  );
}

function normalizeSectors(value: Cell): {
  scopes: string[];
  families: CatalogSectorFamily[];
} {
  const raw = cellText(value);
  const scopes: string[] = [];
  const families: CatalogSectorFamily[] = [];
  for (const part of splitScopeList(raw)) {
    if (/^(all(?: sectors?)?|cross-sector|listed companies|large companies|high-emitting sectors)$/i.test(part)) {
      scopes.push("All");
      families.push("All");
    } else if (/bank|financial|finance|lending|insurance|asset management|wealth management|capital markets?/i.test(part)) {
      scopes.push("Banking");
      families.push("Financial Services");
    } else if (/construction|cement|infrastructure|contractor/i.test(part)) {
      scopes.push("Construction");
      families.push("Built Environment");
    } else if (/real estate|property|buildings?|developers?|reit/i.test(part)) {
      scopes.push("Real Estate");
      families.push("Built Environment");
    } else if (!/^power\b/i.test(part) && /oil\s*(?:&|and)\s*gas|petroleum|upstream|midstream|downstream|lng|fossil fuel/i.test(part)) {
      scopes.push("Oil & Gas");
      families.push("Energy");
    } else {
      scopes.push(part);
      if (/\benergy\b|power|electricity|utilities|storage|trade\s*&\s*retail/i.test(part)) {
        families.push("Energy");
      }
    }
  }
  if (families.length === 0) families.push("Other");
  return { scopes: unique(scopes), families: unique(families) as CatalogSectorFamily[] };
}

function splitScopeList(value: string): string[] {
  return value
    .split(/[,;\n]+/)
    .map((part) => part.trim().replace(/^and\s+/i, ""))
    .filter(Boolean);
}

function splitPublishers(value: Cell): string[] {
  return unique(
    cellText(value)
      .split(/[;,\n]+/)
      .map((part) => part.trim()),
  );
}

function normalizePageReferences(value: Cell): string[] {
  return unique(
    cellText(value)
      .split(/[;\n]+/)
      .map((part) => part.trim()),
  );
}

function inferEvidenceCategory(
  section: EsgDriverSection,
  name: string,
  logic: string,
  target: string,
): CatalogEvidenceCategory {
  const text = `${name} ${logic} ${target}`.toLowerCase();
  if (section === "Regulatory Requirements") {
    if (
      /\b(standard|criteria|methodology|protocol|science-based|science based)\b/.test(text) &&
      !/\b(regulation|regulatory|law|mandatory|rule|taxonomy|directive|ets|emissions trading|cbam|carbon border)\b/.test(text)
    ) {
      return "standard";
    }
    if (/\b(policy|strategy|roadmap|ndc|programme|program|plan)\b/.test(text)) {
      return "policy";
    }
    return "regulation";
  }
  if (/standard|criteria|methodology|protocol|science-based|science based/.test(text)) return "standard";
  if (/regulation|regulatory|law|mandatory|requirement|rule|taxonomy|compliance|directive|\bets\b|emissions trading|cbam|carbon border/.test(text)) {
    return "regulation";
  }
  if (/forecast|projection|outlook|projected|scenario/.test(text)) return "forecast";
  if (/market|issuance|finance|financing|capital|investment|premium/.test(text)) return "market-metric";
  if (/policy|strategy|ndc|commitment|target|net.zero|phase.out/.test(text)) return "policy";
  if (/risk|exposure|loss|vulnerability|resilience|adaptation|stranded/.test(text)) return "risk";
  if (/framework|principles|guidance/.test(text)) return "evergreen-framework";
  return "other";
}

function registryLogicIdsFor(section: EsgDriverSection): string[] {
  switch (section) {
    case "Global Drivers":
      return [
        "global-climate-commitments",
        "sector-emissions-footprint",
        "sector-transition-initiative",
        "sustainable-finance-market",
        "sector-target-setting-pressure",
      ];
    case "Regulatory Requirements":
      return [
        "global-disclosure-standards",
        "country-climate-policy",
        "country-sector-regulation",
        "market-disclosure-rule",
        "country-taxonomy-framework",
      ];
    case "Climate Risks":
      return [
        "global-climate-macro-risk",
        "country-sector-climate-risk",
        "financial-supervisor-climate-risk",
        "country-adaptation-resilience",
      ];
    case "Capital Markets":
      return [
        "investor-lender-expectations",
        "development-finance-pressure",
        "sustainable-capital-access",
        "climate-risk-capital-expectations",
      ];
    case "Supply Chain":
      return [
        "supply-chain-climate-exposure",
        "sector-supply-chain-solution",
        "scope-3-accounting-expectation",
        "supplier-disclosure-pressure",
      ];
  }
}

function requiredSheet(workbook: XLSX.WorkBook, sheetName: string): XLSX.WorkSheet {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error(`Malformed ESG catalog workbook: missing sheet ${sheetName}`);
  return sheet;
}

function rowsFor(sheet: XLSX.WorkSheet): Row[] {
  return XLSX.utils.sheet_to_json<Row>(sheet, {
    header: 1,
    defval: "",
    raw: false,
  });
}

function validateHeaders(sheetName: string, headers: Row): void {
  const normalized = headers.map(normalizeHeader);
  const required = [
    "driver section",
    "driver type",
    "driver name",
    "countries",
    "sector",
    "driver logic",
  ];
  for (const header of required) {
    if (!normalized.includes(header)) {
      throw new Error(`Malformed ESG catalog workbook: ${sheetName} is missing ${header}`);
    }
  }
  if (!normalized.some((header) => header === "evidence/kpi" || header === "evidence / kpi")) {
    throw new Error(`Malformed ESG catalog workbook: ${sheetName} is missing Evidence/KPI`);
  }
  if (!normalized.includes("link")) {
    throw new Error(`Malformed ESG catalog workbook: ${sheetName} is missing Link`);
  }
}

function parseBaseRecord(sheetName: string, row: Row, sourceRow: number): ParsedRecordBase {
  const sector = normalizeSectors(row[4]);
  return {
    sourceSheet: sheetName,
    sourceRow,
    section: normalizeSection(row[0]),
    type: normalizeDriverType(row[1]),
    name: cellText(row[2]),
    countryScopes: normalizeCountries(row[3]),
    sectorScopes: sector.scopes,
    sectorFamilies: sector.families,
    logic: cellText(row[5]),
    evidenceTarget: cellText(row[6]),
    keyPublishers: splitPublishers(row[7]),
    workbookUrls: [],
  };
}

function hostnameFromPatternValue(value: string): string | null {
  try {
    return normalizeCatalogHostname(
      new URL(value.replace(/\{[^}]+\}/g, "catalog")).hostname,
    );
  } catch {
    const candidate = value.replace(/^\*\./, "").split("/")[0];
    return candidate.includes(".") ? normalizeCatalogHostname(candidate) : null;
  }
}

function buildDirectPublisherPolicies(): DirectPublisherPolicy[] {
  const byDomain = new Map<string, DirectPublisherPolicy>();
  for (const approval of APPROVED_DRIVER_SOURCES) {
    if (approval.usage !== "direct") continue;
    const values = [approval.fallbackUrl, ...approval.urlPatterns.map((pattern) => pattern.value)];
    for (const value of values) {
      const domain = hostnameFromPatternValue(value);
      if (!domain) continue;
      const existing = byDomain.get(domain);
      if (existing) {
        existing.registryApprovalIds = unique([...existing.registryApprovalIds, approval.id]);
      } else {
        byDomain.set(domain, {
          domain,
          publisherId: `publisher-${slugify(domain)}`,
          publisherLabel: approval.label,
          registryApprovalIds: [approval.id],
        });
      }
    }
  }
  return [...byDomain.values()].sort((left, right) => left.domain.localeCompare(right.domain));
}

function findDirectPublisher(
  url: string,
  policies: DirectPublisherPolicy[],
): DirectPublisherPolicy | undefined {
  const host = normalizeCatalogHostname(new URL(url).hostname);
  return policies
    .filter((policy) => domainMatchesCatalogPolicy(host, policy.domain))
    .sort((left, right) => right.domain.length - left.domain.length)[0];
}

function isReviewedGuidanceUrl(url: string): boolean {
  const host = normalizeCatalogHostname(new URL(url).hostname);
  return REVIEWED_CATALOG_GUIDANCE_DOMAINS.some((domain) =>
    domainMatchesCatalogPolicy(host, domain),
  );
}

function createArchetype(
  base: ParsedRecordBase,
  catalogOrder: number,
  origin: "master" | "specialist",
  specialistLibrary: string | null,
  activeForSectors: string[],
  document: DriverArchetype["document"],
  directPolicies: DirectPublisherPolicy[],
): DriverArchetype {
  if (!base.name || !base.logic || !base.evidenceTarget) {
    throw new Error(
      `Malformed ESG catalog workbook: ${base.sourceSheet}!${base.sourceRow} is missing name, logic, or evidence target`,
    );
  }
  if (base.workbookUrls.length === 0) {
    throw new Error(
      `Missing source coverage for ${base.sourceSheet}!${base.sourceRow} (${base.name})`,
    );
  }
  for (const url of base.workbookUrls) {
    if (!findDirectPublisher(url, directPolicies) && !isReviewedGuidanceUrl(url)) {
      throw new Error(
        `Unreviewed publisher domain in ${base.sourceSheet}!${base.sourceRow}: ${new URL(url).hostname}`,
      );
    }
  }
  const seedUrls = base.workbookUrls.filter((url) => findDirectPublisher(url, directPolicies));
  const guidanceOnlyUrls = base.workbookUrls.filter((url) => !seedUrls.includes(url));
  const semanticKey = [
    base.sourceSheet,
    base.name,
    base.countryScopes.join("|"),
    base.sectorScopes.join("|"),
    base.logic,
  ].join("::");
  const semanticSuffix = createHash("sha256").update(semanticKey).digest("hex").slice(0, 8);
  const id = `${origin === "master" ? "master" : slugify(base.sourceSheet)}-${slugify(base.name)}-${semanticSuffix}`;
  return {
    id,
    catalogOrder,
    origin,
    sourceSheet: base.sourceSheet,
    sourceRow: base.sourceRow,
    specialistLibrary,
    activeForSectors,
    section: base.section,
    type: base.type,
    name: base.name,
    countryScopes: base.countryScopes,
    sectorScopes: base.sectorScopes,
    sectorFamilies: base.sectorFamilies,
    logic: base.logic,
    preciseQuestion: `What current, direct evidence confirms “${base.name}” for the selected country and sector?`,
    evidenceTarget: base.evidenceTarget,
    exampleGuidance: `${base.name}: ${base.evidenceTarget}`,
    keyPublishers: base.keyPublishers,
    workbookUrls: base.workbookUrls,
    seedUrls,
    guidanceOnlyUrls,
    sourceStatus:
      seedUrls.length > 0
        ? "reviewed-seed"
        : guidanceOnlyUrls.length > 0
          ? "reviewed-guidance-only"
          : "missing",
    document,
    evidenceCategory: inferEvidenceCategory(
      base.section,
      base.name,
      base.logic,
      base.evidenceTarget,
    ),
    registryLogicIds: registryLogicIdsFor(base.section),
  };
}

function parseMasterArchetypes(
  workbook: XLSX.WorkBook,
  directPolicies: DirectPublisherPolicy[],
): DriverArchetype[] {
  const rows = rowsFor(requiredSheet(workbook, "Mastersheet"));
  const headers = rows[0] ?? [];
  validateHeaders("Mastersheet", headers);
  const firstLinkIndex = headers.findIndex((header) => normalizeHeader(header) === "link");
  const records = rows
    .slice(1)
    .map((row, index) => ({ row, sourceRow: index + 2 }))
    .filter(({ row }) => cellText(row[2]).length > 0);
  if (records.length !== EXPECTED_MASTER_RECORDS) {
    throw new Error(`Expected ${EXPECTED_MASTER_RECORDS} master records, found ${records.length}`);
  }
  return records.map(({ row, sourceRow }, catalogOrder) => {
    const base = parseBaseRecord("Mastersheet", row, sourceRow);
    base.workbookUrls = unique(
      row.slice(firstLinkIndex).flatMap((value) => extractUrls(value)),
    );
    return createArchetype(
      base,
      catalogOrder,
      "master",
      null,
      [],
      null,
      directPolicies,
    );
  });
}

function parseSpecialistArchetypes(
  workbook: XLSX.WorkBook,
  firstCatalogOrder: number,
  directPolicies: DirectPublisherPolicy[],
): DriverArchetype[] {
  const archetypes: DriverArchetype[] = [];
  let catalogOrder = firstCatalogOrder;
  for (const config of SPECIALIST_SHEETS) {
    const rows = rowsFor(requiredSheet(workbook, config.name));
    const headers = rows[0] ?? [];
    validateHeaders(config.name, headers);
    const normalizedHeaders = headers.map(normalizeHeader);
    const linkIndex = normalizedHeaders.findIndex((header) => header === "link");
    const pageIndex = normalizedHeaders.findIndex((header) => header === "page");
    const keySourcesIndex = normalizedHeaders.findIndex((header) => header === "key sources");
    const records = rows
      .slice(1)
      .map((row, index) => ({ row, sourceRow: index + 2 }))
      .filter(({ row }) => cellText(row[2]).length > 0);
    let documentUrl = "";
    for (const { row, sourceRow } of records) {
      const explicitUrls = extractUrls(row[linkIndex]);
      const inheritedUrl = explicitUrls.length === 0;
      if (explicitUrls.length > 0) documentUrl = explicitUrls[0];
      if (!documentUrl) {
        throw new Error(
          `Missing inherited specialist document URL at ${config.name}!${sourceRow}`,
        );
      }
      const base = parseBaseRecord(config.name, row, sourceRow);
      base.keyPublishers =
        keySourcesIndex >= 0 ? splitPublishers(row[keySourcesIndex]) : [];
      base.workbookUrls = [documentUrl];
      const pageReferences = pageIndex >= 0 ? normalizePageReferences(row[pageIndex]) : [];
      archetypes.push(
        createArchetype(
          base,
          catalogOrder,
          "specialist",
          config.library,
          [...config.activeForSectors],
          {
            title: config.library,
            url: documentUrl,
            version: config.version,
            pageReferences,
            inheritedUrl,
          },
          directPolicies,
        ),
      );
      catalogOrder += 1;
    }
  }
  if (archetypes.length !== EXPECTED_SPECIALIST_RECORDS) {
    throw new Error(
      `Expected ${EXPECTED_SPECIALIST_RECORDS} specialist records, found ${archetypes.length}`,
    );
  }
  return archetypes;
}

function buildSeedSources(
  archetypes: DriverArchetype[],
  directPolicies: DirectPublisherPolicy[],
): CatalogSource[] {
  const byUrl = new Map<string, CatalogSource>();
  for (const archetype of archetypes) {
    for (const exactUrl of archetype.seedUrls) {
      const publisher = findDirectPublisher(exactUrl, directPolicies);
      if (!publisher) {
        throw new Error(`Unreviewed publisher configured as direct seed: ${exactUrl}`);
      }
      const existing = byUrl.get(exactUrl);
      if (existing) {
        existing.archetypeIds = unique([...existing.archetypeIds, archetype.id]);
        existing.countryScopes = unique([...existing.countryScopes, ...archetype.countryScopes]);
        existing.sectorScopes = unique([...existing.sectorScopes, ...archetype.sectorScopes]);
        existing.registryLogicIds = unique([
          ...existing.registryLogicIds,
          ...archetype.registryLogicIds,
        ]);
      } else {
        byUrl.set(exactUrl, {
          exactUrl,
          domain: normalizeCatalogHostname(new URL(exactUrl).hostname),
          publisherId: publisher.publisherId,
          publisherLabel: publisher.publisherLabel,
          registryApprovalIds: publisher.registryApprovalIds,
          archetypeIds: [archetype.id],
          countryScopes: [...archetype.countryScopes],
          sectorScopes: [...archetype.sectorScopes],
          registryLogicIds: [...archetype.registryLogicIds],
        });
      }
    }
  }
  return [...byUrl.values()].sort((left, right) => left.exactUrl.localeCompare(right.exactUrl));
}

function validateUniqueIds(archetypes: DriverArchetype[]): void {
  const seen = new Set<string>();
  for (const archetype of archetypes) {
    if (seen.has(archetype.id)) throw new Error(`Duplicate ESG catalog ID: ${archetype.id}`);
    seen.add(archetype.id);
  }
}

function pipelineSha256(): string {
  const hash = createHash("sha256");
  for (const path of PIPELINE_INPUT_PATHS) {
    hash.update(path.slice(WEB_ROOT.length).replaceAll("\\", "/"));
    hash.update("\0");
    // Catalog identity must be stable across Windows and Linux checkouts.
    // Normalize text line endings before hashing the generation pipeline.
    hash.update(readFileSync(path, "utf8").replace(/\r\n/g, "\n"));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function buildCatalog(generatedAt: string): EsgDriverCatalog {
  if (!existsSync(WORKBOOK_PATH)) throw new Error(`Catalog workbook not found: ${WORKBOOK_PATH}`);
  const workbookBytes = readFileSync(WORKBOOK_PATH);
  const workbookSha256 = createHash("sha256").update(workbookBytes).digest("hex");
  const pipelineHash = pipelineSha256();
  const workbook = XLSX.read(workbookBytes, { type: "buffer", cellDates: true });
  const directPolicies = buildDirectPublisherPolicies();
  const master = parseMasterArchetypes(workbook, directPolicies);
  const specialist = parseSpecialistArchetypes(workbook, master.length, directPolicies);
  const archetypes = [...master, ...specialist];
  validateUniqueIds(archetypes);
  const seedSources = buildSeedSources(archetypes, directPolicies);
  return {
    manifest: {
      schemaVersion: SCHEMA_VERSION,
      catalogVersion: `${SCHEMA_VERSION}+${workbookSha256.slice(0, 12)}.${pipelineHash.slice(0, 12)}`,
      workbookFile: WORKBOOK_FILE,
      workbookSha256,
      pipelineSha256: pipelineHash,
      generatedAt,
      counts: {
        master: master.length,
        specialist: specialist.length,
        total: archetypes.length,
        seedSources: seedSources.length,
      },
      exposedCountries: ["UAE", "Saudi Arabia", "Kazakhstan"],
      exposedSectors: ["Banking", "Construction", "Real Estate", "Oil & Gas"],
      reviewedDirectDomains: directPolicies.map((policy) => policy.domain),
      reviewedGuidanceDomains: [...REVIEWED_CATALOG_GUIDANCE_DOMAINS].sort(),
    },
    archetypes,
    seedSources,
  };
}

function serializeCatalog(catalog: EsgDriverCatalog): string {
  return `${JSON.stringify(catalog, null, 2)}\n`;
}

function main(): void {
  const command = process.argv[2] ?? "generate";
  if (command !== "generate" && command !== "check") {
    throw new Error(`Usage: esg-driver-catalog.mts <generate|check>`);
  }
  if (command === "generate") {
    const catalog = buildCatalog(new Date().toISOString());
    mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
    writeFileSync(OUTPUT_PATH, serializeCatalog(catalog), "utf8");
    console.log(
      `Generated ESG driver catalog ${catalog.manifest.catalogVersion}: ` +
        `${catalog.manifest.counts.master} master + ` +
        `${catalog.manifest.counts.specialist} specialist records, ` +
        `${catalog.manifest.counts.seedSources} exact reviewed seeds.`,
    );
    return;
  }
  if (!existsSync(OUTPUT_PATH)) {
    throw new Error(`Generated catalog is missing. Run catalog:generate first.`);
  }
  const existingText = readFileSync(OUTPUT_PATH, "utf8");
  const existing = JSON.parse(existingText) as EsgDriverCatalog;
  const expected = serializeCatalog(buildCatalog(existing.manifest.generatedAt));
  if (existingText.replace(/\r\n/g, "\n") !== expected) {
    throw new Error(`Generated ESG driver catalog is stale. Run catalog:generate.`);
  }
  console.log(
    `ESG driver catalog ${existing.manifest.catalogVersion} is current and valid.`,
  );
}

main();
