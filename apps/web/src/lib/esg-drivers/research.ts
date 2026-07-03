import * as cheerio from "cheerio";
import { env } from "@/lib/config/env";
import {
  buildLogicSearchQueries,
  selectDriverLogics,
  type EsgDriverLogic,
} from "./logic";
import type { GenerateEsgDriversInput, EsgDriverSource } from "./types";

interface GoogleSearchItem {
  title: string;
  link: string;
  snippet: string;
  displayLink?: string;
  pagemap?: Record<string, unknown>;
}

const SOURCE_LIMIT = 24;
const DRIVER_SOURCE_LIMIT = 10;
const FETCH_TIMEOUT_MS = 12000;
const SEARCH_CACHE_TTL_MS = 1000 * 60 * 60 * 6;
const GOOGLE_CSE_COOLDOWN_MS = 1000 * 60 * 10;
const GOOGLE_CSE_QUERY_DELAY_MS = 250;

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
    findDateInText(input.snippet || ""),
    findDateInText(input.title || ""),
    findDateInText(input.url || ""),
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
  await onProgress?.("Searching custom ESG sources", 12);

  const queries = buildEsgDriverSearchQueries(input, logics);
  const searchItems = await runGoogleSearchPlan(
    queries,
    6,
    40,
    async (message) => onProgress?.(message, 18),
  );

  const uniqueItems = dedupeSearchItems([
    ...searchItems,
    ...buildAuthorityFallbackSearchItems(input, logics),
  ]).slice(0, 40);
  await onProgress?.("Scraping and parsing source pages", 30);

  const hydrated = await runWithConcurrency(uniqueItems, 5, async (item, index) => {
    const source = await hydrateSearchItem(item, input, index + 1);
    const progress = 30 + Math.floor(((index + 1) / uniqueItems.length) * 25);
    await onProgress?.("Scraping and parsing source pages", progress);
    return source;
  });

  await onProgress?.("Ranking source authority and freshness", 58);
  return rankEsgDriverSources(hydrated);
}

export async function collectEsgDriverEvidenceForLogic(
  input: GenerateEsgDriversInput,
  logic: EsgDriverLogic,
  plannedQueries: string[],
  options: {
    maxQueries?: number;
    maxCandidateSources?: number;
    sourceIdPrefix?: string;
    onSearchEvent?: (message: string) => Promise<void>;
  } = {},
): Promise<EsgDriverSource[]> {
  const maxQueries = Math.max(1, Math.min(options.maxQueries || 8, 8));
  const maxCandidateSources = Math.max(
    1,
    Math.min(options.maxCandidateSources || DRIVER_SOURCE_LIMIT, DRIVER_SOURCE_LIMIT),
  );
  const queries = buildDriverLogicSearchQueries(input, logic, plannedQueries).slice(
    0,
    maxQueries,
  );

  const searchItems = await runGoogleSearchPlan(
    queries,
    6,
    Math.min(maxCandidateSources + 4, 16),
    options.onSearchEvent,
  );
  const uniqueItems = dedupeSearchItems([
    ...searchItems,
    ...buildAuthorityFallbackSearchItems(input, [logic]),
  ]).slice(0, maxCandidateSources);

  const hydrated = await runWithConcurrency(uniqueItems, 3, async (item, index) =>
    hydrateSearchItem(item, input, index + 1),
  );

  return rankDriverLogicSources(hydrated, logic)
    .slice(0, maxCandidateSources)
    .map((source, index) => ({
      ...source,
      id: `${options.sourceIdPrefix || "S"}${index + 1}`,
    }));
}

async function runGoogleSearchPlan(
  queries: string[],
  maxResultsPerQuery: number,
  targetUniqueItems: number,
  onSearchEvent?: (message: string) => Promise<void>,
): Promise<GoogleSearchItem[]> {
  const collected: GoogleSearchItem[] = [];
  const minQueries = Math.min(2, queries.length);

  for (let index = 0; index < queries.length; index += 1) {
    const uniqueCount = dedupeSearchItems(collected).length;
    if (index >= minQueries && uniqueCount >= targetUniqueItems) break;

    try {
      const items = await searchGoogleCustomSearch(
        queries[index],
        maxResultsPerQuery,
      );
      collected.push(...items);
    } catch (error) {
      if (isGoogleCseRateLimitError(error)) {
        await onSearchEvent?.("CSE limited, using official-source fallback");
        break;
      }

      await onSearchEvent?.("Search query skipped, continuing research");
    }

    if (index < queries.length - 1) {
      await sleep(GOOGLE_CSE_QUERY_DELAY_MS);
    }
  }

  return dedupeSearchItems(collected);
}

