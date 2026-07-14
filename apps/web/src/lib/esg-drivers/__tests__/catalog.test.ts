import { describe, expect, it } from "vitest";

import {
  assertExactCatalogSeedUrl,
  assertReviewedCatalogWorkbookUrl,
  ESG_DRIVER_CATALOG,
  getCatalogSeedSource,
  getCatalogVersion,
} from "../catalog";
import type { EsgDriverLogic } from "../logic";
import { resolveApprovedCatalogSeedSource } from "../source-registry";

describe("ESG driver catalog", () => {
  it("pins the reviewed workbook and imports every expected record", () => {
    expect(ESG_DRIVER_CATALOG.manifest.workbookSha256).toBe(
      "9061d0574ecaffd568004be72e6e26ed7cd380e27231d01f9b71be57b4565cf6",
    );
    expect(ESG_DRIVER_CATALOG.manifest.counts).toMatchObject({
      master: 78,
      specialist: 161,
      total: 239,
    });
    expect(getCatalogVersion()).toBe(ESG_DRIVER_CATALOG.manifest.catalogVersion);
    expect(getCatalogVersion()).toMatch(/^1\.0\.0\+9061d0574eca\.[a-f0-9]{12}$/);
    expect(ESG_DRIVER_CATALOG.manifest.pipelineSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("uses stable unique semantic IDs", () => {
    const ids = ESG_DRIVER_CATALOG.archetypes.map((archetype) => archetype.id);
    expect(new Set(ids).size).toBe(239);
    expect(ids.every((id) => /^[a-z0-9-]+-[a-f0-9]{8}$/.test(id))).toBe(true);
  });

  it("inherits specialist document URLs and preserves page references", () => {
    const specialists = ESG_DRIVER_CATALOG.archetypes.filter(
      (archetype) => archetype.origin === "specialist",
    );
    expect(specialists).toHaveLength(161);
    expect(specialists.every((archetype) => Boolean(archetype.document?.url))).toBe(true);
    expect(
      specialists.some(
        (archetype) =>
          archetype.document?.inheritedUrl &&
          (archetype.document.pageReferences.length ?? 0) > 0,
      ),
    ).toBe(true);

    const buildingRows = specialists.filter(
      (archetype) => archetype.sourceSheet === "SBTi Buildings",
    );
    expect(new Set(buildingRows.map((row) => row.document?.url)).size).toBe(1);
    expect(buildingRows.slice(1).every((row) => row.document?.inheritedUrl)).toBe(true);
  });

  it("preserves balanced URL parentheses and normalizes list scopes", () => {
    const kazakhstanEts = ESG_DRIVER_CATALOG.archetypes.find(
      (archetype) => archetype.name === "Kazakhstan ETS",
    );
    expect(kazakhstanEts?.workbookUrls).toContain(
      "https://gfc.aifc.kz/uploads/emissions-trading-systems-and-voluntary-carbon-market-global-overview-and-prospects-for-kazakhstan%20(2).pdf",
    );
    expect(kazakhstanEts?.sectorScopes).toEqual(["Energy", "Mining", "Industry"]);
    expect(kazakhstanEts?.evidenceCategory).toBe("regulation");
    expect(
      ESG_DRIVER_CATALOG.archetypes.flatMap((archetype) => archetype.sectorScopes),
    ).not.toContain("Energy, Mining, Industry");
  });

  it("keeps guidance URLs separate from exact reviewed seeds", () => {
    expect(ESG_DRIVER_CATALOG.seedSources.length).toBeGreaterThan(0);
    for (const source of ESG_DRIVER_CATALOG.seedSources) {
      expect(getCatalogSeedSource(source.exactUrl)?.exactUrl).toBe(source.exactUrl);
      expect(assertExactCatalogSeedUrl(source.exactUrl)).toBe(source.exactUrl);
    }
    const guidanceOnly = ESG_DRIVER_CATALOG.archetypes
      .flatMap((archetype) => archetype.guidanceOnlyUrls)
      .find(Boolean);
    expect(guidanceOnly).toBeTruthy();
    expect(getCatalogSeedSource(guidanceOnly as string)).toBeUndefined();
    expect(() => assertExactCatalogSeedUrl(guidanceOnly as string)).toThrow(
      /not an approved exact ESG catalog seed/i,
    );
  });

  it("resolves every generated exact seed through a reviewed runtime publisher", () => {
    for (const archetype of ESG_DRIVER_CATALOG.archetypes) {
      const logic: EsgDriverLogic = {
        id: archetype.id,
        section: archetype.section,
        type: archetype.type,
        logic: archetype.logic,
        preciseQuestion: archetype.preciseQuestion,
        evidenceTarget: archetype.evidenceTarget,
        sourcePriorities: archetype.keyPublishers,
        registryLogicIds: archetype.registryLogicIds,
        catalogArchetypeId: archetype.id,
        catalogName: archetype.name,
        catalogCountryScopes: archetype.countryScopes,
        catalogSectorScopes: archetype.sectorScopes,
        catalogSectorFamilies: archetype.sectorFamilies,
      };
      for (const url of archetype.seedUrls) {
        const source = getCatalogSeedSource(url);
        expect(source, url).toBeDefined();
        expect(
          resolveApprovedCatalogSeedSource(
            {
              url,
              domain: source!.domain,
              registryApprovalIds: source!.registryApprovalIds,
              pageReferences: archetype.document?.pageReferences ?? [],
              documentVersion: archetype.document?.version ?? null,
            },
            logic,
          ),
          `${archetype.id}: ${url}`,
        ).not.toBeNull();
      }
    }
  });

  it("rejects malformed, non-HTTPS, and unreviewed workbook sources", () => {
    expect(() => assertReviewedCatalogWorkbookUrl("not a URL")).toThrow(/invalid/i);
    expect(() => assertReviewedCatalogWorkbookUrl("http://www.ifrs.org/report")).toThrow(
      /HTTPS/i,
    );
    expect(() =>
      assertReviewedCatalogWorkbookUrl("https://unreviewed-publisher.example/report"),
    ).toThrow(/unreviewed/i);
  });
});
