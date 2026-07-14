import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";

const { dnsLookupMock } = vi.hoisted(() => ({ dnsLookupMock: vi.fn() }));

vi.mock("node:dns/promises", () => ({ lookup: dnsLookupMock }));
vi.mock("@/lib/config/env", () => ({
  env: {
    GOOGLE_API_KEY_2: "test-key",
    GOOGLE_CSE_ID_2: "test-cse",
  },
}));

import { DRIVER_LOGIC_LIBRARY, selectDriverLogics } from "../logic";
import {
  collectEsgDriverEvidenceForLogic,
  EsgResearchBudgetExceededError,
  evaluateEsgSourceFreshness,
  extractBestDate,
  fetchSourceSnippet,
  getEsgResearchBudgetSnapshot,
  isPublicIpAddress,
  resetEsgDriverResearchStateForTests,
  resolveSafePublicUrl,
  revalidateEsgDriverSources,
  scoreFreshness,
  scoreAuthority,
  scoreRelevance,
  searchGoogleCustomSearch,
  withEsgResearchBudget,
} from "../research";
import { matchApprovedSource } from "../source-registry";
import type { EsgDriverSource, GenerateEsgDriversInput } from "../types";

const input: GenerateEsgDriversInput = {
  country: "UAE",
  sector: "Banking",
  language: "English",
};

const parisUrl = "https://unfccc.int/process-and-meetings/the-paris-agreement";
const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

function sourceHtml(): string {
  return `<!doctype html><html><head><meta property="article:published_time" content="2025-05-10"></head><body><main><p>The Paris Agreement establishes a global climate framework and nationally determined contributions for long-term emissions action.</p></main></body></html>`;
}

