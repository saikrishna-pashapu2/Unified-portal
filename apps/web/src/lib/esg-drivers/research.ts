import { AsyncLocalStorage } from "node:async_hooks";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP, type LookupFunction } from "node:net";
import * as cheerio from "cheerio";
import { Agent } from "undici";
import { env } from "@/lib/config/env";
import { getPdfJsStandardFontDataUrl } from "@/lib/pdfjs-node";
import {
  buildLogicSearchQueries,
  selectDriverLogics,
  type EsgDriverLogic,
} from "./logic";
import {
  approveDriverSource,
  approvedPublisherHostnames,
  buildApprovedFallbackItems,
  matchApprovedSource,
  normalizeUrlForApproval,
  preflightApprovedDriverSource,
  resolveApprovedCatalogSeedSource,
  resolveApprovedSamePublisherSource,
  type ApprovedDriverSource,
  type CatalogSeedSourceInput,
} from "./source-registry";
import type {
  GenerateEsgDriversInput,
  EsgDriverProgressDetail,
  EsgDriverSource,
  RejectedEsgDriverSource,
} from "./types";

interface GoogleSearchItem {
  title: string;
  link: string;
  snippet: string;
  displayLink?: string;
  pagemap?: Record<string, unknown>;
  snippetOrigin?: "google-search" | "approved-registry";
  isContextualFallback?: boolean;
  /** Request-scoped exact approval derived from a reviewed catalog publisher. */
  approvalRecord?: ApprovedDriverSource;
}

interface LookupAddress {
  address: string;
  family: number;
}

type DnsLookup = (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<LookupAddress[]>;

type FetchLike = typeof globalThis.fetch;

export interface ResearchNetworkDependencies {
  fetchImpl?: FetchLike;
  lookupImpl?: DnsLookup;
}

export interface EsgResearchBudgetOptions {
  maxSearchRequests?: number;
  maxSourceFetches?: number;
  maxDurationMs?: number;
}

export interface EsgResearchBudgetSnapshot {
  searchRequests: number;
  sourceFetches: number;
  maxSearchRequests: number;
  maxSourceFetches: number;
  maxDurationMs: number;
  activeDurationMs: number;
  remainingDurationMs: number;
  deadlineAt: number;
}

interface EsgResearchBudgetState {
  searchRequests: number;
  sourceFetches: number;
  maxSearchRequests: number;
  maxSourceFetches: number;
  maxDurationMs: number;
  activeDurationMs: number;
  activeStartedAt: number | null;
  activeOperations: number;
}

const SOURCE_LIMIT = 24;
const DRIVER_SOURCE_LIMIT = 10;
const LOGIC_HYDRATION_LIMIT = 5;
const FETCH_TIMEOUT_MS = 12000;
const SOURCE_RESPONSE_MAX_BYTES = 3 * 1024 * 1024;
// Reviewed standards and regulatory PDFs are commonly larger than HTML pages.
// Keep a separate hard ceiling to support them without allowing unbounded reads.
const SOURCE_PDF_RESPONSE_MAX_BYTES = 20 * 1024 * 1024;
const GOOGLE_RESPONSE_MAX_BYTES = 1024 * 1024;
const MAX_SOURCE_REDIRECTS = 5;
const SEARCH_CACHE_TTL_MS = 1000 * 60 * 60 * 6;
const SEARCH_CACHE_MAX_ENTRIES = 128;
const GOOGLE_CSE_COOLDOWN_MS = 1000 * 60 * 10;
const GOOGLE_CSE_QUERY_DELAY_MS = 250;
// Research budgets are intentionally disabled: a generation job must never fail
// because a request/fetch/time ceiling was reached. These sentinels are large
// enough to be unreachable in practice while keeping all budget arithmetic
// finite and JSON-safe (Infinity serializes to null in persisted progress
// details). Per-request network timeouts still apply.
const UNLIMITED_REQUEST_COUNT = 1_000_000_000;
const UNLIMITED_DURATION_MS = 365 * 24 * 60 * 60 * 1000;
const DEFAULT_RESEARCH_MAX_SEARCH_REQUESTS = UNLIMITED_REQUEST_COUNT;
const DEFAULT_RESEARCH_MAX_SOURCE_FETCHES = UNLIMITED_REQUEST_COUNT;
const DEFAULT_RESEARCH_MAX_DURATION_MS = UNLIMITED_DURATION_MS;
// Upper bound for retained per-source page evidence. Set at/above the largest
// extraction budget (PDF = 7,000 chars incl. reviewer-cited pages) so no
// content is dropped before the approval gates or the writer see it.
const EVIDENCE_SNIPPET_MAX_CHARS = 8_000;

export interface EsgDriverEvidenceCollection {
  sources: EsgDriverSource[];
  rejectedSources: RejectedEsgDriverSource[];
}

export type EsgSourceFreshnessCategory =
  | "regulation"
  | "policy"
  | "forecast"
  | "market-metric"
  | "standard"
  | "evergreen";

export interface EsgSourceFreshnessPolicy {
  category: EsgSourceFreshnessCategory;
  /** Overrides the conservative category default. */
  maxAgeYears?: number;
  /** Reviewed catalog version expected in the retrieved standard document. */
  expectedDocumentVersion?: string | null;
}

export interface EsgDriverEvidenceCollectionOptions {
  maxQueries?: number;
  maxCandidateSources?: number;
  sourceIdPrefix?: string;
  onSearchEvent?: (
    message: string,
    detail?: EsgDriverProgressDetail,
  ) => Promise<void>;
  /** Exact catalog URLs. These are evidence, never trusted fallback snippets. */
  seedSources?: CatalogSeedSourceInput[];
  freshnessPolicy?: EsgSourceFreshnessPolicy;
}

class GoogleCseRateLimitError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GoogleCseRateLimitError";
  }
}

const googleSearchCache = new Map<
  string,
  { expiresAt: number; items: GoogleSearchItem[] }
>();
let googleCseBlockedUntil = 0;
const researchBudgetStorage = new AsyncLocalStorage<EsgResearchBudgetState>();

const defaultLookup: DnsLookup = async (hostname, options) =>
  dnsLookup(hostname, options);

export class EsgResearchBudgetExceededError extends Error {
  constructor(readonly limit: "search" | "source" | "deadline") {
    super(
      limit === "deadline"
        ? "ESG research deadline was exceeded."
        : `ESG research ${limit} request budget was exhausted.`,
    );
    this.name = "EsgResearchBudgetExceededError";
  }
}

/**
 * Creates one budget for the complete generation job. Nested calls reuse the
 * current budget so individual driver collectors cannot reset the totals.
 * Overrides may only lower the hard production ceilings.
 */
export async function withEsgResearchBudget<T>(
  work: () => Promise<T> | T,
  options: EsgResearchBudgetOptions = {},
): Promise<T> {
  if (researchBudgetStorage.getStore()) return work();
  const state: EsgResearchBudgetState = {
    searchRequests: 0,
    sourceFetches: 0,
    maxSearchRequests: boundedBudgetLimit(
      options.maxSearchRequests,
      DEFAULT_RESEARCH_MAX_SEARCH_REQUESTS,
      DEFAULT_RESEARCH_MAX_SEARCH_REQUESTS,
    ),
    maxSourceFetches: boundedBudgetLimit(
      options.maxSourceFetches,
      DEFAULT_RESEARCH_MAX_SOURCE_FETCHES,
      DEFAULT_RESEARCH_MAX_SOURCE_FETCHES,
    ),
    maxDurationMs: boundedBudgetLimit(
      options.maxDurationMs,
      DEFAULT_RESEARCH_MAX_DURATION_MS,
      DEFAULT_RESEARCH_MAX_DURATION_MS,
      1,
    ),
    activeDurationMs: 0,
    activeStartedAt: null,
    activeOperations: 0,
  };
  return researchBudgetStorage.run(state, work);
}

export function getEsgResearchBudgetSnapshot(): EsgResearchBudgetSnapshot | null {
  const state = researchBudgetStorage.getStore();
  if (!state) return null;
  const now = Date.now();
  const activeDurationMs = getActiveResearchDurationMs(state, now);
  const remainingDurationMs = Math.max(0, state.maxDurationMs - activeDurationMs);
  return {
    searchRequests: state.searchRequests,
    sourceFetches: state.sourceFetches,
    maxSearchRequests: state.maxSearchRequests,
    maxSourceFetches: state.maxSourceFetches,
    maxDurationMs: state.maxDurationMs,
    activeDurationMs,
    remainingDurationMs,
    // Kept for compatibility with callers that display an active deadline. It
    // advances while research is idle because only active research is charged.
    deadlineAt: now + remainingDurationMs,
  };
}

function boundedBudgetLimit(
  value: number | undefined,
  fallback: number,
  hardMaximum: number,
  minimum = 0,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.min(hardMaximum, Math.floor(value)));
}

function consumeResearchBudget(kind: "search" | "source"): void {
  const state = researchBudgetStorage.getStore();
  if (!state) return;
  assertResearchDeadline();
  const usedKey = kind === "search" ? "searchRequests" : "sourceFetches";
  const maximum =
    kind === "search" ? state.maxSearchRequests : state.maxSourceFetches;
  if (state[usedKey] >= maximum) {
    throw new EsgResearchBudgetExceededError(kind);
  }
  state[usedKey] += 1;
}

async function withActiveResearchTime<T>(work: () => Promise<T> | T): Promise<T> {
  const state = researchBudgetStorage.getStore();
  if (!state) return work();

  enterActiveResearch(state);
  try {
    const result = await work();
    assertResearchDeadline();
    return result;
  } catch (error) {
    if (!isResearchBudgetError(error) && isResearchDeadlineExpired(state)) {
      throw new EsgResearchBudgetExceededError("deadline");
    }
    throw error;
  } finally {
    leaveActiveResearch(state);
  }
}

function enterActiveResearch(state: EsgResearchBudgetState): void {
  assertResearchDeadline();
  if (state.activeOperations === 0) state.activeStartedAt = Date.now();
  state.activeOperations += 1;
}

function leaveActiveResearch(state: EsgResearchBudgetState): void {
  if (state.activeOperations <= 0) return;
  state.activeOperations -= 1;
  if (state.activeOperations !== 0 || state.activeStartedAt === null) return;

  state.activeDurationMs += Math.max(0, Date.now() - state.activeStartedAt);
  state.activeStartedAt = null;
}

function getActiveResearchDurationMs(
  state: EsgResearchBudgetState,
  now = Date.now(),
): number {
  const inFlightDuration =
    state.activeOperations > 0 && state.activeStartedAt !== null
      ? Math.max(0, now - state.activeStartedAt)
      : 0;
  return state.activeDurationMs + inFlightDuration;
}

function getRemainingResearchDurationMs(state: EsgResearchBudgetState): number {
  return state.maxDurationMs - getActiveResearchDurationMs(state);
}

function isResearchDeadlineExpired(state: EsgResearchBudgetState): boolean {
  return getRemainingResearchDurationMs(state) <= 0;
}

function assertResearchDeadline(): void {
  const state = researchBudgetStorage.getStore();
  if (state && isResearchDeadlineExpired(state)) {
    throw new EsgResearchBudgetExceededError("deadline");
  }
}

