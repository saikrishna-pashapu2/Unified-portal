import { describe, expect, it } from "vitest";
import {
  DRIVER_LOGIC_LIBRARY,
  getReplacementDriverLogics,
  selectDriverLogics,
  type EsgDriverLogic,
} from "../logic";
import {
  APPROVED_DRIVER_SOURCES,
  approveDriverSource,
  buildApprovedFallbackItems,
  getSectorGroupForRegistry,
  isSourceApprovedDirect,
  matchApprovedSource,
  normalizeUrlForApproval,
  resolveApprovedCatalogSeedSource,
  resolveApprovedSamePublisherSource,
} from "../source-registry";
import type { EsgDriverSource, GenerateEsgDriversInput } from "../types";

const uaeBanking: GenerateEsgDriversInput = {
  country: "UAE",
  sector: "Banking",
  language: "English",
};

function source(overrides: Partial<EsgDriverSource>): EsgDriverSource {
  return {
    id: "S1",
    title: "Test Source",
    url: "https://example.com",
    domain: "example.com",
    snippet: "",
    contentSnippet: "",
    retrievalStatus: "retrieved",
    evidenceProvenance: "retrieved-page",
    isContextualFallback: false,
    finalUrl: "https://example.com",
    retrievalError: null,
    publishedDate: null,
    updatedDate: null,
    lastModified: null,
    retrievedAt: "2026-07-09T00:00:00.000Z",
    authorityScore: 90,
    freshnessScore: 90,
    relevanceScore: 90,
    sourceScore: 90,
    ...overrides,
  };
}