async function searchGoogleCustomSearch(
  query: string,
  maxResults: number,
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

  const cacheKey = `${query}::${Math.min(Math.max(maxResults, 1), 10)}`;
  const cached = googleSearchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.items;
  }

  const params = new URLSearchParams({
    key: apiKey,
    cx: cseId,
    q: query,
    num: String(Math.min(Math.max(maxResults, 1), 10)),
    safe: "off",
  });

  const url = `https://www.googleapis.com/customsearch/v1?${params.toString()}`;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
    });

    if (response.ok) {
      const data = await response.json();
      const items = Array.isArray(data.items) ? data.items : [];
      const parsedItems = items
        .map((item: any) => ({
          title: String(item.title || "").trim(),
          link: String(item.link || "").trim(),
          snippet: String(item.snippet || "").trim(),
          displayLink: item.displayLink ? String(item.displayLink) : undefined,
          pagemap: item.pagemap,
        }))
        .filter((item: GoogleSearchItem) => item.title && item.link);

      googleSearchCache.set(cacheKey, {
        expiresAt: Date.now() + SEARCH_CACHE_TTL_MS,
        items: parsedItems,
      });
      return parsedItems;
    }

    if (response.status === 429 || response.status === 403) {
      const body = await safeReadResponseText(response);
      const isQuotaOrRateLimited =
        response.status === 429 ||
        /quota|ratelimit|rate limit|dailylimit|userRateLimitExceeded/i.test(body);
      if (!isQuotaOrRateLimited) {
        throw new Error(
          `Google CSE search failed with status ${response.status}. ${body}`.trim(),
        );
      }

      const retryAfter = parseRetryAfterMs(response.headers.get("retry-after"));
      lastError = new GoogleCseRateLimitError(
        `Google CSE search failed with status ${response.status}. ${body}`.trim(),
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
        "https://www.worldbank.org/en/topic/climatechange",
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
        "https://u.ae/en/about-the-uae/strategies-initiatives-and-awards/strategies-plans-and-visions/environment-and-energy/uae-net-zero-2050",
        `Official UAE Government source for the UAE Net Zero 2050 strategic initiative relevant to ${context}.`,
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
        "https://www.adgm.com/operating-in-adgm/sustainable-finance",
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

  if (/oil|gas|petroleum|lng|upstream|downstream|energy/.test(normalized)) {
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

function fallbackItem(title: string, link: string, snippet: string): GoogleSearchItem {
  return {
    title,
    link,
    snippet,
    displayLink: getDomain(link) || undefined,
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

async function safeReadResponseText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return "";
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
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function hydrateSearchItem(
  item: GoogleSearchItem,
  input: GenerateEsgDriversInput,
  index: number,
): Promise<EsgDriverSource> {
  const retrievedAt = new Date().toISOString();
  const domain = getDomain(item.link) || item.displayLink || "unknown";
  let contentSnippet = item.snippet;
  let publishedDate: string | null = extractDateFromPagemap(item.pagemap, "published");
  let updatedDate: string | null = extractDateFromPagemap(item.pagemap, "updated");
  let lastModified: string | null = null;

  try {
    const fetched = await fetchSourceSnippet(item.link);
    if (fetched.contentSnippet) contentSnippet = fetched.contentSnippet;
    if (fetched.publishedDate) publishedDate = fetched.publishedDate;
    if (fetched.updatedDate) updatedDate = fetched.updatedDate;
    if (fetched.lastModified) lastModified = fetched.lastModified;
  } catch {
    // Search snippets still provide useful fallback context for blocked sources.
  }

  const bestDate = extractBestDate({
    publishedDate,
    updatedDate,
    lastModified,
    snippet: `${item.snippet} ${contentSnippet}`,
    title: item.title,
    url: item.link,
  });

  const authorityScore = scoreAuthority(domain, item.link);
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
    contentSnippet: cleanText(contentSnippet).slice(0, 1800),
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

async function fetchSourceSnippet(url: string): Promise<{
  contentSnippet: string;
  publishedDate: string | null;
  updatedDate: string | null;
  lastModified: string | null;
}> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      cache: "no-store",
      headers: {
        Accept:
          "text/html,application/xhtml+xml,application/pdf;q=0.9,text/plain;q=0.8,*/*;q=0.5",
        "User-Agent":
          "Mozilla/5.0 (compatible; ESGCreditPortal/1.0; +https://example.com)",
      },
    });

    if (!response.ok) {
      throw new Error(`Source fetch failed with status ${response.status}.`);
    }

    const contentType = response.headers.get("content-type") || "";
    const lastModified = normalizeDate(response.headers.get("last-modified"));

    if (contentType.includes("pdf") || url.toLowerCase().includes(".pdf")) {
      const buffer = Buffer.from(await response.arrayBuffer());
      return {
        contentSnippet: extractPdfTextFallback(buffer),
        publishedDate: null,
        updatedDate: null,
        lastModified,
      };
    }

    const html = await response.text();
    return parseHtmlSource(html, lastModified);
  } finally {
    clearTimeout(timeout);
  }
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

function extractPdfTextFallback(buffer: Buffer): string {
  const raw = buffer.toString("latin1", 0, Math.min(buffer.length, 900000));
  const matches = raw.match(/\(([^()]{20,240})\)/g) || [];
  const text = matches
    .slice(0, 80)
    .map((match) => match.slice(1, -1))
    .join(" ");

  return cleanText(text).slice(0, 2500);
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

function scoreAuthority(domain: string, url: string): number {
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

  return clampScore(score);
}

function scoreFreshness(date: string | null): number {
  if (!date) return 45;

  const time = new Date(date).getTime();
  if (Number.isNaN(time)) return 45;

  const ageDays = (Date.now() - time) / (1000 * 60 * 60 * 24);
  if (ageDays <= 180) return 100;
  if (ageDays <= 365) return 90;
  if (ageDays <= 365 * 3) return 75;
  if (ageDays <= 365 * 5) return 60;
  return 40;
}

function scoreRelevance(text: string, input: GenerateEsgDriversInput): number {
  const normalized = text.toLowerCase();
  const country = input.country.toLowerCase();
  const sectorWords = input.sector.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  let score = 0;

  if (normalized.includes(country)) score += 25;
  for (const word of sectorWords) {
    if (word.length > 2 && normalized.includes(word)) score += 10;
  }
  for (const term of ESG_TERMS) {
    if (normalized.includes(term)) score += 6;
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
  const text = `${source.title} ${source.domain} ${source.snippet} ${source.contentSnippet}`.toLowerCase();
  const priorityHit = logic.sourcePriorities.some((priority) =>
    text.includes(priority.toLowerCase()),
  );
  const logicTerms = uniqueStrings(
    `${logic.logic} ${logic.preciseQuestion} ${logic.evidenceTarget}`
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((term) => term.length >= 5),
  );
  const termHits = logicTerms.filter((term) => text.includes(term)).length;

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

function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").replace(/\u0000/g, "").trim();
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function normalizeDate(value: string | null | undefined): string | null {
  if (!value) return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  const date = new Date(trimmed);
  if (!Number.isNaN(date.getTime())) {
    return date.toISOString().slice(0, 10);
  }

  const yearOnly = trimmed.match(/\b(20\d{2}|19\d{2})\b/);
  if (yearOnly) {
    return `${yearOnly[1]}-01-01`;
  }

  return null;
}

function findDateInText(text: string): string | null {
  const patterns = [
    /\b(20\d{2})[-/](0?[1-9]|1[0-2])[-/](0?[1-9]|[12]\d|3[01])\b/,
    /\b(0?[1-9]|[12]\d|3[01])[-/](0?[1-9]|1[0-2])[-/](20\d{2})\b/,
    /\b(20\d{2})\b/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[0];
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