function requestTimeoutWithinBudget(defaultTimeoutMs: number): number {
  const state = researchBudgetStorage.getStore();
  if (!state) return defaultTimeoutMs;
  assertResearchDeadline();
  return Math.max(
    1,
    Math.min(defaultTimeoutMs, getRemainingResearchDurationMs(state)),
  );
}

function isResearchBudgetError(error: unknown): error is EsgResearchBudgetExceededError {
  return error instanceof EsgResearchBudgetExceededError;
}

function throwBudgetDeadlineIfExpired(): void {
  const state = researchBudgetStorage.getStore();
  if (state && isResearchDeadlineExpired(state)) {
    throw new EsgResearchBudgetExceededError("deadline");
  }
}

const AUTHORITY_HINTS = [
  "unfccc.int",
  "ifrs.org",
  "iea.org",
  "worldbank.org",
  "oecd.org",
  "imf.org",
  "un.org",
  "undp.org",
  "unepfi.org",
  "europa.eu",
  "ghgprotocol.org",
  "sciencebasedtargets.org",
  "globalreporting.org",
  "tnfd.global",
  "cdp.net",
  "irena.org",
  "iso.org",
  "centralbank",
  "regulator",
  "ministry",
];

const ESG_TERMS = [
  "esg",
  "sustainability",
  "climate",
  "emissions",
  "net zero",
  "decarbonization",
  "disclosure",
  "reporting",
  "regulation",
  "transition",
  "supply chain",
  "green finance",
  "investor",
  "risk",
];

const RELEVANCE_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "by",
  "for",
  "from",
  "in",
  "into",
  "is",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
]);

export function buildEsgDriverSearchQueries(
  input: GenerateEsgDriversInput,
  logics: EsgDriverLogic[] = selectDriverLogics(input),
): string[] {
  const country = input.country.trim();
  const sector = input.sector.trim();
  const year = new Date().getFullYear();

  return uniqueStrings([
    ...buildLogicSearchQueries(input, logics),
    `${country} ${sector} ESG regulations sustainability disclosure ${year}`,
    `${country} climate strategy net zero NDC sustainability policy updated`,
    `${country} ${sector} climate risk physical transition risk latest`,
    `${country} ${sector} green finance ESG investor requirements sustainable finance`,
    `${sector} global GHG emissions decarbonization pathway ESG initiative`,
    `${country} ${sector} supply chain decarbonization CBAM due diligence`,
    `${country} ${sector} sustainability market trends investor pressure ${year}`,
    `${sector} ESG reporting standards ISSB GRI SBTi sector guidance`,
  ]).slice(0, 16);
}

export function buildDriverLogicSearchQueries(
  input: GenerateEsgDriversInput,
  logic: EsgDriverLogic,
  plannedQueries: string[] = [],
): string[] {
  const country = input.country.trim();
  const sector = input.sector.trim();
  const year = new Date().getFullYear();

  return uniqueStrings([
    ...plannedQueries,
    ...buildLogicSearchQueries(input, [logic]),
    `${country} ${sector} ${logic.evidenceTarget} ${year}`,
    `${country} ${sector} ${logic.preciseQuestion} ESG evidence`,
    `${country} ${sector} ${logic.logic} source`,
    ...logic.sourcePriorities.map(
      (source) => `${country} ${sector} ${source} ${logic.evidenceTarget}`,
    ),
    `${sector} ${logic.evidenceTarget} ${logic.sourcePriorities[0] || ""}`,
  ]).slice(0, 8);
}

export function extractBestDate(input: {
  publishedDate?: string | null;
  updatedDate?: string | null;
  lastModified?: string | null;
  snippet?: string;
  title?: string;
  url?: string;
}): string | null {
  const candidates = [
    input.updatedDate,
    input.publishedDate,
    input.lastModified,
  ];

  for (const candidate of candidates) {
    const iso = normalizeDate(candidate);
    if (iso) return iso;
  }

  return null;
}

export function rankEsgDriverSources(
  sources: EsgDriverSource[],
): EsgDriverSource[] {
  return [...sources]
    .map((source) => ({
      ...source,
      sourceScore:
        source.authorityScore * 0.45 +
        source.relevanceScore * 0.35 +
        source.freshnessScore * 0.2,
    }))
    .filter((source) => source.relevanceScore >= 20 || source.authorityScore >= 75)
    .sort((a, b) => b.sourceScore - a.sourceScore)
    .slice(0, SOURCE_LIMIT);
}

export async function collectEsgDriverEvidence(
  input: GenerateEsgDriversInput,
  onProgress?: (stage: string, progress: number) => Promise<void>,
  logics: EsgDriverLogic[] = selectDriverLogics(input),
): Promise<EsgDriverSource[]> {
  if (!researchBudgetStorage.getStore()) {
    return withEsgResearchBudget(() =>
      collectEsgDriverEvidence(input, onProgress, logics),
    );
  }
  return withActiveResearchTime(() =>
    collectEsgDriverEvidenceActive(input, onProgress, logics),
  );
}

async function collectEsgDriverEvidenceActive(
  input: GenerateEsgDriversInput,
  onProgress: ((stage: string, progress: number) => Promise<void>) | undefined,
  logics: EsgDriverLogic[],
): Promise<EsgDriverSource[]> {
  await onProgress?.("Searching custom ESG sources", 12);

  const queries = buildEsgDriverSearchQueries(input, logics);
  const fallbackItems = dedupeSearchItems(
    buildAuthorityFallbackSearchItems(input, logics),
  ).filter((item) =>
    logics.some(
      (logic) => preflightApprovedDriverSource(item.link, input, logic).approved,
    ),
  );
  const remainingHydrationSlots = Math.max(0, 48 - fallbackItems.length);
  const searchItems = await runGoogleSearchPlan(
    queries,
    Math.min(6, Math.max(1, remainingHydrationSlots)),
    Math.min(40, remainingHydrationSlots),
    async (message) => onProgress?.(message, 18),
  );

  const uniqueItems = dedupeSearchItems([...fallbackItems, ...searchItems])
    .filter((item) =>
      logics.some(
        (logic) => preflightApprovedDriverSource(item.link, input, logic).approved,
      ),
    )
    .slice(0, 48);
  await onProgress?.("Scraping and parsing source pages", 30);

  const hydrated = await runWithConcurrency(uniqueItems, 5, async (item, index) => {
    const source = await hydrateSearchItem(item, input, index + 1);
    const progress = 30 + Math.floor(((index + 1) / uniqueItems.length) * 25);
    await onProgress?.("Scraping and parsing source pages", progress);
    return source;
  });

  await onProgress?.("Ranking source authority and freshness", 58);
  const gated = gateSourcesForAnyLogic(input, logics, hydrated);
  return rankEsgDriverSources(gated.sources);
}

export async function collectEsgDriverEvidenceForLogic(
  input: GenerateEsgDriversInput,
  logic: EsgDriverLogic,
  plannedQueries: string[],
  options: EsgDriverEvidenceCollectionOptions = {},
): Promise<EsgDriverEvidenceCollection> {
  if (!researchBudgetStorage.getStore()) {
    return withEsgResearchBudget(() =>
      collectEsgDriverEvidenceForLogic(input, logic, plannedQueries, options),
    );
  }
  return withActiveResearchTime(() =>
    collectEsgDriverEvidenceForLogicActive(input, logic, plannedQueries, options),
  );
}

async function collectEsgDriverEvidenceForLogicActive(
  input: GenerateEsgDriversInput,
  logic: EsgDriverLogic,
  plannedQueries: string[],
  options: EsgDriverEvidenceCollectionOptions,
): Promise<EsgDriverEvidenceCollection> {
  const effectiveOptions: EsgDriverEvidenceCollectionOptions = {
    ...options,
    freshnessPolicy: withExpectedDocumentVersion(options.freshnessPolicy, logic),
  };
  const maxQueries = Math.max(1, Math.min(options.maxQueries || 8, 8));
  const maxCandidateSources = Math.max(
    1,
    Math.min(options.maxCandidateSources || DRIVER_SOURCE_LIMIT, DRIVER_SOURCE_LIMIT),
  );
  if (effectiveOptions.seedSources?.length) {
    return collectCatalogSeedEvidence(
      input,
      logic,
      plannedQueries,
      effectiveOptions,
      maxQueries,
      maxCandidateSources,
    );
  }
  const queries = buildDriverLogicSearchQueries(input, logic, plannedQueries).slice(
    0,
    maxQueries,
  );
  const fallbackItems = dedupeSearchItems(
    buildAuthorityFallbackSearchItems(input, [logic]),
  )
    .filter(
      (item) => preflightApprovedDriverSource(item.link, input, logic).approved,
    )
    .slice(0, LOGIC_HYDRATION_LIMIT);
  const remainingHydrationSlots = Math.max(
    0,
    LOGIC_HYDRATION_LIMIT - fallbackItems.length,
  );
  const searchItems = await runGoogleSearchPlan(
    queries,
    Math.min(6, Math.max(1, remainingHydrationSlots)),
    remainingHydrationSlots,
    options.onSearchEvent,
  );
  const uniqueItems = dedupeSearchItems([...fallbackItems, ...searchItems])
    // This URL/scope gate must happen before hydrateSearchItem performs DNS or
    // fetch work. The full content-aware gate runs again after retrieval.
    .filter(
      (item) => preflightApprovedDriverSource(item.link, input, logic).approved,
    )
    // Registry fallbacks are ordered first. Hydrating at most five URLs per
    // logic gives every driver a fair share of the job-level network budget;
    // final output can cite no more than three sources.
    .slice(
      0,
      Math.min(
        LOGIC_HYDRATION_LIMIT,
        Math.max(maxCandidateSources * 2, maxCandidateSources + 8),
      ),
    );

  const hydrated = await runWithConcurrency(uniqueItems, 3, async (item, index) =>
    hydrateSearchItem(item, input, index + 1),
  );

  const gated = applyFreshnessPolicy(
    gateSourcesForLogic(input, logic, hydrated),
    logic,
    effectiveOptions.freshnessPolicy,
  );
  const sources = rankDriverLogicSources(gated.sources, logic)
    .slice(0, maxCandidateSources)
    .map((source, index) => ({
      ...source,
      id: `${options.sourceIdPrefix || "S"}${index + 1}`,
    }));

  return {
    sources,
    rejectedSources: gated.rejectedSources,
  };
}

interface ExactCatalogHydrationResult extends EsgDriverEvidenceCollection {
  publisherRecords: ApprovedDriverSource[];
}