function logic(id: string): EsgDriverLogic {
  const found = DRIVER_LOGIC_LIBRARY.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Missing test logic ${id}`);
  return found;
}

describe("approved ESG driver source registry", () => {
  it("normalizes URLs for exact approved-source matching", () => {
    expect(
      normalizeUrlForApproval(
        "https://www.unfccc.int/process-and-meetings/the-paris-agreement/?utm_source=test#top",
      ),
    ).toBe("https://unfccc.int/process-and-meetings/the-paris-agreement");
  });

  it("does not treat a broad CSE domain result as approved", () => {
    expect(
      matchApprovedSource("https://unfccc.int/global-climate-action-yearbook-2025"),
    ).toBeNull();
  });

  it("binds an exact reviewed publisher subdomain seed and refreshes on its reviewed root", () => {
    const catalogLogic: EsgDriverLogic = {
      ...logic("sector-transition-initiative"),
      id: "catalog-sbti-financial-institutions",
      catalogArchetypeId: "catalog-sbti-financial-institutions",
      catalogName: "Financial institution science-based target criteria",
      catalogCountryScopes: ["All"],
      catalogSectorScopes: ["Banking"],
      catalogSectorFamilies: ["Financial Services"],
    };
    const seedUrl =
      "https://files.sciencebasedtargets.org/production/files/Financial-Institutions-Near-Term-Criteria.pdf";
    const seed = resolveApprovedCatalogSeedSource(
      {
        url: seedUrl,
        domain: "files.sciencebasedtargets.org",
        registryApprovalIds: ["sbti-sectors"],
        pageReferences: ["p.6"],
        documentVersion: "1.1",
      },
      catalogLogic,
    );

    expect(seed).toMatchObject({
      reviewedPublisherSourceId: "sbti-sectors",
      catalogSeedUrl: seedUrl,
      catalogPageReferences: ["p.6"],
      catalogDocumentVersion: "1.1",
    });
    expect(
      resolveApprovedSamePublisherSource(
        "https://sciencebasedtargets.org/standards-and-guidance",
        seed!,
        catalogLogic,
      ),
    ).toMatchObject({ catalogIsReplacement: true });
    expect(
      resolveApprovedSamePublisherSource(
        "https://unfccc.int/process-and-meetings/the-paris-agreement",
        seed!,
        catalogLogic,
      ),
    ).toBeNull();
  });

  it("rejects catalog evidence outside exact archetype and reviewed claim scope", () => {
    const catalogLogic: EsgDriverLogic = {
      ...logic("sector-transition-initiative"),
      id: "catalog-sbti-financial-institutions",
      type: "General",
      catalogArchetypeId: "catalog-sbti-financial-institutions",
      catalogName: "Financial institution science-based target criteria",
      catalogCountryScopes: ["UAE"],
      catalogSectorScopes: ["Banking"],
      catalogSectorFamilies: ["Financial Services"],
    };
    const seedUrl =
      "https://files.sciencebasedtargets.org/production/files/Financial-Institutions-Near-Term-Criteria.pdf";
    const record = resolveApprovedCatalogSeedSource(
      {
        url: seedUrl,
        domain: "files.sciencebasedtargets.org",
        registryApprovalIds: ["sbti-sectors"],
      },
      catalogLogic,
    );
    expect(record).not.toBeNull();

    const wrongCountry = approveDriverSource(
      source({
        url: seedUrl,
        domain: "files.sciencebasedtargets.org",
        contentSnippet:
          "Financial institutions use science based targets and sector pathways for banking portfolios.",
      }),
      uaeBanking,
      catalogLogic,
      record!,
    );
    expect(wrongCountry.rejected?.reason).toBe("country-mismatch");

    // Concept/claim mismatch on an otherwise in-scope approved source is now a
    // soft downgrade, not a rejection: the source is kept (so the driver is not
    // starved of evidence) but its relevance is penalized so cleaner matches
    // outrank it.
    const conceptMismatch = approveDriverSource(
      source({
        url: seedUrl,
        domain: "files.sciencebasedtargets.org",
        contentSnippet:
          "United Arab Emirates banking organizations published general corporate governance news.",
      }),
      uaeBanking,
      catalogLogic,
      record!,
    );
    expect(conceptMismatch.approved).toBe(true);

    const applicable = approveDriverSource(
      source({
        url: seedUrl,
        domain: "files.sciencebasedtargets.org",
        contentSnippet:
          "United Arab Emirates financial institutions use science based targets and sector pathways for banking portfolios.",
      }),
      uaeBanking,
      catalogLogic,
      record!,
    );
    expect(applicable.approved).toBe(true);
    // The full concept/claim match must rank strictly above the mismatch.
    expect(applicable.source!.relevanceScore).toBeGreaterThan(
      conceptMismatch.source!.relevanceScore,
    );
  });

  it("approves exact UNFCCC Paris source only for its scoped global logic", () => {
    const result = approveDriverSource(
      source({
        title: "UNFCCC - The Paris Agreement",
        url: "https://unfccc.int/process-and-meetings/the-paris-agreement",
        domain: "unfccc.int",
        contentSnippet: "The Paris Agreement and NDC framework shape global climate action.",
      }),
      uaeBanking,
      logic("global-climate-commitments"),
    );

    expect(result.approved).toBe(true);
    expect(result.source?.approvalId).toBe("unfccc-paris-agreement");
    expect(isSourceApprovedDirect(result.source!)).toBe(true);
  });

  it("rejects Nigeria evidence for a UAE country-specific driver", () => {
    const result = approveDriverSource(
      source({
        title: "Nigeria Climate Change Knowledge Portal",
        url: "https://climateknowledgeportal.worldbank.org/country/nigeria",
        domain: "climateknowledgeportal.worldbank.org",
        contentSnippet: "Nigeria faces heat and flooding risks that affect economic activity.",
      }),
      uaeBanking,
      logic("country-sector-climate-risk"),
    );

    expect(result.approved).toBe(false);
    expect(result.rejected?.reason).toBe("country-mismatch");
  });

  it("keeps UNFCCC NDC registry as context-only, not direct citation evidence", () => {
    const result = approveDriverSource(
      source({
        title: "UNFCCC NDC Registry",
        url: "https://unfccc.int/NDCREG",
        domain: "unfccc.int",
        contentSnippet: "The registry includes United Arab Emirates NDC submissions.",
      }),
      uaeBanking,
      logic("country-climate-policy"),
    );

    expect(result.approved).toBe(true);
    expect(result.source?.approvalUsage).toBe("context");
    expect(isSourceApprovedDirect(result.source!)).toBe(false);
  });

  it("rejects an approved direct URL when page retrieval failed", () => {
    const result = approveDriverSource(
      source({
        title: "UNFCCC - The Paris Agreement",
        url: "https://unfccc.int/process-and-meetings/the-paris-agreement",
        domain: "unfccc.int",
        snippet: "A search result says this is relevant.",
        contentSnippet: "",
        retrievalStatus: "failed",
        evidenceProvenance: "search-snippet",
        finalUrl: null,
        retrievalError: "timeout",
      }),
      uaeBanking,
      logic("global-climate-commitments"),
    );

    expect(result.approved).toBe(false);
    expect(result.rejected?.reason).toBe("retrieval-failed");
  });

  it("allows only an explicitly marked registry fallback as context", () => {
    const result = approveDriverSource(
      source({
        title: "UNFCCC NDC Registry",
        url: "https://unfccc.int/NDCREG",
        domain: "unfccc.int",
        snippet: "Official registry for country NDC submissions.",
        contentSnippet: "",
        retrievalStatus: "failed",
        evidenceProvenance: "approved-context",
        isContextualFallback: true,
        finalUrl: null,
        retrievalError: "blocked",
      }),
      uaeBanking,
      logic("country-climate-policy"),
    );

    expect(result.approved).toBe(true);
    expect(result.source?.approvalUsage).toBe("context");
    expect(isSourceApprovedDirect(result.source!)).toBe(false);
  });

  it("does not append user country, sector, or logic text to fallback evidence", () => {
    const fallback = buildApprovedFallbackItems(uaeBanking, [
      logic("global-climate-commitments"),
    ])[0];

    expect(fallback.snippet).not.toContain("Context:");
    expect(fallback.snippet).not.toContain("Evidence target:");
    expect(fallback.snippet).not.toContain("UAE Banking");
  });

  it("provides redundant live-fetch-safe UN paths for global commitments", () => {
    const fallbacks = buildApprovedFallbackItems(uaeBanking, [
      logic("global-climate-commitments"),
    ]);
    const fallbackIds = fallbacks.map(
      (fallback) => matchApprovedSource(fallback.link)?.id,
    );

    expect(fallbackIds).toEqual(
      expect.arrayContaining([
        "un-paris-agreement",
        "un-climate-key-findings",
      ]),
    );
    expect(fallbackIds).not.toContain("unfccc-paris-agreement");
    expect(
      matchApprovedSource(
        "https://unfccc.int/process-and-meetings/the-paris-agreement",
      )?.id,
    ).toBe("unfccc-paris-agreement");
  });

  it("uses current exact DFSA and ADGM URLs for UAE sustainable finance", () => {
    const fallbacks = buildApprovedFallbackItems(uaeBanking, [
      logic("sustainable-finance-market"),
    ]);

    expect(fallbacks.map((fallback) => fallback.link)).toEqual(
      expect.arrayContaining([
        "https://www.dfsa.ae/what-we-do/sustainable-finance/about-sustainable-finance",
        "https://www.adgm.com/initiatives/sustainable-finance",
      ]),
    );
    expect(
      matchApprovedSource(
        "https://www.dfsa.ae/what-we-do/sustainable-finance/about-sustainable-finance",
      )?.countries,
    ).toEqual(["UAE"]);
    expect(
      matchApprovedSource("https://www.adgm.com/initiatives/sustainable-finance")
        ?.countries,
    ).toEqual(["UAE"]);
  });

  it("provides live, authoritative fallback coverage for every D7 logic", () => {
    const macroFallbacks = buildApprovedFallbackItems(uaeBanking, [
      logic("global-climate-macro-risk"),
    ]);
    expect(macroFallbacks.map((fallback) => fallback.link)).toContain(
      "https://www.worldbank.org/ext/en/topic/climate-change",
    );

    const supervisorIds = buildApprovedFallbackItems(uaeBanking, [
      logic("financial-supervisor-climate-risk"),
    ]).map((fallback) => matchApprovedSource(fallback.link)?.id);
    expect(supervisorIds).toEqual(
      expect.arrayContaining([
        "fsb-climate-related-financial-risks",
        "ngfs-home",
        "basel-climate-financial-risks",
      ]),
    );

    const adaptationIds = buildApprovedFallbackItems(uaeBanking, [
      logic("country-adaptation-resilience"),
    ]).map((fallback) => matchApprovedSource(fallback.link)?.id);
    expect(adaptationIds).toEqual(
      expect.arrayContaining([
        "uae-national-climate-adaptation-plan",
        "uae-national-climate-change-plan",
      ]),
    );
    expect(adaptationIds).not.toContain("uae-net-zero-2050");
  });

  it.each([
    ["iosco-sustainable-finance", 90],
    ["fsb-climate-related-financial-risks", 90],
    ["basel-climate-financial-risks", 90],
    ["globalabc-home", 85],
    ["worldgbc-advancing-net-zero", 85],
  ])("assigns a curated authority floor to %s", (id, floor) => {
    expect(
      APPROVED_DRIVER_SOURCES.find((record) => record.id === id)
        ?.authorityScoreFloor,
    ).toBe(floor);
  });

  it("provides banking-specific target-setting sources including the SBTi canonical URL", () => {
    const fallbackIds = buildApprovedFallbackItems(uaeBanking, [
      logic("sector-target-setting-pressure"),
    ]).map((fallback) => matchApprovedSource(fallback.link)?.id);

    expect(fallbackIds).toEqual(
      expect.arrayContaining([
        "unep-fi-principles-responsible-banking",
        "unep-fi-net-zero-banking",
        "sbti-sectors",
      ]),
    );
    expect(
      matchApprovedSource("https://sciencebasedtargets.org/standards-and-guidance")
        ?.id,
    ).toBe("sbti-sectors");
  });

  it("does not classify generic renewable energy as oil and gas", () => {
    expect(getSectorGroupForRegistry("Renewable Energy")).toBe("general");
    expect(getSectorGroupForRegistry("Oil & Gas")).toBe("oil-gas");
  });

  it("requires page-level sector evidence for an All-sectors source", () => {
    const result = approveDriverSource(
      source({
        title: "Science Based Targets initiative - Sectors",
        url: "https://sciencebasedtargets.org/sectors",
        domain: "sciencebasedtargets.org",
        contentSnippet:
          "The World Bank describes science-based climate pathways and emissions guidance across industries.",
      }),
      uaeBanking,
      logic("sector-transition-initiative"),
    );

    expect(result.approved).toBe(false);
    expect(result.rejected?.reason).toBe("sector-mismatch");
  });

  it("matches country aliases on token boundaries, not inside other words", () => {
    const result = approveDriverSource(
      source({
        title: "Suave climate profile",
        url: "https://climateknowledgeportal.worldbank.org/country/suave",
        domain: "climateknowledgeportal.worldbank.org",
        contentSnippet:
          "Suave banking climate exposure includes heat and flooding risk for financial institutions.",
      }),
      uaeBanking,
      logic("country-sector-climate-risk"),
    );

    expect(result.approved).toBe(false);
    expect(result.rejected?.reason).toBe("country-mismatch");
  });

  it("does not use generic assets as real-estate sector evidence", () => {
    const result = approveDriverSource(
      source({
        title: "Science Based Targets initiative - Sectors",
        url: "https://sciencebasedtargets.org/sectors",
        domain: "sciencebasedtargets.org",
        contentSnippet:
          "Institutional investors evaluate financial assets using climate emissions pathways.",
      }),
      { ...uaeBanking, sector: "Real Estate" },
      logic("sector-transition-initiative"),
    );

    expect(result.approved).toBe(false);
    expect(result.rejected?.reason).toBe("sector-mismatch");
  });

  it("provides Saudi Exchange regulatory coverage for every supported Saudi sector", () => {
    for (const sector of ["Banking", "Construction", "Real Estate", "Oil & Gas"]) {
      const fallbacks = buildApprovedFallbackItems(
        { country: "Saudi Arabia", sector, language: "English" },
        [logic("country-sector-regulation")],
      );
      expect(
        fallbacks.some(
          (fallback) =>
            matchApprovedSource(fallback.link)?.id ===
            "saudi-exchange-esg-guidelines",
        ),
      ).toBe(true);
    }
  });
});

describe("ESG driver logic replacement", () => {
  it("offers backup logics in the same section while preserving the default slot", () => {
    const defaultLogic = logic("country-sector-regulation");
    const candidates = getReplacementDriverLogics(defaultLogic, new Set());

    expect(candidates[0].id).toBe("country-sector-regulation");
    expect(candidates.some((candidate) => candidate.id === "market-disclosure-rule")).toBe(true);
    expect(candidates.every((candidate) => candidate.section === defaultLogic.section)).toBe(true);
  });
});