beforeEach(() => {
  resetEsgDriverResearchStateForTests();
  dnsLookupMock.mockReset();
  dnsLookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ESG source network safety", () => {
  it("rejects loopback, private, link-local, documentation, and mapped private IPs", () => {
    expect(isPublicIpAddress("127.0.0.1")).toBe(false);
    expect(isPublicIpAddress("10.0.0.1")).toBe(false);
    expect(isPublicIpAddress("169.254.169.254")).toBe(false);
    expect(isPublicIpAddress("192.0.2.10")).toBe(false);
    expect(isPublicIpAddress("192.88.99.10")).toBe(false);
    expect(isPublicIpAddress("::1")).toBe(false);
    expect(isPublicIpAddress("::ffff:7f00:1")).toBe(false);
    expect(isPublicIpAddress("::ffff:192.168.1.1")).toBe(false);
    expect(isPublicIpAddress("::ffff:8.8.8.8")).toBe(true);
    expect(isPublicIpAddress("100::1")).toBe(false);
    expect(isPublicIpAddress("100:0:0:1::1")).toBe(false);
    expect(isPublicIpAddress("2001::1")).toBe(false);
    expect(isPublicIpAddress("2002:c000:0201::1")).toBe(false);
    expect(isPublicIpAddress("3fff::1")).toBe(false);
    expect(isPublicIpAddress("5f00::1")).toBe(false);
    expect(isPublicIpAddress("93.184.216.34")).toBe(true);
    expect(isPublicIpAddress("2606:4700:4700::1111")).toBe(true);
  });

  it("rejects a hostname if any DNS answer is non-public", async () => {
    await expect(
      resolveSafePublicUrl(parisUrl, {
        lookupImpl: async () => [
          { address: "93.184.216.34", family: 4 },
          { address: "127.0.0.1", family: 4 },
        ],
      }),
    ).rejects.toThrow("non-public address");
  });

  it("retrieves an approved page with manual redirects and a DNS-pinned dispatcher", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.redirect).toBe("manual");
      expect(init).toHaveProperty("dispatcher");
      return new Response(sourceHtml(), {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    });

    const result = await fetchSourceSnippet(parisUrl, "unfccc-paris-agreement", {
      fetchImpl: fetchMock,
      lookupImpl: publicLookup,
    });

    expect(result.contentSnippet).toContain("Paris Agreement");
    expect(result.publishedDate).toBe("2025-05-10");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("extracts usable text from a compressed approved PDF", async () => {
    const pdfJsLogSpy = vi.spyOn(console, "log");
    const document = await PDFDocument.create();
    const font = await document.embedFont(StandardFonts.Helvetica);
    const page = document.addPage([612, 792]);
    page.drawText(
      "Financial institutions use science based targets and sector pathways. Version 1.1 is the reviewed current standard.",
      { x: 50, y: 720, size: 12, font },
    );
    const bytes = Buffer.from(await document.save());
    const eofIndex = bytes.lastIndexOf("%%EOF");
    const padding = Buffer.from(`%${"x".repeat(3 * 1024 * 1024 + 128)}\n`);
    const largePdf = Buffer.concat([
      bytes.subarray(0, eofIndex),
      padding,
      bytes.subarray(eofIndex),
    ]);
    expect(largePdf.length).toBeGreaterThan(3 * 1024 * 1024);
    const result = await fetchSourceSnippet(
      "https://sciencebasedtargets.org/standards-and-guidance",
      "sbti-sectors",
      {
        lookupImpl: publicLookup,
        fetchImpl: async () =>
          new Response(largePdf, {
            status: 200,
            headers: {
              "content-type": "application/pdf",
              "content-length": String(largePdf.length),
            },
          }),
      },
    );

    expect(result.contentSnippet).toContain("Financial institutions");
    expect(result.contentSnippet).toContain("Version 1.1");
    expect(
      pdfJsLogSpy.mock.calls.some(([message]) =>
        /standardFontDataUrl|TT: undefined function/.test(String(message)),
      ),
    ).toBe(false);
  });

  it("rejects an unapproved redirect before issuing a second request", async () => {
    const fetchMock = vi.fn(async (_request: string | URL | Request) =>
      new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1/latest/meta-data" },
      }),
    );

    await expect(
      fetchSourceSnippet(parisUrl, "unfccc-paris-agreement", {
        fetchImpl: fetchMock,
        lookupImpl: publicLookup,
      }),
    ).rejects.toThrow("approved URL scope");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("allows an exact approved redirect to the current SBTi guidance URL", async () => {
    const fetchMock = vi.fn(async (_request: string | URL | Request) => {
      if (fetchMock.mock.calls.length === 1) {
        return new Response(null, {
          status: 302,
          headers: { location: "https://sciencebasedtargets.org/standards-and-guidance" },
        });
      }
      return new Response(
        "<main><p>Financial institutions use science-based standards and guidance to set near-term and net-zero emissions targets for investment and lending activities.</p></main>",
        { status: 200, headers: { "content-type": "text/html" } },
      );
    });

    const result = await fetchSourceSnippet(
      "https://sciencebasedtargets.org/sectors",
      "sbti-sectors",
      { fetchImpl: fetchMock, lookupImpl: publicLookup },
    );

    expect(result.finalUrl).toBe(
      "https://sciencebasedtargets.org/standards-and-guidance",
    );
    expect(result.contentSnippet).toContain("Financial institutions");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("enforces the byte cap while streaming a response body", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(2 * 1024 * 1024));
        controller.enqueue(new Uint8Array(2 * 1024 * 1024));
        controller.close();
      },
    });
    const fetchMock = vi.fn(async () =>
      new Response(body, {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );

    await expect(
      fetchSourceSnippet(parisUrl, "unfccc-paris-agreement", {
        fetchImpl: fetchMock,
        lookupImpl: publicLookup,
      }),
    ).rejects.toThrow("byte limit");
  });

  it("rejects unsupported response content types", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "image/png" },
      }),
    );

    await expect(
      fetchSourceSnippet(parisUrl, "unfccc-paris-agreement", {
        fetchImpl: fetchMock,
        lookupImpl: publicLookup,
      }),
    ).rejects.toThrow("unsupported content type");
  });

  it("times out a stalled source fetch", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      async (_request: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          if (init?.signal?.aborted) {
            reject(new DOMException("aborted", "AbortError"));
            return;
          }
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );

    const request = fetchSourceSnippet(parisUrl, "unfccc-paris-agreement", {
      fetchImpl: fetchMock,
      lookupImpl: publicLookup,
    });
    const rejection = expect(request).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(12_001);

    await rejection;
  });
});