async function collectCatalogSeedEvidence(
  input: GenerateEsgDriversInput,
  logic: EsgDriverLogic,
  plannedQueries: string[],
  options: EsgDriverEvidenceCollectionOptions,
  maxQueries: number,
  maxCandidateSources: number,
): Promise<EsgDriverEvidenceCollection> {
  const exact = await hydrateExactCatalogSeeds(
    input,
    logic,
    options.seedSources || [],
    options.freshnessPolicy,
    LOGIC_HYDRATION_LIMIT,
    1,
  );

  // A retrieved, approved direct seed is authoritative. General registry
  // fallbacks and broad searches must not outrank it or spend more budget.
  if (exact.sources.length > 0) {
    return finalizeLogicCollection(exact, logic, options.sourceIdPrefix, maxCandidateSources);
  }

  const publisherRecords = uniqueCatalogPublisherRecords(exact.publisherRecords);
  if (publisherRecords.length === 0) {
    return { sources: [], rejectedSources: exact.rejectedSources };
  }

  const queries = buildSamePublisherQueries(
    input,
    logic,
    plannedQueries,
    publisherRecords,
  ).slice(0, maxQueries);
  let searchItems: GoogleSearchItem[] = [];
  try {
    searchItems = await runGoogleSearchPlan(
      queries,
      Math.min(5, Math.max(1, maxCandidateSources)),
      LOGIC_HYDRATION_LIMIT,
      options.onSearchEvent,
    );
  } catch (error) {
    if (isResearchBudgetError(error)) throw error;
    await options.onSearchEvent?.(
      "Reviewed-publisher refresh search unavailable; rejecting catalog candidate",
    );
  }

  const exactUrls = new Set(
    (options.seedSources || [])
      .map((seed) => normalizeUrlKey(seed.url))
      .filter((value): value is string => Boolean(value)),
  );
  const replacements = dedupeSearchItems(searchItems)
    .filter((item) => !exactUrls.has(normalizeUrlKey(item.link) || ""))
    .flatMap((item): GoogleSearchItem[] => {
      for (const seedRecord of publisherRecords) {
        const approvalRecord = resolveApprovedSamePublisherSource(
          item.link,
          seedRecord,
          logic,
        );
        if (approvalRecord) return [{ ...item, approvalRecord }];
      }
      return [];
    })
    .slice(0, LOGIC_HYDRATION_LIMIT);

  const approved: EsgDriverSource[] = [];
  const rejectedSources = [...exact.rejectedSources];
  for (let index = 0; index < replacements.length; index += 1) {
    const item = replacements[index];
    const record = item.approvalRecord;
    if (!record) continue;
    const source = await hydrateSearchItem(item, input, index + 1);
    const approval = approveDriverSource(source, input, logic, record);
    if (approval.approved && approval.source) approved.push(approval.source);
    else if (approval.rejected) rejectedSources.push(approval.rejected);
  }

  const freshnessGated = applyFreshnessPolicy(
    { sources: approved, rejectedSources },
    logic,
    options.freshnessPolicy,
  );
  return finalizeLogicCollection(
    freshnessGated,
    logic,
    options.sourceIdPrefix,
    maxCandidateSources,
  );
}

/**
 * Re-fetches accepted citations without running a general search. Resume jobs
 * use this to prove that every carried-forward URL is still directly
 * retrievable, in scope, and fresh enough for its evidence category.
 */
export async function revalidateEsgDriverSources(
  input: GenerateEsgDriversInput,
  logic: EsgDriverLogic,
  urls: string[],
  freshnessPolicy?: EsgSourceFreshnessPolicy,
): Promise<EsgDriverEvidenceCollection> {
  if (!researchBudgetStorage.getStore()) {
    return withEsgResearchBudget(() =>
      revalidateEsgDriverSources(input, logic, urls, freshnessPolicy),
    );
  }
  return withActiveResearchTime(async () => {
    const effectiveFreshnessPolicy = withExpectedDocumentVersion(
      freshnessPolicy,
      logic,
    );
    const seeds = uniqueStrings(urls).slice(0, 3).map((url) => ({
      url,
      pageReferences: logic.pageReferences || [],
      documentVersion: logic.documentVersion ?? null,
    }));
    const result = await hydrateExactCatalogSeeds(
      input,
      logic,
      seeds,
      effectiveFreshnessPolicy,
      3,
      seeds.length,
    );
    return {
      // Revalidation preserves citation order so a resumed checkpoint can map
      // its original sourceRefs deterministically after every URL is fetched.
      sources: result.sources.map((source, index) => ({
        ...source,
        id: `S${index + 1}`,
      })),
      rejectedSources: result.rejectedSources,
    };
  });
}

async function hydrateExactCatalogSeeds(
  input: GenerateEsgDriversInput,
  logic: EsgDriverLogic,
  seedSources: CatalogSeedSourceInput[],
  freshnessPolicy: EsgSourceFreshnessPolicy | undefined,
  limit: number,
  requiredApprovedCount: number,
): Promise<ExactCatalogHydrationResult> {
  const approved: EsgDriverSource[] = [];
  const rejectedSources: RejectedEsgDriverSource[] = [];
  const publisherRecords: ApprovedDriverSource[] = [];
  const seeds = dedupeCatalogSeeds(seedSources).slice(0, limit);

  // Exact seeds are intentionally sequential: stop conditions and trace order
  // are deterministic, and one candidate cannot burst through the job budget.
  for (let index = 0; index < seeds.length; index += 1) {
    const seed = seeds[index];
    const record = resolveApprovedCatalogSeedSource(seed, logic);
    if (!record) {
      rejectedSources.push(catalogSeedRejection(seed, logic, "not-approved"));
      continue;
    }
    publisherRecords.push(record);

    const preflight = preflightApprovedDriverSource(seed.url, input, logic, record);
    if (!preflight.approved) {
      rejectedSources.push(
        catalogSeedRejection(
          seed,
          logic,
          preflight.reason || "not-approved",
          record,
        ),
      );
      continue;
    }

    const item: GoogleSearchItem = {
      // Keep retrieved evidence free of workbook-authored labels. The reviewed
      // registry owns the publisher/title shown to downstream writers.
      title: record.fallbackTitle || record.label,
      link: seed.url,
      snippet: "",
      displayLink: getDomain(seed.url) || undefined,
      approvalRecord: record,
    };
    const source = await hydrateSearchItem(item, input, index + 1);
    const approval = approveDriverSource(source, input, logic, record);
    if (approval.approved && approval.source) {
      if (freshnessPolicy) {
        const freshness = evaluateEsgSourceFreshness(
          approval.source,
          freshnessPolicy,
        );
        // Freshness is a ranking signal on a reviewer-curated seed, not a gate.
        // A revised standard or a page that omits an explicit "in force" phrase
        // should rank lower, not disappear — dropping it discards the analyst's
        // hand-picked source and can leave the driver with no evidence at all.
        // evaluateEsgSourceFreshness already returns a reduced score for the
        // not-accepted case; use it so stale seeds fall to the bottom.
        approved.push({ ...approval.source, freshnessScore: freshness.score });
      } else {
        approved.push(approval.source);
      }
      if (approved.length >= requiredApprovedCount) break;
    } else if (approval.rejected) rejectedSources.push(approval.rejected);
  }
  return { sources: approved, rejectedSources, publisherRecords };
}

function finalizeLogicCollection(
  collection: EsgDriverEvidenceCollection,
  logic: EsgDriverLogic,
  sourceIdPrefix: string | undefined,
  maxCandidateSources: number,
): EsgDriverEvidenceCollection {
  return {
    sources: rankDriverLogicSources(collection.sources, logic)
      .slice(0, maxCandidateSources)
      .map((source, index) => ({
        ...source,
        id: `${sourceIdPrefix || "S"}${index + 1}`,
      })),
    rejectedSources: collection.rejectedSources,
  };
}

function buildSamePublisherQueries(
  input: GenerateEsgDriversInput,
  logic: EsgDriverLogic,
  plannedQueries: string[],
  records: ApprovedDriverSource[],
): string[] {
  const bases = uniqueStrings([
    ...plannedQueries,
    `${input.country} ${input.sector} ${logic.evidenceTarget}`,
    `${input.country} ${input.sector} ${logic.preciseQuestion}`,
  ]);
  const queries: string[] = [];
  for (const record of records) {
    for (const domain of approvedPublisherHostnames(record)) {
      for (const base of bases) {
        queries.push(`site:${domain} ${base} latest current`);
      }
    }
  }
  return uniqueStrings(queries);
}