describe("ESG search safety and evidence gating", () => {
  it("enables Google SafeSearch and bounds the search cache", async () => {
    const fetchMock = vi.fn(async (_request: string | URL | Request) =>
      new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    for (let index = 0; index < 129; index += 1) {
      await searchGoogleCustomSearch(`bounded query ${index}`, 3, {
        fetchImpl: fetchMock,
      });
    }
    await searchGoogleCustomSearch("bounded query 0", 3, { fetchImpl: fetchMock });

    expect(fetchMock).toHaveBeenCalledTimes(130);
    const firstUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(firstUrl.searchParams.get("safe")).toBe("active");
  });

  it("never hydrates an unapproved Google result", async () => {
    const maliciousUrl = "http://127.0.0.1/latest/meta-data";
    const onSearchEvent = vi.fn(async () => undefined);
    const fetchMock = vi.fn(async (request: string | URL | Request) => {
      const url = String(request);
      if (url.startsWith("https://www.googleapis.com/customsearch/")) {
        return new Response(
          JSON.stringify({
            items: [
              {
                title: "Attacker-controlled ESG result",
                link: maliciousUrl,
                snippet: "UAE banking climate evidence",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(sourceHtml(), {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const logic = selectDriverLogics(input).find(
      (candidate) => candidate.id === "global-climate-commitments",
    );
    if (!logic) throw new Error("Missing test logic");
    const collection = await collectEsgDriverEvidenceForLogic(input, logic, [], {
      maxQueries: 1,
      maxCandidateSources: 2,
      onSearchEvent,
    });

    expect(collection.sources).toHaveLength(2);
    expect(
      collection.sources.every((source) =>
        ["unfccc-paris-agreement", "un-paris-agreement", "un-climate-key-findings"].includes(
          source.approvalId || "",
        ),
      ),
    ).toBe(true);
    expect(fetchMock.mock.calls.some(([request]) => String(request) === maliciousUrl)).toBe(
      false,
    );
    expect(onSearchEvent).toHaveBeenCalledWith(
      "Searching reviewed publisher results",
      expect.objectContaining({
        kind: "search",
        outcome: "running",
        query: expect.any(String),
      }),
    );
    expect(onSearchEvent).toHaveBeenCalledWith(
      "Search returned 1 candidate result",
      expect.objectContaining({
        kind: "search-results",
        resultCount: 1,
        results: [
          expect.objectContaining({
            title: "Attacker-controlled ESG result",
            url: maliciousUrl,
          }),
        ],
      }),
    );
  });

  it("skips CSE when approved fallbacks fill all hydration slots", async () => {
    const fetchMock = vi.fn(async (_request: string | URL | Request) =>
      new Response(
        "<main><p>UAE banking sustainable finance climate disclosure transition risk and emissions evidence from an approved official source.</p></main>",
        { status: 200, headers: { "content-type": "text/html" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const logic = DRIVER_LOGIC_LIBRARY.find(
      (candidate) => candidate.id === "sustainable-finance-market",
    );
    if (!logic) throw new Error("Missing test logic");

    await collectEsgDriverEvidenceForLogic(input, logic, [], {
      maxQueries: 8,
      maxCandidateSources: 10,
    });

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(
      fetchMock.mock.calls.some(([request]) =>
        String(request).includes("googleapis.com"),
      ),
    ).toBe(false);
  });

  it("uses redundant UN evidence without proactively hydrating the unstable UNFCCC page", async () => {
    const fetchMock = vi.fn(async (request: string | URL | Request) => {
      const url = String(request);
      if (url.startsWith("https://www.googleapis.com/customsearch/")) {
        return new Response(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(
        "<main><p>The Paris Agreement is a global climate commitment under which countries submit increasingly ambitious national climate plans and reduce greenhouse gas emissions.</p></main>",
        { status: 200, headers: { "content-type": "text/html" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const logic = DRIVER_LOGIC_LIBRARY.find(
      (candidate) => candidate.id === "global-climate-commitments",
    );
    if (!logic) throw new Error("Missing test logic");

    const collection = await collectEsgDriverEvidenceForLogic(input, logic, [], {
      maxQueries: 1,
      maxCandidateSources: 10,
    });

    expect(collection.sources.map((source) => source.approvalId)).toEqual(
      expect.arrayContaining(["un-paris-agreement", "un-climate-key-findings"]),
    );
    expect(
      fetchMock.mock.calls.some(([request]) =>
        String(request).includes("unfccc.int/news/the-explainer"),
      ),
    ).toBe(false);
  });

  it("keeps UAE and global banking evidence together for sustainable finance", async () => {
    const fetchMock = vi.fn(async (request: string | URL | Request) => {
      const url = String(request);
      if (url.includes("centralbank.ae")) {
        return new Response("blocked", {
          status: 403,
          headers: { "content-type": "text/html" },
        });
      }
      if (url.includes("dfsa.ae") || url.includes("adgm.com")) {
        return new Response(
          "<main><p>UAE financial institutions use this sustainable finance framework to support climate transition, ESG disclosure, and responsible banking activity.</p></main>",
          { status: 200, headers: { "content-type": "text/html" } },
        );
      }
      return new Response(
        "<main><p>Banks and financial institutions use this global sustainable finance framework for climate targets, ESG strategy, and responsible lending.</p></main>",
        { status: 200, headers: { "content-type": "text/html" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const logic = DRIVER_LOGIC_LIBRARY.find(
      (candidate) => candidate.id === "sustainable-finance-market",
    );
    if (!logic) throw new Error("Missing test logic");

    const collection = await collectEsgDriverEvidenceForLogic(input, logic, [], {
      maxQueries: 1,
      maxCandidateSources: 10,
    });

    expect(
      collection.sources.some((source) =>
        source.approvalCountryScope?.includes("UAE"),
      ),
    ).toBe(true);
    expect(
      collection.sources.some((source) =>
        source.approvalCountryScope?.includes("Global"),
      ),
    ).toBe(true);
  });

  it("returns approved banking target-setting evidence without relying on SBTi alone", async () => {
    const fetchMock = vi.fn(async (request: string | URL | Request) => {
      const url = String(request);
      if (url.startsWith("https://www.googleapis.com/customsearch/")) {
        return new Response(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("sciencebasedtargets.org")) {
        return new Response(
          "<main><p>Financial institutions set science-based near-term and net-zero emissions targets covering investment and lending activities.</p></main>",
          { status: 200, headers: { "content-type": "text/html" } },
        );
      }
      return new Response(
        "<main><p>Banks use responsible banking and net-zero guidance to set climate targets for financed emissions and client portfolios.</p></main>",
        { status: 200, headers: { "content-type": "text/html" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const logic = DRIVER_LOGIC_LIBRARY.find(
      (candidate) => candidate.id === "sector-target-setting-pressure",
    );
    if (!logic) throw new Error("Missing test logic");

    const collection = await collectEsgDriverEvidenceForLogic(input, logic, [], {
      maxQueries: 1,
      maxCandidateSources: 10,
    });
    const approvalIds = collection.sources.map((source) => source.approvalId);

    expect(approvalIds).toEqual(
      expect.arrayContaining([
        "unep-fi-principles-responsible-banking",
        "unep-fi-net-zero-banking",
        "sbti-sectors",
      ]),
    );
  });

  it("times out a stalled Google request", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      async (_request: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );

    const request = searchGoogleCustomSearch("stalled query", 1, {
      fetchImpl: fetchMock,
    });
    const rejection = expect(request).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(12_001);

    await rejection;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("ESG job research budget", () => {
  it("does not charge time spent outside active research", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await withEsgResearchBudget(
      async () => {
        await vi.advanceTimersByTimeAsync(5_000);

        const idleSnapshot = getEsgResearchBudgetSnapshot();
        expect(idleSnapshot).toMatchObject({
          activeDurationMs: 0,
          remainingDurationMs: 50,
          maxDurationMs: 50,
        });
        await expect(
          searchGoogleCustomSearch("idle-time query", 1, { fetchImpl: fetchMock }),
        ).resolves.toEqual([]);
      },
      { maxDurationMs: 50 },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shares and enforces the total Google request cap", async () => {
    const fetchMock = vi.fn(async (_request: string | URL | Request) =>
      new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await withEsgResearchBudget(
      async () => {
        await searchGoogleCustomSearch("budget query one", 1, {
          fetchImpl: fetchMock,
        });
        await withEsgResearchBudget(async () => {
          await searchGoogleCustomSearch("budget query two", 1, {
            fetchImpl: fetchMock,
          });
        });
        expect(getEsgResearchBudgetSnapshot()?.searchRequests).toBe(2);
        await expect(
          searchGoogleCustomSearch("budget query three", 1, {
            fetchImpl: fetchMock,
          }),
        ).rejects.toMatchObject({ limit: "search" });
      },
      { maxSearchRequests: 2 },
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("enforces the total source-hop cap before another HTTP request", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(sourceHtml(), {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );

    await withEsgResearchBudget(
      async () => {
        await fetchSourceSnippet(parisUrl, "unfccc-paris-agreement", {
          fetchImpl: fetchMock,
          lookupImpl: publicLookup,
        });
        await expect(
          fetchSourceSnippet(parisUrl, "unfccc-paris-agreement", {
            fetchImpl: fetchMock,
            lookupImpl: publicLookup,
          }),
        ).rejects.toMatchObject({ limit: "source" });
      },
      { maxSourceFetches: 1 },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not let hydration swallow a source-budget failure", async () => {
    const fetchMock = vi.fn(async (request: string | URL | Request) => {
      if (String(request).startsWith("https://www.googleapis.com/customsearch/")) {
        return new Response(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(sourceHtml(), {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const logic = selectDriverLogics(input).find(
      (candidate) => candidate.id === "global-climate-commitments",
    );
    if (!logic) throw new Error("Missing test logic");

    await expect(
      withEsgResearchBudget(
        () =>
          collectEsgDriverEvidenceForLogic(input, logic, [], {
            maxQueries: 1,
            maxCandidateSources: 2,
          }),
        { maxSourceFetches: 0 },
      ),
    ).rejects.toMatchObject({ limit: "source" });

    expect(fetchMock.mock.calls).toHaveLength(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("googleapis.com");
  });

  it("reserves hydration opportunity for every sequential driver logic", async () => {
    const fetchMock = vi.fn(async (request: string | URL | Request) => {
      if (String(request).startsWith("https://www.googleapis.com/customsearch/")) {
        return new Response(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(
        "<main><p>UAE banking construction real estate oil and gas climate emissions sustainability disclosure transition risk and supply chain evidence from an approved official source.</p></main>",
        { status: 200, headers: { "content-type": "text/html" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const logics = selectDriverLogics(input);
    const sourceDeltas: number[] = [];

    await withEsgResearchBudget(async () => {
      for (const logic of logics) {
        const before = getEsgResearchBudgetSnapshot()?.sourceFetches || 0;
        await collectEsgDriverEvidenceForLogic(input, logic, [], {
          maxQueries: 1,
          maxCandidateSources: 10,
        });
        const after = getEsgResearchBudgetSnapshot()?.sourceFetches || 0;
        sourceDeltas.push(after - before);
      }
    });

    expect(logics).toHaveLength(12);
    expect(sourceDeltas).toHaveLength(12);
    expect(sourceDeltas.every((count) => count >= 1 && count <= 5)).toBe(true);
    expect(sourceDeltas.reduce((total, count) => total + count, 0)).toBeLessThanOrEqual(
      60,
    );
  });

  it("aborts in-flight research when the job deadline expires", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      async (_request: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );

    const request = withEsgResearchBudget(
      () =>
        searchGoogleCustomSearch("deadline query", 1, {
          fetchImpl: fetchMock,
        }),
      { maxDurationMs: 50 },
    );
    const rejection = expect(request).rejects.toBeInstanceOf(
      EsgResearchBudgetExceededError,
    );
    await vi.advanceTimersByTimeAsync(51);

    await rejection;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("charges nested concurrent research once by elapsed wall time", async () => {
    vi.useFakeTimers();
    const googleItems = [
      {
        title: "United Nations - The Paris Agreement",
        link: "https://www.un.org/en/climatechange/paris-agreement",
        snippet: "Official climate commitments and nationally determined contributions.",
      },
      {
        title: "United Nations - Climate Key Findings",
        link: "https://www.un.org/en/climatechange/science/key-findings",
        snippet: "Official climate science and emissions findings.",
      },
      {
        title: "UNFCCC - The Paris Agreement",
        link: parisUrl,
        snippet: "Official Paris Agreement climate framework.",
      },
    ];
    const fetchMock = vi.fn(
      async (request: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          const timer = setTimeout(() => {
            if (String(request).startsWith("https://www.googleapis.com/customsearch/")) {
              resolve(
                new Response(JSON.stringify({ items: googleItems }), {
                  status: 200,
                  headers: { "content-type": "application/json" },
                }),
              );
              return;
            }
            resolve(
              new Response(sourceHtml(), {
                status: 200,
                headers: { "content-type": "text/html" },
              }),
            );
          }, 20);
          init?.signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const logic = selectDriverLogics(input).find(
      (candidate) => candidate.id === "global-climate-commitments",
    );
    if (!logic) throw new Error("Missing test logic");

    let snapshotAfterResearch: ReturnType<typeof getEsgResearchBudgetSnapshot> = null;
    const request = withEsgResearchBudget(
      async () => {
        await withEsgResearchBudget(
          () =>
            collectEsgDriverEvidenceForLogic(input, logic, [], {
              maxQueries: 1,
              maxCandidateSources: 3,
            }),
          { maxDurationMs: 1 },
        );
        snapshotAfterResearch = getEsgResearchBudgetSnapshot();
      },
      { maxDurationMs: 60 },
    );

    await vi.advanceTimersByTimeAsync(41);
    await request;

    expect(snapshotAfterResearch).toMatchObject({
      activeDurationMs: 40,
      remainingDurationMs: 20,
      maxDurationMs: 60,
    });
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
  });

  it("keeps duration overrides below the production ceiling", async () => {
    await withEsgResearchBudget(
      async () => {
        expect(getEsgResearchBudgetSnapshot()?.maxDurationMs).toBe(
          365 * 24 * 60 * 60 * 1000,
        );
      },
      { maxDurationMs: Number.MAX_SAFE_INTEGER },
    );
  });
});

describe("ESG source dates and relevance", () => {
  it("uses curated regulator authority floors without inventing freshness", () => {
    const url = "https://www.adgm.com/initiatives/sustainable-finance";
    const approved = matchApprovedSource(url);

    expect(scoreAuthority("www.adgm.com", url)).toBe(45);
    expect(approved?.authorityScoreFloor).toBe(90);
    expect(
      scoreAuthority("www.adgm.com", url, approved?.authorityScoreFloor),
    ).toBe(90);
    expect(scoreFreshness(null)).toBe(45);
  });

  it.each([
    [
      "https://www.fsb.org/work-of-the-fsb/financial-innovation-and-structural-change/climate-related-risks/",
      "www.fsb.org",
    ],
    ["https://www.bis.org/bcbs/publ/d532.htm", "www.bis.org"],
  ])("raises the live D7 source %s to first-party authority", (url, domain) => {
    const approved = matchApprovedSource(url);
    expect(approved?.authorityScoreFloor).toBe(90);
    expect(scoreAuthority(domain, url, approved?.authorityScoreFloor)).toBe(90);
  });

  it("does not treat target years or future dates as publication freshness", () => {
    expect(
      extractBestDate({
        title: "UAE Net Zero 2050",
        snippet: "A 2050 emissions target",
        url: "https://example.com/net-zero-2050",
      }),
    ).toBeNull();
    expect(extractBestDate({ publishedDate: "2050" })).toBeNull();
    expect(extractBestDate({ publishedDate: "2100-01-01" })).toBeNull();
    expect(scoreFreshness("2100-01-01")).toBe(20);
    expect(extractBestDate({ publishedDate: "2024-05-01" })).toBe("2024-05-01");
  });

  it("matches relevance on whole tokens instead of substrings", () => {
    expect(scoreRelevance("suave banking climate plan", input)).toBe(16);
    expect(scoreRelevance("UAE banking climate plan", input)).toBe(41);
  });

  it("requires standards to identify the publisher's latest active version", () => {
    const base: EsgDriverSource = {
      id: "S1",
      title: "Archived reporting standard",
      url: "https://www.ifrs.org/archive/standard",
      domain: "ifrs.org",
      snippet: "",
      contentSnippet:
        "This archived sustainability disclosure standard was previously used for climate reporting.",
      retrievalStatus: "retrieved",
      evidenceProvenance: "retrieved-page",
      isContextualFallback: false,
      finalUrl: "https://www.ifrs.org/archive/standard",
      retrievalError: null,
      publishedDate: "2026-01-01",
      updatedDate: null,
      lastModified: null,
      retrievedAt: "2026-07-14T00:00:00.000Z",
      authorityScore: 90,
      freshnessScore: 100,
      relevanceScore: 80,
      sourceScore: 0,
    };

    expect(
      evaluateEsgSourceFreshness(base, { category: "standard" }, new Date("2026-07-14"))
        .accepted,
    ).toBe(false);
    expect(
      evaluateEsgSourceFreshness(
        {
          ...base,
          title: "Latest active version of the sustainability disclosure standard",
          contentSnippet:
            "The publisher confirms this is the latest active version of its sustainability disclosure standard.",
        },
        { category: "standard" },
        new Date("2026-07-14"),
      ).accepted,
    ).toBe(true);
    expect(
      evaluateEsgSourceFreshness(
        {
          ...base,
          contentSnippet: "SBTi Buildings Criteria Version 1.1 applies to target validation.",
        },
        { category: "standard", expectedDocumentVersion: "1.1" },
        new Date("2026-07-14"),
      ).accepted,
    ).toBe(true);
    expect(
      evaluateEsgSourceFreshness(
        {
          ...base,
          contentSnippet: "SBTi Buildings Criteria Version 1.0 applies to target validation.",
        },
        { category: "standard", expectedDocumentVersion: "1.1" },
        new Date("2026-07-14"),
      ).accepted,
    ).toBe(false);
  });
});

describe("catalog seed source resolution", () => {
  const globalLogic = DRIVER_LOGIC_LIBRARY.find(
    (candidate) => candidate.id === "global-climate-commitments",
  );
  if (!globalLogic) throw new Error("Missing global climate commitments logic");

  it("hydrates an exact reviewed seed before any search or registry fallback", async () => {
    const seedUrl = "https://www.un.org/en/climatechange/paris-agreement";
    const fetchMock = vi.fn(async (request: string | URL | Request) => {
      expect(String(request)).toBe(seedUrl);
      return new Response(sourceHtml(), {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const collection = await collectEsgDriverEvidenceForLogic(input, globalLogic, [], {
      seedSources: [
        { url: seedUrl, publisher: "United Nations", domain: "un.org" },
        {
          url: "https://www.un.org/en/climatechange/science/key-findings",
          publisher: "United Nations",
          domain: "un.org",
        },
      ],
      maxQueries: 1,
      maxCandidateSources: 3,
    });

    expect(collection.sources.map((source) => source.url)).toEqual([seedUrl]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("searches only the same reviewed publisher when an exact seed is unavailable", async () => {
    const seedUrl = "https://www.un.org/en/climatechange/retired-catalog-page";
    const replacementUrl = "https://www.un.org/en/climatechange/paris-agreement";
    const fetchMock = vi.fn(async (request: string | URL | Request) => {
      const url = String(request);
      if (url === seedUrl) {
        return new Response("gone", {
          status: 404,
          headers: { "content-type": "text/html" },
        });
      }
      if (url.startsWith("https://www.googleapis.com/customsearch/")) {
        const query = new URL(url).searchParams.get("q") || "";
        expect(query).toContain("site:un.org");
        return new Response(
          JSON.stringify({
            items: [
              {
                title: "United Nations - The Paris Agreement",
                link: replacementUrl,
                snippet: "Official global climate framework",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      expect(url).toBe(replacementUrl);
      return new Response(sourceHtml(), {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const collection = await collectEsgDriverEvidenceForLogic(input, globalLogic, [], {
      seedSources: [{ url: seedUrl, publisher: "United Nations", domain: "un.org" }],
      maxQueries: 1,
      maxCandidateSources: 3,
    });

    expect(collection.sources.map((source) => source.url)).toEqual([replacementUrl]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("rejects an otherwise approved result from a different publisher domain", async () => {
    const seedUrl = "https://www.un.org/en/climatechange/retired-catalog-page";
    const crossPublisherUrl =
      "https://unfccc.int/process-and-meetings/the-paris-agreement";
    const fetchMock = vi.fn(async (request: string | URL | Request) => {
      const url = String(request);
      if (url === seedUrl) {
        return new Response("gone", {
          status: 404,
          headers: { "content-type": "text/html" },
        });
      }
      if (url.startsWith("https://www.googleapis.com/customsearch/")) {
        return new Response(
          JSON.stringify({
            items: [
              {
                title: "Different approved publisher",
                link: crossPublisherUrl,
                snippet: "Global climate evidence",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`Cross-publisher page should not be fetched: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const collection = await collectEsgDriverEvidenceForLogic(input, globalLogic, [], {
      seedSources: [{ url: seedUrl, publisher: "United Nations", domain: "un.org" }],
      maxQueries: 1,
      maxCandidateSources: 3,
    });

    expect(collection.sources).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("revalidates every accepted citation without stopping after the first", async () => {
    const urls = [
      "https://www.un.org/en/climatechange/paris-agreement",
      "https://www.un.org/en/climatechange/science/key-findings",
    ];
    const fetchMock = vi.fn(async () =>
      new Response(sourceHtml(), {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const collection = await revalidateEsgDriverSources(input, globalLogic, urls);

    expect(collection.sources).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