function uniqueCatalogPublisherRecords(
  records: ApprovedDriverSource[],
): ApprovedDriverSource[] {
  const seen = new Set<string>();
  return records.filter((record) => {
    const domains = approvedPublisherHostnames(record).sort().join("|");
    const key = `${record.reviewedPublisherSourceId || record.id}:${domains}`;
    if (!domains || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeCatalogSeeds(
  seeds: CatalogSeedSourceInput[],
): CatalogSeedSourceInput[] {
  const seen = new Set<string>();
  return seeds.filter((seed) => {
    const key = normalizeUrlKey(seed.url);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function catalogSeedRejection(
  seed: CatalogSeedSourceInput,
  logic: EsgDriverLogic,
  reason: "not-approved" | "country-mismatch" | "sector-mismatch" | "logic-mismatch",
  record?: ApprovedDriverSource,
): RejectedEsgDriverSource {
  const detail =
    reason === "not-approved"
      ? "Catalog URL is not bound to a reviewed direct publisher for this driver."
      : `Catalog URL failed ${reason.replace("-", " ")} preflight.`;
  return {
    id: `catalog-${stableTextToken(seed.url)}`,
    title: seed.title || seed.publisher || "Catalog seed",
    url: seed.url,
    domain: getDomain(seed.url) || "unknown",
    driverLogicId: logic.id,
    reason,
    detail,
    approvalId: record?.id,
    rejectedAt: new Date().toISOString(),
  };
}

function gateSourcesForLogic(
  input: GenerateEsgDriversInput,
  logic: EsgDriverLogic,
  sources: EsgDriverSource[],
): EsgDriverEvidenceCollection {
  const approved: EsgDriverSource[] = [];
  const rejectedSources: RejectedEsgDriverSource[] = [];

  for (const source of sources) {
    const result = approveDriverSource(source, input, logic);
    if (result.approved && result.source) {
      approved.push(result.source);
    } else if (result.rejected) {
      rejectedSources.push(result.rejected);
    }
  }

  return {
    sources: approved,
    rejectedSources,
  };
}

function gateSourcesForAnyLogic(
  input: GenerateEsgDriversInput,
  logics: EsgDriverLogic[],
  sources: EsgDriverSource[],
): EsgDriverEvidenceCollection {
  const approved: EsgDriverSource[] = [];
  const rejectedSources: RejectedEsgDriverSource[] = [];

  for (const source of sources) {
    let accepted: EsgDriverSource | null = null;
    const rejectedForSource: RejectedEsgDriverSource[] = [];

    for (const logic of logics) {
      const result = approveDriverSource(source, input, logic);
      if (result.approved && result.source) {
        accepted = result.source;
        break;
      }
      if (result.rejected) rejectedForSource.push(result.rejected);
    }

    if (accepted) {
      approved.push(accepted);
    } else if (rejectedForSource[0]) {
      rejectedSources.push(rejectedForSource[0]);
    }
  }

  return {
    sources: approved,
    rejectedSources,
  };
}

async function runGoogleSearchPlan(
  queries: string[],
  maxResultsPerQuery: number,
  targetUniqueItems: number,
  onSearchEvent?: (
    message: string,
    detail?: EsgDriverProgressDetail,
  ) => Promise<void>,
): Promise<GoogleSearchItem[]> {
  if (targetUniqueItems <= 0 || queries.length === 0) return [];
  const collected: GoogleSearchItem[] = [];
  const minQueries = Math.min(
    targetUniqueItems > maxResultsPerQuery ? 2 : 1,
    queries.length,
  );

  for (let index = 0; index < queries.length; index += 1) {
    const uniqueCount = dedupeSearchItems(collected).length;
    if (index >= minQueries && uniqueCount >= targetUniqueItems) break;

    try {
      await onSearchEvent?.("Searching reviewed publisher results", {
        kind: "search",
        title: "Searching reviewed publishers",
        detail: `Query ${index + 1} of at most ${queries.length}; results remain candidates until direct-page verification passes.`,
        query: queries[index],
        outcome: "running",
      });
      const items = await searchGoogleCustomSearch(
        queries[index],
        maxResultsPerQuery,
      );
      collected.push(...items);
      await onSearchEvent?.(
        `Search returned ${items.length} candidate result${items.length === 1 ? "" : "s"}`,
        {
          kind: "search-results",
          title: "Candidate search results",
          query: queries[index],
          resultCount: items.length,
          outcome: items.length > 0 ? "found" : "warning",
          detail:
            items.length > 0
              ? "These pages still require publisher, scope, freshness, and direct-evidence checks."
              : "No candidate pages were returned for this query.",
          results: items.slice(0, 6).map((item) => ({
            title: item.title,
            url: item.link,
            domain: getDomain(item.link) || item.displayLink,
            outcome: "found",
          })),
        },
      );
    } catch (error) {
      if (isResearchBudgetError(error)) throw error;
      if (isGoogleCseRateLimitError(error)) {
        await onSearchEvent?.("CSE limited, using official-source fallback", {
          kind: "search",
          title: "Search provider limited",
          query: queries[index],
          detail: "Continuing with exact catalog seeds and reviewed publisher fallbacks.",
          outcome: "warning",
        });
        break;
      }

      await onSearchEvent?.("Search query skipped, continuing research", {
        kind: "search",
        title: "Search query skipped",
        query: queries[index],
        detail: errorMessage(error),
        outcome: "warning",
      });
    }

    if (index < queries.length - 1) {
      await sleep(GOOGLE_CSE_QUERY_DELAY_MS);
    }
  }

  return dedupeSearchItems(collected);
}

export async function searchGoogleCustomSearch(
  query: string,
  maxResults: number,
  dependencies: ResearchNetworkDependencies = {},
): Promise<GoogleSearchItem[]> {
  return withActiveResearchTime(() =>
    searchGoogleCustomSearchActive(query, maxResults, dependencies),
  );
}

async function searchGoogleCustomSearchActive(
  query: string,
  maxResults: number,
  dependencies: ResearchNetworkDependencies,
): Promise<GoogleSearchItem[]> {
  const apiKey = env.GOOGLE_API_KEY_2?.trim();
  const cseId = env.GOOGLE_CSE_ID_2?.trim();

  if (!apiKey || !cseId) {
    throw new Error("Missing GOOGLE_API_KEY_2 or GOOGLE_CSE_ID_2 for ESG driver research.");
  }

  if (Date.now() < googleCseBlockedUntil) {
    throw new GoogleCseRateLimitError(
      "Google CSE is cooling down after a rate-limit response.",
      429,
    );
  }

  const normalizedQuery = cleanText(query).slice(0, 500);
  if (!normalizedQuery) return [];
  const resultLimit = Math.min(Math.max(maxResults, 1), 10);
  const cacheKey = `${normalizedQuery}::${resultLimit}`;
  pruneGoogleSearchCache();
  const cached = googleSearchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    // Refresh insertion order so the bounded map behaves as a small LRU cache.
    googleSearchCache.delete(cacheKey);
    googleSearchCache.set(cacheKey, cached);
    return cached.items;
  }

  const params = new URLSearchParams({
    key: apiKey,
    cx: cseId,
    q: normalizedQuery,
    num: String(resultLimit),
    safe: "active",
  });

  const url = `https://www.googleapis.com/customsearch/v1?${params.toString()}`;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetchGoogleResponse(url, dependencies);
    const body = response.bytes.toString("utf8");

    if (response.ok) {
      const data = parseGoogleResponse(body);
      const items = Array.isArray(data.items) ? data.items : [];
      const parsedItems = items
        .map(toGoogleSearchItem)
        .filter((item: GoogleSearchItem) => item.title && item.link);

      evictGoogleSearchCacheForInsert(cacheKey);
      googleSearchCache.set(cacheKey, {
        expiresAt: Date.now() + SEARCH_CACHE_TTL_MS,
        items: parsedItems,
      });
      return parsedItems;
    }

    if (response.status === 429 || response.status === 403) {
      const errorBody = body.slice(0, 500);
      const isQuotaOrRateLimited =
        response.status === 429 ||
        /quota|ratelimit|rate limit|dailylimit|userRateLimitExceeded/i.test(
          errorBody,
        );
      if (!isQuotaOrRateLimited) {
        throw new Error(
          `Google CSE search failed with status ${response.status}. ${errorBody}`.trim(),
        );
      }

      const retryAfter = parseRetryAfterMs(response.headers.get("retry-after"));
      lastError = new GoogleCseRateLimitError(
        `Google CSE search failed with status ${response.status}. ${errorBody}`.trim(),
        response.status,
      );

      if (attempt === 0 && retryAfter !== null && retryAfter <= 5000) {
        await sleep(retryAfter);
        continue;
      }

      googleCseBlockedUntil = Date.now() + GOOGLE_CSE_COOLDOWN_MS;
      throw lastError;
    }

    if (response.status >= 500 && attempt === 0) {
      lastError = new Error(`Google CSE search failed with status ${response.status}.`);
      await sleep(750);
      continue;
    }

    throw new Error(`Google CSE search failed with status ${response.status}.`);
  }

  throw lastError || new Error("Google CSE search failed.");
}

function buildAuthorityFallbackSearchItems(
  input: GenerateEsgDriversInput,
  logics: EsgDriverLogic[],
): GoogleSearchItem[] {
  const approvedFallbacks = buildApprovedFallbackItems(input, logics);
  if (approvedFallbacks.length > 0) {
    return approvedFallbacks.map((item) => ({
      ...item,
      snippetOrigin: "approved-registry" as const,
    }));
  }

  const country = input.country.trim();
  const sector = input.sector.trim();
  const logicIds = new Set(logics.map((logic) => logic.id));
  const logicSummary = uniqueStrings(
    logics.map((logic) => logic.evidenceTarget),
  ).join("; ");
  const context = `${country} ${sector}`.trim();
  const items: GoogleSearchItem[] = [];
  const wants = (...ids: string[]) => ids.some((id) => logicIds.has(id));

  if (
    wants(
      "global-climate-commitments",
      "country-climate-policy",
      "global-climate-macro-risk",
    )
  ) {
    items.push(
      fallbackItem(
        "UNFCCC - The Paris Agreement",
        "https://unfccc.int/process-and-meetings/the-paris-agreement",
        `Official UNFCCC source for the Paris Agreement and NDC framework relevant to ${context}. Evidence target: ${logicSummary}.`,
      ),
      fallbackItem(
        "UNFCCC - Nationally Determined Contributions Registry",
        "https://unfccc.int/NDCREG",
        `Official UNFCCC registry for country NDC submissions and climate policy documents relevant to ${context}.`,
      ),
      fallbackItem(
        "World Bank - Climate Change",
        "https://www.worldbank.org/ext/en/topic/climate-change",
        `World Bank climate source for macroeconomic climate risk and policy context relevant to ${context}.`,
      ),
    );
  }

  if (wants("global-disclosure-standards", "country-sector-regulation")) {
    items.push(
      fallbackItem(
        "IFRS Foundation - IFRS Sustainability Standards",
        "https://www.ifrs.org/issued-standards/ifrs-sustainability-standards-navigator/",
        `IFRS Foundation source for ISSB disclosure standards and sustainability reporting expectations relevant to ${context}.`,
      ),
      fallbackItem(
        "IOSCO - Sustainable finance",
        "https://www.iosco.org/about/?subsection=sustainable_finance",
        `IOSCO source for securities-regulator sustainability disclosure and market-supervision context relevant to ${context}.`,
      ),
    );
  }

  if (
    wants(
      "global-climate-macro-risk",
      "country-sector-climate-risk",
      "investor-lender-expectations",
    )
  ) {
    items.push(
      fallbackItem(
        "FSB - Climate-related financial risks",
        "https://www.fsb.org/work-of-the-fsb/financial-innovation-and-structural-change/climate-related-risks/",
        `Financial Stability Board source for climate-related financial risk and supervisory expectations relevant to ${context}.`,
      ),
      fallbackItem(
        "NGFS - Network for Greening the Financial System",
        "https://www.ngfs.net/en",
        `NGFS source for central-bank and supervisor climate-risk work relevant to ${context}.`,
      ),
    );
  }

  if (wants("supply-chain-climate-exposure", "sector-supply-chain-solution")) {
    items.push(
      fallbackItem(
        "GHG Protocol - Scope 3 Guidance",
        "https://ghgprotocol.org/scope-3-calculation-guidance-2",
        `GHG Protocol source for Scope 3 and value-chain emissions accounting relevant to ${context}.`,
      ),
      fallbackItem(
        "CDP - Supply Chain",
        "https://www.cdp.net/en/supply-chain",
        `CDP source for supplier climate disclosure and supply-chain engagement relevant to ${context}.`,
      ),
    );
  }

  items.push(...countryFallbackItems(country, sector, logicSummary));
  items.push(...sectorFallbackItems(country, sector, logicSummary));

  return dedupeSearchItems(items);
}

function countryFallbackItems(
  country: string,
  sector: string,
  logicSummary: string,
): GoogleSearchItem[] {
  const normalized = country.toLowerCase();
  const context = `${country} ${sector}`.trim();
  const items: GoogleSearchItem[] = [
    fallbackItem(
      "World Bank Climate Change Knowledge Portal",
      `https://climateknowledgeportal.worldbank.org/country/${countrySlug(country)}`,
      `World Bank country climate profile source for physical risk and policy context relevant to ${context}. Evidence target: ${logicSummary}.`,
    ),
  ];

  if (normalized === "uae" || normalized.includes("united arab emirates")) {
    items.push(
      fallbackItem(
        "UAE Government - Net Zero 2050",
        "https://u.ae/en/about-the-uae/strategies-initiatives-and-awards/strategies-plans-and-visions/environment-and-energy/the-uae-net-zero-2050-strategy",
        `Official UAE Government source for the UAE Net Zero 2050 strategic initiative relevant to ${context}.`,
      ),
      fallbackItem(
        "UAE Government - National Climate Adaptation Action Plan",
        "https://u.ae/en/about-the-uae/strategies-initiatives-and-awards/strategies-plans-and-visions/environment-and-energy/national-climate-adaptation-action-plan",
        `Official UAE Government climate adaptation and resilience source relevant to ${context}.`,
      ),
      fallbackItem(
        "UAE Government - National Climate Change Plan 2017-2050",
        "https://u.ae/en/about-the-uae/strategies-initiatives-and-awards/strategies-plans-and-visions/environment-and-energy/national-climate-change-plan-of-the-uae",
        `Official UAE Government climate-risk and adaptation framework relevant to ${context}.`,
      ),
      fallbackItem(
        "Central Bank of the UAE - Sustainable Finance",
        "https://www.centralbank.ae/en/our-operations/sustainable-finance/",
        `Central Bank of the UAE source for sustainable finance and banking-sector supervisory context relevant to ${context}.`,
      ),
      fallbackItem(
        "DFSA - Sustainable Finance",
        "https://www.dfsa.ae/what-we-do/sustainable-finance",
        `Dubai Financial Services Authority source for sustainable finance and disclosure context relevant to ${context}.`,
      ),
      fallbackItem(
        "ADGM - Sustainable Finance",
        "https://www.adgm.com/initiatives/sustainable-finance",
        `Abu Dhabi Global Market source for sustainable finance market context relevant to ${context}.`,
      ),
    );
  } else if (normalized.includes("saudi")) {
    items.push(
      fallbackItem(
        "Saudi Green Initiative",
        "https://www.greeninitiatives.gov.sa/",
        `Official Saudi Green Initiative source for Saudi climate and sustainability targets relevant to ${context}.`,
      ),
      fallbackItem(
        "Saudi Vision 2030",
        "https://www.vision2030.gov.sa/en/",
        `Official Saudi Vision 2030 source for national transformation and sustainability context relevant to ${context}.`,
      ),
      fallbackItem(
        "Saudi Central Bank",
        "https://www.sama.gov.sa/en-US/Pages/default.aspx",
        `Saudi Central Bank source for banking and financial-sector supervisory context relevant to ${context}.`,
      ),
    );
  } else if (normalized.includes("kazakhstan")) {
    items.push(
      fallbackItem(
        "Kazakhstan Ministry of Ecology and Natural Resources",
        "https://www.gov.kz/memleket/entities/ecogeo?lang=en",
        `Official Kazakhstan environment ministry source for climate and sustainability policy context relevant to ${context}.`,
      ),
      fallbackItem(
        "Kazakhstan Carbon Neutrality Strategy",
        "https://adilet.zan.kz/eng/docs/U2300000121",
        `Official legal source for Kazakhstan carbon-neutrality strategy context relevant to ${context}.`,
      ),
      fallbackItem(
        "Astana International Financial Centre",
        "https://aifc.kz/",
        `AIFC source for Kazakhstan sustainable finance and capital-market context relevant to ${context}.`,
      ),
    );
  }

  return items;
}

function sectorFallbackItems(
  country: string,
  sector: string,
  logicSummary: string,
): GoogleSearchItem[] {
  const normalized = sector.toLowerCase();
  const context = `${country} ${sector}`.trim();

  if (/\bbank|financial|finance|insurance|lending|credit\b/.test(normalized)) {
    return [
      fallbackItem(
        "UNEP FI - Principles for Responsible Banking",
        "https://www.unepfi.org/banking/bankingprinciples/",
        `UNEP FI source for responsible banking expectations and bank ESG strategy relevant to ${context}. Evidence target: ${logicSummary}.`,
      ),
      fallbackItem(
        "UNEP FI - Net-Zero Banking Alliance",
        "https://www.unepfi.org/net-zero-banking/",
        `UNEP FI source for bank net-zero and financed-emissions expectations relevant to ${context}.`,
      ),
      fallbackItem(
        "PCAF - Global GHG Accounting and Reporting Standard",
        "https://carbonaccountingfinancials.com/standard",
        `PCAF source for financed-emissions accounting in banking and financial institutions relevant to ${context}.`,
      ),
      fallbackItem(
        "Basel Committee - Climate-related financial risks",
        "https://www.bis.org/bcbs/publ/d532.htm",
        `Basel Committee source for climate-related financial risk principles relevant to ${context}.`,
      ),
    ];
  }

  if (/construction|cement|building materials|contractor|real estate|property|buildings?|reit/.test(normalized)) {
    return [
      fallbackItem(
        "IEA - Buildings",
        "https://www.iea.org/energy-system/buildings",
        `IEA source for buildings energy and emissions context relevant to ${context}. Evidence target: ${logicSummary}.`,
      ),
      fallbackItem(
        "GlobalABC - Global Alliance for Buildings and Construction",
        "https://globalabc.org/",
        `GlobalABC source for buildings and construction decarbonization context relevant to ${context}.`,
      ),
      fallbackItem(
        "World Green Building Council - Advancing Net Zero",
        "https://worldgbc.org/advancing-net-zero/",
        `WorldGBC source for green buildings and net-zero building expectations relevant to ${context}.`,
      ),
    ];
  }

  if (/\b(oil|gas|petroleum|lng|upstream|downstream)\b/.test(normalized)) {
    return [
      fallbackItem(
        "IEA - Oil and gas industry in net zero transitions",
        "https://www.iea.org/reports/the-oil-and-gas-industry-in-net-zero-transitions",
        `IEA source for oil and gas transition risks and decarbonization pathways relevant to ${context}. Evidence target: ${logicSummary}.`,
      ),
      fallbackItem(
        "IEA - Global Methane Tracker",
        "https://www.iea.org/reports/global-methane-tracker-2024",
        `IEA source for methane emissions and oil and gas climate performance context relevant to ${context}.`,
      ),
      fallbackItem(
        "OGMP 2.0",
        "https://www.ogmpartnership.com/",
        `Oil and Gas Methane Partnership source for methane reporting and mitigation expectations relevant to ${context}.`,
      ),
    ];
  }

  return [
    fallbackItem(
      "Science Based Targets initiative - Sectors",
      "https://sciencebasedtargets.org/sectors",
      `SBTi sector source for science-based target-setting context relevant to ${context}. Evidence target: ${logicSummary}.`,
    ),
    fallbackItem(
      "IEA",
      "https://www.iea.org/",
      `IEA source for sector energy transition and emissions context relevant to ${context}.`,
    ),
  ];
}

function fallbackItem(title: string, link: string, _snippet: string): GoogleSearchItem {
  const approvedSnippet = matchApprovedSource(link)?.fallbackSnippet || "";
  return {
    title,
    link,
    // Discard dynamically composed fallback copy. Only static, reviewed registry
    // context may accompany a source URL when no page has been retrieved.
    snippet: approvedSnippet,
    displayLink: getDomain(link) || undefined,
    snippetOrigin: "approved-registry",
    isContextualFallback: true,
  };
}

function countrySlug(country: string): string {
  const normalized = country.trim().toLowerCase();
  if (normalized === "uae" || normalized.includes("united arab emirates")) {
    return "united-arab-emirates";
  }
  if (normalized.includes("saudi")) return "saudi-arabia";
  if (normalized.includes("kazakhstan")) return "kazakhstan";
  return normalized.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function isGoogleCseRateLimitError(
  error: unknown,
): error is GoogleCseRateLimitError {
  return error instanceof GoogleCseRateLimitError;
}

interface BoundedFetchResponse {
  ok: boolean;
  status: number;
  headers: Headers;
  bytes: Buffer;
  url: string;
}

async function fetchGoogleResponse(
  url: string,
  dependencies: ResearchNetworkDependencies = {},
): Promise<BoundedFetchResponse> {
  const fetchImpl = dependencies.fetchImpl || globalThis.fetch;
  const requestTimeoutMs = requestTimeoutWithinBudget(FETCH_TIMEOUT_MS);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    consumeResearchBudget("search");
    const response = await fetchImpl(url, {
      signal: controller.signal,
      redirect: "error",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    const bytes = await readResponseBytes(response, GOOGLE_RESPONSE_MAX_BYTES);
    const contentType = normalizedContentType(response.headers);
    if (response.ok && contentType !== "application/json") {
      throw new Error(`Google CSE returned unsupported content type ${contentType || "unknown"}.`);
    }
    return {
      ok: response.ok,
      status: response.status,
      headers: response.headers,
      bytes,
      url: response.url || url,
    };
  } catch (error) {
    if (controller.signal.aborted) {
      throwBudgetDeadlineIfExpired();
      throw new Error(`Google CSE request timed out after ${requestTimeoutMs} ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function parseGoogleResponse(body: string): { items?: unknown[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error("Google CSE returned invalid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const items = (parsed as Record<string, unknown>).items;
  return { items: Array.isArray(items) ? items : undefined };
}

function toGoogleSearchItem(value: unknown): GoogleSearchItem {
  const item =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const pagemap =
    item.pagemap && typeof item.pagemap === "object" && !Array.isArray(item.pagemap)
      ? (item.pagemap as Record<string, unknown>)
      : undefined;
  return {
    title: typeof item.title === "string" ? item.title.trim() : "",
    link: typeof item.link === "string" ? item.link.trim() : "",
    snippet: typeof item.snippet === "string" ? item.snippet.trim() : "",
    displayLink:
      typeof item.displayLink === "string" ? item.displayLink.trim() : undefined,
    pagemap,
    snippetOrigin: "google-search",
    isContextualFallback: false,
  };
}

function pruneGoogleSearchCache(now = Date.now()): void {
  for (const [key, entry] of Array.from(googleSearchCache.entries())) {
    if (entry.expiresAt <= now) googleSearchCache.delete(key);
  }
}

function evictGoogleSearchCacheForInsert(cacheKey: string): void {
  googleSearchCache.delete(cacheKey);
  while (googleSearchCache.size >= SEARCH_CACHE_MAX_ENTRIES) {
    const oldestKey = googleSearchCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    googleSearchCache.delete(oldestKey);
  }
}

function parseRetryAfterMs(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = new Date(value).getTime();
  if (Number.isNaN(date)) return null;
  return Math.max(0, date - Date.now());
}

function sleep(ms: number): Promise<void> {
  const state = researchBudgetStorage.getStore();
  const remaining = state ? getRemainingResearchDurationMs(state) : ms;
  if (remaining <= 0) {
    return Promise.reject(new EsgResearchBudgetExceededError("deadline"));
  }
  const delay = Math.min(ms, remaining);
  return new Promise((resolve, reject) =>
    setTimeout(() => {
      try {
        throwBudgetDeadlineIfExpired();
        resolve();
      } catch (error) {
        reject(error);
      }
    }, delay),
  );
}

async function hydrateSearchItem(
  item: GoogleSearchItem,
  input: GenerateEsgDriversInput,
  index: number,
): Promise<EsgDriverSource> {
  const retrievedAt = new Date().toISOString();
  const domain = getDomain(item.link) || item.displayLink || "unknown";
  let contentSnippet = "";
  let publishedDate: string | null = extractDateFromPagemap(item.pagemap, "published");
  let updatedDate: string | null = extractDateFromPagemap(item.pagemap, "updated");
  let lastModified: string | null = null;
  let finalUrl: string | null = null;
  let retrievalStatus: EsgDriverSource["retrievalStatus"] = "failed";
  let evidenceProvenance: EsgDriverSource["evidenceProvenance"] =
    item.isContextualFallback && item.snippetOrigin === "approved-registry"
      ? "approved-context"
      : "search-snippet";
  let retrievalError: string | null = null;
  const approvedRecord = item.approvalRecord || matchApprovedSource(item.link);

  try {
    const approvalId = approvedRecord?.id;
    if (!approvalId) throw new Error("Source URL is not in the approved registry.");
    const fetched = item.approvalRecord
      ? await fetchSourceSnippetForApprovedRecord(
          item.link,
          item.approvalRecord,
        )
      : await fetchSourceSnippet(item.link, approvalId);
    contentSnippet = fetched.contentSnippet;
    if (fetched.publishedDate) publishedDate = fetched.publishedDate;
    if (fetched.updatedDate) updatedDate = fetched.updatedDate;
    if (fetched.lastModified) lastModified = fetched.lastModified;
    finalUrl = fetched.finalUrl;
    retrievalStatus = "retrieved";
    evidenceProvenance = "retrieved-page";
  } catch (error) {
    if (isResearchBudgetError(error)) throw error;
    retrievalError = errorMessage(error);
  }

  const bestDate = extractBestDate({
    publishedDate,
    updatedDate,
    lastModified,
  });

  const authorityScore = scoreAuthority(
    domain,
    item.link,
    approvedRecord?.authorityScoreFloor,
  );
  const freshnessScore = scoreFreshness(bestDate);
  const relevanceScore = scoreRelevance(
    `${item.title} ${item.snippet} ${contentSnippet}`,
    input,
  );

  return {
    id: `S${index}`,
    title: cleanText(item.title).slice(0, 220),
    url: item.link,
    domain,
    snippet: cleanText(item.snippet).slice(0, 700),
    // Keep the full extracted evidence (HTML extraction caps at 4,500, PDF at
    // 7,000 including reviewer-cited pages). Truncating here — before the
    // country/sector/concept/claim/freshness gates and the writer — silently
    // discards the very page content those gates look for, which falsely
    // rejects valid catalog seeds and starves the writer of real KPI numbers.
    contentSnippet: cleanText(contentSnippet).slice(0, EVIDENCE_SNIPPET_MAX_CHARS),
    retrievalStatus,
    evidenceProvenance,
    isContextualFallback: Boolean(item.isContextualFallback),
    finalUrl,
    retrievalError,
    publishedDate,
    updatedDate,
    lastModified,
    retrievedAt,
    authorityScore,
    freshnessScore,
    relevanceScore,
    sourceScore: 0,
  };
}

export async function fetchSourceSnippet(
  url: string,
  expectedApprovalId: string,
  dependencies: ResearchNetworkDependencies = {},
): Promise<{
  contentSnippet: string;
  publishedDate: string | null;
  updatedDate: string | null;
  lastModified: string | null;
  finalUrl: string;
}> {
  return withActiveResearchTime(() =>
    fetchSourceSnippetActive(url, expectedApprovalId, dependencies),
  );
}

async function fetchSourceSnippetActive(
  url: string,
  expectedApprovalId: string,
  dependencies: ResearchNetworkDependencies,
  explicitRecord?: ApprovedDriverSource,
): Promise<{
  contentSnippet: string;
  publishedDate: string | null;
  updatedDate: string | null;
  lastModified: string | null;
  finalUrl: string;
}> {
  const initialRecord = explicitRecord || matchApprovedSource(url);
  if (!initialRecord || initialRecord.id !== expectedApprovalId) {
    throw new Error("Source URL is not approved for retrieval.");
  }

  const fetchImpl = dependencies.fetchImpl || globalThis.fetch;
  const lookupImpl = dependencies.lookupImpl || defaultLookup;
  const requestTimeoutMs = requestTimeoutWithinBudget(FETCH_TIMEOUT_MS);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  let currentUrl = new URL(url);

  try {
    for (let redirectCount = 0; redirectCount <= MAX_SOURCE_REDIRECTS; redirectCount += 1) {
      assertResearchDeadline();
      assertApprovedRedirect(currentUrl, expectedApprovalId, explicitRecord);
      const addresses = await resolveSafePublicUrl(currentUrl, { lookupImpl });
      const dispatcher = createPinnedDispatcher(addresses);

      try {
        consumeResearchBudget("source");
        const requestInit: RequestInit & { dispatcher: Agent } = {
          signal: controller.signal,
          redirect: "manual",
          cache: "no-store",
          dispatcher,
          headers: {
            Accept:
              "text/html,application/xhtml+xml,application/pdf;q=0.9,text/plain;q=0.8",
            "User-Agent":
              "Mozilla/5.0 (compatible; ESGCreditPortal/1.0; +https://example.com)",
          },
        };
        const response = await fetchImpl(currentUrl.toString(), requestInit);

        if (response.redirected) {
          await cancelResponseBody(response);
          throw new Error("Source fetch followed an unvalidated redirect.");
        }

        if (isRedirectStatus(response.status)) {
          const location = response.headers.get("location");
          await cancelResponseBody(response);
          if (!location) throw new Error("Source redirect did not include a location.");
          if (redirectCount >= MAX_SOURCE_REDIRECTS) {
            throw new Error("Source exceeded the redirect limit.");
          }
          const nextUrl = new URL(location, currentUrl);
          assertApprovedRedirect(nextUrl, expectedApprovalId, explicitRecord);
          currentUrl = nextUrl;
          continue;
        }

        if (!response.ok) {
          await cancelResponseBody(response);
          throw new Error(`Source fetch failed with status ${response.status}.`);
        }

        if (response.url && normalizeUrlKey(response.url) !== normalizeUrlKey(currentUrl.toString())) {
          await cancelResponseBody(response);
          throw new Error("Source fetch returned an unexpected final URL.");
        }

        const contentType = normalizedContentType(response.headers);
        assertSupportedSourceContentType(contentType, currentUrl);
        const isPdfResponse =
          contentType === "application/pdf" ||
          (contentType === "application/octet-stream" && isPdfPath(currentUrl));
        const buffer = await readResponseBytes(
          response,
          isPdfResponse
            ? SOURCE_PDF_RESPONSE_MAX_BYTES
            : SOURCE_RESPONSE_MAX_BYTES,
        );
        const lastModified = normalizeDate(response.headers.get("last-modified"));

        if (
          isPdfResponse
        ) {
          if (!looksLikePdf(buffer)) throw new Error("Source response was not a valid PDF.");
          const contentSnippet = await extractPdfText(
            buffer,
            explicitRecord?.catalogPageReferences || [],
          );
          assertUsableRetrievedText(contentSnippet);
          return {
            contentSnippet,
            publishedDate: null,
            updatedDate: null,
            lastModified,
            finalUrl: currentUrl.toString(),
          };
        }

        if (contentType === "text/plain") {
          const contentSnippet = cleanText(buffer.toString("utf8")).slice(0, 4500);
          assertUsableRetrievedText(contentSnippet);
          return {
            contentSnippet,
            publishedDate: null,
            updatedDate: null,
            lastModified,
            finalUrl: currentUrl.toString(),
          };
        }

        const parsed = parseHtmlSource(buffer.toString("utf8"), lastModified);
        assertUsableRetrievedText(parsed.contentSnippet);
        return { ...parsed, finalUrl: currentUrl.toString() };
      } finally {
        await dispatcher.close();
      }
    }

    throw new Error("Source exceeded the redirect limit.");
  } catch (error) {
    if (controller.signal.aborted) {
      throwBudgetDeadlineIfExpired();
      throw new Error(`Source fetch timed out after ${requestTimeoutMs} ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchSourceSnippetForApprovedRecord(
  url: string,
  record: ApprovedDriverSource,
  dependencies: ResearchNetworkDependencies = {},
): Promise<{
  contentSnippet: string;
  publishedDate: string | null;
  updatedDate: string | null;
  lastModified: string | null;
  finalUrl: string;
}> {
  return fetchSourceSnippetActive(url, record.id, dependencies, record);
}

export interface CatalogEvidenceFetchResult {
  contentSnippet: string;
  publishedDate: string | null;
  updatedDate: string | null;
  lastModified: string | null;
  finalUrl: string;
}

/**
 * Registry-free fetch for exact catalog (Excel) URLs. The workbook link list is
 * itself the curated allowlist, so this path drops the hardcoded source
 * registry and its scope/version gates. It keeps every network safety control:
 * HTTP(S) only, no credentials, standard ports only, per-hop SSRF resolution
 * against public IPs with a pinned dispatcher (no DNS-rebinding TOCTOU), manual
 * redirects re-resolved each hop, bounded reads, and PDF/HTML/plain extraction.
 */
export async function fetchCatalogEvidence(
  url: string,
  options: { pageReferences?: string[] } = {},
  dependencies: ResearchNetworkDependencies = {},
): Promise<CatalogEvidenceFetchResult> {
  const fetchImpl = dependencies.fetchImpl || globalThis.fetch;
  const lookupImpl = dependencies.lookupImpl || defaultLookup;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let currentUrl = new URL(url);

  try {
    for (
      let redirectCount = 0;
      redirectCount <= MAX_SOURCE_REDIRECTS;
      redirectCount += 1
    ) {
      const addresses = await resolveSafePublicUrl(currentUrl, { lookupImpl });
      const dispatcher = createPinnedDispatcher(addresses);
      try {
        const requestInit: RequestInit & { dispatcher: Agent } = {
          signal: controller.signal,
          redirect: "manual",
          cache: "no-store",
          dispatcher,
          headers: {
            Accept:
              "text/html,application/xhtml+xml,application/pdf;q=0.9,text/plain;q=0.8",
            "User-Agent":
              "Mozilla/5.0 (compatible; ESGCreditPortal/1.0; +https://example.com)",
          },
        };
        const response = await fetchImpl(currentUrl.toString(), requestInit);

        if (response.redirected) {
          await cancelResponseBody(response);
          throw new Error("Source fetch followed an unvalidated redirect.");
        }
        if (isRedirectStatus(response.status)) {
          const location = response.headers.get("location");
          await cancelResponseBody(response);
          if (!location) throw new Error("Source redirect did not include a location.");
          if (redirectCount >= MAX_SOURCE_REDIRECTS) {
            throw new Error("Source exceeded the redirect limit.");
          }
          currentUrl = new URL(location, currentUrl);
          continue;
        }
        if (!response.ok) {
          await cancelResponseBody(response);
          throw new Error(`Source fetch failed with status ${response.status}.`);
        }

        const contentType = normalizedContentType(response.headers);
        assertSupportedSourceContentType(contentType, currentUrl);
        const isPdfResponse =
          contentType === "application/pdf" ||
          (contentType === "application/octet-stream" && isPdfPath(currentUrl));
        const buffer = await readResponseBytes(
          response,
          isPdfResponse ? SOURCE_PDF_RESPONSE_MAX_BYTES : SOURCE_RESPONSE_MAX_BYTES,
        );
        const lastModified = normalizeDate(response.headers.get("last-modified"));

        if (isPdfResponse) {
          if (!looksLikePdf(buffer)) throw new Error("Source response was not a valid PDF.");
          const contentSnippet = await extractPdfText(
            buffer,
            options.pageReferences || [],
          );
          assertUsableRetrievedText(contentSnippet);
          return {
            contentSnippet,
            publishedDate: null,
            updatedDate: null,
            lastModified,
            finalUrl: currentUrl.toString(),
          };
        }
        if (contentType === "text/plain") {
          const contentSnippet = cleanText(buffer.toString("utf8")).slice(
            0,
            EVIDENCE_SNIPPET_MAX_CHARS,
          );
          assertUsableRetrievedText(contentSnippet);
          return {
            contentSnippet,
            publishedDate: null,
            updatedDate: null,
            lastModified,
            finalUrl: currentUrl.toString(),
          };
        }

        const parsed = parseHtmlSource(buffer.toString("utf8"), lastModified);
        assertUsableRetrievedText(parsed.contentSnippet);
        return { ...parsed, finalUrl: currentUrl.toString() };
      } finally {
        await dispatcher.close();
      }
    }
    throw new Error("Source exceeded the redirect limit.");
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Source fetch timed out after ${FETCH_TIMEOUT_MS} ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function resolveSafePublicUrl(
  value: string | URL,
  dependencies: Pick<ResearchNetworkDependencies, "lookupImpl"> = {},
): Promise<LookupAddress[]> {
  const url = value instanceof URL ? value : new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Only HTTP(S) source URLs are allowed.");
  }
  if (url.username || url.password) {
    throw new Error("Source URLs with credentials are not allowed.");
  }
  if (
    (url.protocol === "https:" && url.port && url.port !== "443") ||
    (url.protocol === "http:" && url.port && url.port !== "80")
  ) {
    throw new Error("Source URLs with non-standard ports are not allowed.");
  }

  const hostname = stripIpv6Brackets(url.hostname).toLowerCase();
  if (!hostname || isBlockedHostname(hostname)) {
    throw new Error("Source hostname is not public.");
  }

  const literalFamily = isIP(hostname);
  const addresses = literalFamily
    ? [{ address: hostname, family: literalFamily }]
    : await withNetworkTimeout(
        (dependencies.lookupImpl || defaultLookup)(hostname, {
          all: true,
          verbatim: true,
        }),
        requestTimeoutWithinBudget(FETCH_TIMEOUT_MS),
        "Source DNS lookup timed out.",
      );
  if (addresses.length === 0) throw new Error("Source hostname did not resolve.");

  const unique = new Map<string, LookupAddress>();
  for (const result of addresses) {
    const address = stripIpv6Brackets(result.address).toLowerCase();
    const family = isIP(address);
    if (!family || !isPublicIpAddress(address)) {
      throw new Error("Source hostname resolved to a non-public address.");
    }
    unique.set(`${family}:${address}`, { address, family });
  }
  return Array.from(unique.values());
}

async function withNetworkTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => {
          try {
            throwBudgetDeadlineIfExpired();
            reject(new Error(message));
          } catch (error) {
            reject(error);
          }
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function isPublicIpAddress(address: string): boolean {
  const normalized = stripIpv6Brackets(address).toLowerCase();
  const family = isIP(normalized);
  if (family === 4) return isPublicIpv4(normalized);
  if (family !== 6) return false;

  const mappedIpv4 = extractMappedIpv4(normalized);
  if (mappedIpv4) return isPublicIpv4(mappedIpv4);

  const groups = normalized.split(":");
  const first = Number.parseInt(groups[0] || "0", 16);
  const second = Number.parseInt(groups[1] || "0", 16);
  // Globally routable unicast space is currently allocated from 2000::/3.
  if (first < 0x2000 || first > 0x3fff) return false;

  if (
    // IETF protocol assignments, benchmarking, ORCHID, Teredo, and other
    // non-global special-purpose ranges within 2001::/23.
    (first === 0x2001 && second <= 0x01ff) ||
    normalized.startsWith("2001:db8:") ||
    normalized === "2001:db8::" ||
    // 6to4 can encode arbitrary IPv4 destinations and must not bypass IPv4
    // private-range checks.
    first === 0x2002 ||
    // Former 6bone and documentation allocations.
    first === 0x3ffe ||
    (first === 0x3fff && second <= 0x0fff)
  ) {
    return false;
  }
  return true;
}

function isPublicIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return false;
  }
  const [a, b, c] = octets;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
  if (a === 192 && b === 88 && c === 99) return false;
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) {
    return false;
  }
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function extractMappedIpv4(address: string): string | null {
  if (!address.startsWith("::ffff:")) return null;
  const tail = address.slice("::ffff:".length);
  if (isIP(tail) === 4) return tail;
  const groups = tail.split(":");
  if (groups.length !== 2 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) {
    return null;
  }
  const high = Number.parseInt(groups[0], 16);
  const low = Number.parseInt(groups[1], 16);
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
}

function stripIpv6Brackets(value: string): string {
  return value.replace(/^\[|\]$/g, "");
}

function isBlockedHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "metadata.google.internal" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".lan") ||
    hostname.endsWith(".home") ||
    hostname.endsWith(".test") ||
    hostname.endsWith(".invalid")
  );
}

function createPinnedDispatcher(addresses: LookupAddress[]): Agent {
  const pinnedLookup: LookupFunction = (_hostname, options, callback) => {
    const requestedFamily = Number(options.family || 0);
    const candidates = requestedFamily
      ? addresses.filter((address) => address.family === requestedFamily)
      : addresses;
    const selected = candidates.length > 0 ? candidates : addresses;
    if (options.all) {
      callback(null, selected.map(({ address, family }) => ({ address, family })));
      return;
    }
    const first = selected[0];
    callback(null, first.address, first.family);
  };

  return new Agent({
    connect: { lookup: pinnedLookup },
    connectTimeout: FETCH_TIMEOUT_MS,
    headersTimeout: FETCH_TIMEOUT_MS,
    bodyTimeout: FETCH_TIMEOUT_MS,
  });
}

function assertApprovedRedirect(
  url: URL,
  expectedApprovalId: string,
  explicitRecord?: ApprovedDriverSource,
): void {
  if (explicitRecord) {
    if (
      normalizeUrlForApproval(url.toString()) !==
      normalizeUrlForApproval(explicitRecord.catalogExactUrl || "")
    ) {
      throw new Error("Source redirect left the approved URL scope.");
    }
    return;
  }
  const record = matchApprovedSource(url.toString());
  if (!record || record.id !== expectedApprovalId) {
    throw new Error("Source redirect left the approved URL scope.");
  }
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The response is being discarded; cancellation failures are non-actionable.
  }
}

async function readResponseBytes(response: Response, maxBytes: number): Promise<Buffer> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength && /^\d+$/.test(declaredLength.trim())) {
    const length = Number(declaredLength);
    if (length > maxBytes) {
      await cancelResponseBody(response);
      throw new Error(`Source response exceeded the ${maxBytes}-byte limit.`);
    }
  }

  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        // Preserve the bounded-response error below.
      }
      throw new Error(`Source response exceeded the ${maxBytes}-byte limit.`);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

function normalizedContentType(headers: Headers): string {
  return (headers.get("content-type") || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
}

function assertSupportedSourceContentType(contentType: string, url: URL): void {
  if (
    contentType === "text/html" ||
    contentType === "application/xhtml+xml" ||
    contentType === "text/plain" ||
    contentType === "application/pdf" ||
    (contentType === "application/octet-stream" && isPdfPath(url))
  ) {
    return;
  }
  throw new Error(`Source returned unsupported content type ${contentType || "unknown"}.`);
}

function isPdfPath(url: URL): boolean {
  return url.pathname.toLowerCase().endsWith(".pdf");
}

function looksLikePdf(buffer: Buffer): boolean {
  return buffer.subarray(0, 5).toString("ascii") === "%PDF-";
}

function assertUsableRetrievedText(text: string): void {
  if (cleanText(text).length < 45) {
    throw new Error("Source did not contain enough usable page text.");
  }
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Source retrieval failed.";
  return cleanText(message).slice(0, 300);
}

function parseHtmlSource(
  html: string,
  lastModified: string | null,
): {
  contentSnippet: string;
  publishedDate: string | null;
  updatedDate: string | null;
  lastModified: string | null;
} {
  const $ = cheerio.load(html);
  $("script, style, noscript, svg, nav, footer, header, form").remove();

  const publishedDate = normalizeDate(
    $('meta[property="article:published_time"]').attr("content") ||
      $('meta[name="date"]').attr("content") ||
      $('meta[name="dc.date"]').attr("content") ||
      $("time[datetime]").first().attr("datetime") ||
      null,
  );

  const updatedDate = normalizeDate(
    $('meta[property="article:modified_time"]').attr("content") ||
      $('meta[name="last-modified"]').attr("content") ||
      $('meta[name="updated"]').attr("content") ||
      null,
  );

  const parts: string[] = [];
  $("main p, article p, p, li, h1, h2, h3").each((_, element) => {
    const text = cleanText($(element).text());
    if (text.length >= 45) parts.push(text);
  });

  const relevant = parts.filter((part) =>
    ESG_TERMS.some((term) => part.toLowerCase().includes(term)),
  );
  const selected = relevant.length >= 4 ? relevant : parts;

  return {
    contentSnippet: selected.slice(0, 18).join(" ").slice(0, 4500),
    publishedDate,
    updatedDate,
    lastModified,
  };
}

async function extractPdfText(
  buffer: Buffer,
  pageReferences: readonly string[],
): Promise<string> {
  const globalScope = globalThis as any;
  globalScope.DOMMatrix ||= class {};
  globalScope.Path2D ||= class {};

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
    standardFontDataUrl: getPdfJsStandardFontDataUrl(),
    // Invalid TrueType hint programs are ignored safely by PDF.js. Keep that
    // recoverable parser detail out of worker logs while preserving errors.
    verbosity: pdfjs.VerbosityLevel.ERRORS,
  });
  const document = await loadingTask.promise;
  try {
    const pageNumbers = selectPdfPages(document.numPages, pageReferences);
    const pages: string[] = [];
    for (const pageNumber of pageNumbers) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .flatMap((item) =>
          "str" in item && typeof item.str === "string" ? [item.str] : [],
        )
        .join(" ");
      const cleaned = cleanText(text);
      if (cleaned) pages.push(`Page ${pageNumber}: ${cleaned.slice(0, 1400)}`);
      page.cleanup();
    }
    return cleanText(pages.join(" ")).slice(0, 7000);
  } finally {
    await document.destroy();
  }
}

function selectPdfPages(
  totalPages: number,
  pageReferences: readonly string[],
): number[] {
  const selected = new Set<number>();
  if (totalPages > 0) selected.add(1);

  for (const reference of pageReferences) {
    const pagePart = reference.match(/\bpp?\.?\s*(.*)$/i)?.[1] || "";
    for (const token of pagePart.match(/\d{1,4}/g) || []) {
      const page = Number(token);
      if (page >= 1 && page <= totalPages) selected.add(page);
      if (selected.size >= 12) break;
    }
    if (selected.size >= 12) break;
  }

  if (selected.size === 1 && pageReferences.length === 0) {
    for (let page = 2; page <= Math.min(totalPages, 12); page += 1) {
      selected.add(page);
    }
  }
  return Array.from(selected).sort((left, right) => left - right).slice(0, 12);
}

function extractDateFromPagemap(
  pagemap: Record<string, unknown> | undefined,
  mode: "published" | "updated",
): string | null {
  if (!pagemap) return null;

  const keys =
    mode === "published"
      ? ["datepublished", "publishdate", "datecreated"]
      : ["datemodified", "dateupdated", "lastmod"];

  for (const value of Object.values(pagemap)) {
    if (!Array.isArray(value)) continue;
    for (const entry of value) {
      if (!entry || typeof entry !== "object") continue;
      const record = entry as Record<string, unknown>;
      for (const key of keys) {
        const matched = Object.entries(record).find(
          ([candidate]) => candidate.toLowerCase() === key,
        );
        if (matched && typeof matched[1] === "string") {
          const normalized = normalizeDate(matched[1]);
          if (normalized) return normalized;
        }
      }
    }
  }

  return null;
}

export function scoreAuthority(
  domain: string,
  url: string,
  approvedFloor = 0,
): number {
  const normalized = `${domain} ${url}`.toLowerCase();
  let score = 45;

  if (/(^|\.)gov(\.|$)/.test(domain) || /\.gov\./.test(domain)) score += 35;
  if (domain.endsWith(".int")) score += 30;
  if (domain.endsWith(".edu")) score += 15;
  if (domain.endsWith(".org")) score += 12;
  if (AUTHORITY_HINTS.some((hint) => normalized.includes(hint))) score += 30;
  if (/(ministry|authority|regulator|central-bank|centralbank)/.test(normalized)) {
    score += 18;
  }
  if (/(blog|press-release|opinion|sponsored)/.test(normalized)) score -= 12;

  return clampScore(Math.max(score, approvedFloor));
}

export function scoreFreshness(date: string | null): number {
  if (!date) return 45;

  const time = new Date(date).getTime();
  if (Number.isNaN(time)) return 45;

  const ageDays = (Date.now() - time) / (1000 * 60 * 60 * 24);
  if (ageDays < -2) return 20;
  if (ageDays <= 180) return 100;
  if (ageDays <= 365) return 90;
  if (ageDays <= 365 * 3) return 75;
  if (ageDays <= 365 * 5) return 60;
  return 40;
}

export interface EsgSourceFreshnessEvaluation {
  accepted: boolean;
  score: number;
  reason?: string;
}

function withExpectedDocumentVersion(
  policy: EsgSourceFreshnessPolicy | undefined,
  logic: EsgDriverLogic,
): EsgSourceFreshnessPolicy | undefined {
  if (!policy || policy.category !== "standard" || policy.expectedDocumentVersion) {
    return policy;
  }
  return {
    ...policy,
    expectedDocumentVersion: logic.documentVersion ?? null,
  };
}

/** Category-aware freshness gate used by catalog evidence and resume checks. */
export function evaluateEsgSourceFreshness(
  source: EsgDriverSource,
  policy: EsgSourceFreshnessPolicy,
  now = new Date(),
): EsgSourceFreshnessEvaluation {
  const bestDate = extractBestDate(source);
  const baseScore = scoreFreshness(bestDate);
  if (policy.category === "evergreen") {
    // Unknown dates remain neutral. Evergreen frameworks do not receive an
    // invented recency boost simply because their concepts remain useful.
    return { accepted: true, score: baseScore };
  }

  const maxAgeYears = Math.max(
    0.25,
    Math.min(policy.maxAgeYears || defaultFreshnessYears(policy.category), 20),
  );
  const cutoffTime =
    now.getTime() - maxAgeYears * 365.25 * 24 * 60 * 60 * 1000;
  const dateIsRecent = Boolean(
    bestDate && new Date(bestDate).getTime() >= cutoffTime,
  );
  const text = cleanText(
    `${source.title} ${source.url} ${source.contentSnippet}`,
  ).toLowerCase();
  const hasCurrentStatus =
    /\b(currently effective|currently in force|remains in force|effective as of|in force|current policy|current regulation|latest update)\b/.test(
      text,
    );

  if (policy.category === "standard") {
    const expectedVersion = policy.expectedDocumentVersion?.trim();
    const hasExpectedVersion = expectedVersion
      ? standardVersionAppears(text, expectedVersion)
      : false;
    const isLatestActiveVersion =
      /\b(latest (?:active |current )?version|current active version|currently effective standard|latest standard|current version|supersedes? version)\b/.test(
        text,
      );
    if (expectedVersion && !hasExpectedVersion) {
      return {
        accepted: false,
        score: Math.min(baseScore, 40),
        reason: `Standard source does not contain reviewed document version ${expectedVersion}.`,
      };
    }
    if (!expectedVersion && !isLatestActiveVersion) {
      return {
        accepted: false,
        score: Math.min(baseScore, 40),
        reason: "Standard source does not establish that it is the publisher's latest active version.",
      };
    }
    return { accepted: true, score: dateIsRecent ? baseScore : Math.max(baseScore, 55) };
  }

  if (policy.category === "regulation" || policy.category === "policy") {
    if (!dateIsRecent && !hasCurrentStatus) {
      return {
        accepted: false,
        score: Math.min(baseScore, 35),
        reason: `${policy.category} source is neither recent nor explicitly shown as currently effective.`,
      };
    }
    return { accepted: true, score: dateIsRecent ? baseScore : Math.max(baseScore, 55) };
  }

  const recentMetricYear = latestHistoricalEvidenceYear(text, now.getUTCFullYear());
  const metricYearIsRecent =
    recentMetricYear !== null &&
    recentMetricYear >= now.getUTCFullYear() - Math.ceil(maxAgeYears);
  if (!dateIsRecent && !(policy.category === "market-metric" && metricYearIsRecent)) {
    return {
      accepted: false,
      score: Math.min(baseScore, 35),
      reason:
        policy.category === "market-metric"
          ? "Market metric has no recent publication date or independently retrieved metric year."
          : "Forecast source is outside the accepted freshness window.",
    };
  }
  return {
    accepted: true,
    score: dateIsRecent ? baseScore : Math.max(baseScore, 60),
  };
}

function standardVersionAppears(text: string, expectedVersion: string): boolean {
  const escaped = expectedVersion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b(?:version\\s*|v\\s*)${escaped}\\b`, "i").test(text);
}

function applyFreshnessPolicy(
  collection: EsgDriverEvidenceCollection,
  logic: EsgDriverLogic,
  policy: EsgSourceFreshnessPolicy | undefined,
): EsgDriverEvidenceCollection {
  if (!policy) return collection;
  const sources: EsgDriverSource[] = [];
  const rejectedSources = [...collection.rejectedSources];

  for (const source of collection.sources) {
    const evaluation = evaluateEsgSourceFreshness(source, policy);
    // Downgrade rather than drop: a low or unknown freshness score pushes the
    // source down the ranking (rankDriverLogicSources weights freshness), but an
    // authoritative page that simply omits a machine-readable date should still
    // be available as evidence instead of being silently discarded.
    sources.push({ ...source, freshnessScore: evaluation.score });
  }

  return { sources, rejectedSources };
}

function defaultFreshnessYears(category: EsgSourceFreshnessCategory): number {
  if (category === "forecast" || category === "market-metric") return 3;
  if (category === "regulation" || category === "policy") return 5;
  return 5;
}

function latestHistoricalEvidenceYear(text: string, currentYear: number): number | null {
  const years = (text.match(/\b(?:19|20)\d{2}\b/g) || [])
    .map(Number)
    // Future target years are not evidence of when a metric was measured.
    .filter((year) => year >= 1990 && year <= currentYear);
  return years.length > 0 ? Math.max(...years) : null;
}

export function scoreRelevance(text: string, input: GenerateEsgDriversInput): number {
  const normalized = tokenizeForRelevance(text, 5000);
  const tokenSet = new Set(normalized);
  const countryWords = tokenizeForRelevance(input.country, 12).filter(
    (word) => !RELEVANCE_STOPWORDS.has(word),
  );
  const sectorWords = tokenizeForRelevance(input.sector, 16).filter(
    (word) => word.length > 2 && !RELEVANCE_STOPWORDS.has(word),
  );
  let score = 0;

  if (countryWords.length > 0 && containsTokenSequence(normalized, countryWords)) {
    score += 25;
  }
  for (const word of sectorWords) {
    if (tokenSet.has(word)) score += 10;
  }
  for (const term of ESG_TERMS) {
    const termTokens = tokenizeForRelevance(term, 5);
    if (containsTokenSequence(normalized, termTokens)) score += 6;
  }

  return clampScore(score);
}

function rankDriverLogicSources(
  sources: EsgDriverSource[],
  logic: EsgDriverLogic,
): EsgDriverSource[] {
  return rankEsgDriverSources(sources)
    .map((source) => {
      const logicBoost = scoreLogicSpecificity(source, logic);
      return {
        ...source,
        sourceScore: clampScore(source.sourceScore + logicBoost),
        relevanceScore: clampScore(source.relevanceScore + Math.round(logicBoost / 2)),
      };
    })
    .sort((a, b) => b.sourceScore - a.sourceScore);
}

function scoreLogicSpecificity(source: EsgDriverSource, logic: EsgDriverLogic): number {
  const text = tokenizeForRelevance(
    `${source.title} ${source.domain} ${source.snippet} ${source.contentSnippet}`,
    5000,
  );
  const priorityHit = logic.sourcePriorities.some((priority) =>
    containsTokenSequence(text, tokenizeForRelevance(priority, 20)),
  );
  const logicTerms = uniqueStrings(
    `${logic.logic} ${logic.preciseQuestion} ${logic.evidenceTarget}`
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((term) => term.length >= 5 && !RELEVANCE_STOPWORDS.has(term)),
  );
  const textTokens = new Set(text);
  const termHits = logicTerms.filter((term) => textTokens.has(term)).length;

  return Math.min(18, (priorityHit ? 8 : 0) + Math.min(termHits * 2, 10));
}

function dedupeSearchItems(items: GoogleSearchItem[]): GoogleSearchItem[] {
  const seen = new Set<string>();
  const unique: GoogleSearchItem[] = [];

  for (const item of items) {
    const key = normalizeUrlKey(item.link);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }

  return unique;
}

function normalizeUrlKey(url: string): string | null {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.searchParams.delete("utm_source");
    parsed.searchParams.delete("utm_medium");
    parsed.searchParams.delete("utm_campaign");
    return parsed.toString().toLowerCase();
  } catch {
    return null;
  }
}

function getDomain(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function stableTextToken(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").replace(/\u0000/g, "").trim();
}

function tokenizeForRelevance(text: string, maxTokens: number): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) || []).slice(0, maxTokens);
}

function containsTokenSequence(tokens: string[], sequence: string[]): boolean {
  if (sequence.length === 0 || sequence.length > tokens.length) return false;
  if (sequence.length === 1) return tokens.includes(sequence[0]);
  for (let index = 0; index <= tokens.length - sequence.length; index += 1) {
    let matches = true;
    for (let offset = 0; offset < sequence.length; offset += 1) {
      if (tokens[index + offset] !== sequence[offset]) {
        matches = false;
        break;
      }
    }
    if (matches) return true;
  }
  return false;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function normalizeDate(value: string | null | undefined): string | null {
  if (!value) return null;

  const trimmed = value.trim();
  if (!trimmed) return null;
  // A bare year is often a policy target (for example, "Net Zero 2050"), not
  // publication metadata. Never convert it into a fabricated January 1 date.
  if (/^(?:19|20)\d{2}$/.test(trimmed)) return null;

  const date = new Date(trimmed);
  if (!Number.isNaN(date.getTime())) {
    if (date.getTime() > Date.now() + 2 * 24 * 60 * 60 * 1000) return null;
    return date.toISOString().slice(0, 10);
  }

  return null;
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex += 1;
      results[current] = await worker(items[current], current);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, runWorker),
  );

  return results;
}

export function resetEsgDriverResearchStateForTests(): void {
  googleSearchCache.clear();
  googleCseBlockedUntil = 0;
}
