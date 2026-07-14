import { describe, expect, it } from "vitest";

import {
  buildDriverSelectionPlan,
  buildLegacyDriverSelectionPlan,
  ESG_DRIVER_SECTION_QUOTAS,
  getCatalogVersion,
  rankedCandidateToDriverLogic,
} from "../catalog";
import type { EsgDriverSection } from "../types";

const scenarios = [
  ["UAE", "Banking"],
  ["Saudi Arabia", "Oil & Gas"],
  ["Kazakhstan", "Construction"],
  ["UAE", "Real Estate"],
] as const;

describe("catalog-driven ESG driver selection", () => {
  it.each(scenarios)(
    "builds a deterministic, duplicate-free 3/3/2/2/2 plan for %s %s",
    (country, sector) => {
      const input = { country, sector, language: "English" };
      const first = buildDriverSelectionPlan(input);
      const second = buildDriverSelectionPlan(input);
      expect(second).toEqual(first);
      expect(first.mode).toBe("catalog");
      expect(first.catalogVersion).toBe(getCatalogVersion());
      expect(first.slots).toHaveLength(12);
      expect(first.maxCandidatePreflights).toBe(30);
      expect(first.backupTargetPerSection).toBe(2);

      const counts = first.slots.reduce<Record<string, number>>((result, slot) => {
        result[slot.section] = (result[slot.section] ?? 0) + 1;
        return result;
      }, {});
      expect(counts).toEqual(ESG_DRIVER_SECTION_QUOTAS);

      const primaryIds = first.slots.map((slot) => slot.candidateQueue[0].id);
      expect(new Set(primaryIds).size).toBe(12);
      const primaryNames = first.slots.map(
        (slot) => slot.candidateQueue[0].archetype.name,
      );
      expect(new Set(primaryNames).size).toBe(12);
      for (const slot of first.slots) {
        expect(slot.candidateQueue.length).toBeGreaterThanOrEqual(3);
        expect(
          slot.candidateQueue.every(
            (candidate) => candidate.archetype.section === slot.section,
          ),
        ).toBe(true);
        expect(
          slot.candidateQueue.every(
            (candidate) =>
              candidate.archetype.countryScopes.includes("All") ||
              candidate.archetype.countryScopes.includes(country),
          ),
        ).toBe(true);
      }
    },
  );

  it.each(scenarios)("activates only the specialist libraries for %s %s", (country, sector) => {
    const plan = buildDriverSelectionPlan({ country, sector, language: "English" });
    const specialistLibraries = new Set(
      plan.slots
        .flatMap((slot) => slot.candidateQueue)
        .filter((candidate) => candidate.archetype.origin === "specialist")
        .map((candidate) => candidate.archetype.specialistLibrary),
    );
    const expected =
      sector === "Banking"
        ? new Set([
            "SBTi Financial Institutions Net-Zero",
            "SBTi Financial Institutions Near-Term",
          ])
        : sector === "Construction" || sector === "Real Estate"
          ? new Set(["SBTi Buildings"])
          : new Set(["SBTi Oil & Gas"]);
    expect(specialistLibraries).toEqual(expected);
    expect(
      plan.slots
        .flatMap((slot) => slot.candidateQueue)
        .some((candidate) => candidate.scoreBreakdown.specialistFit > 0),
    ).toBe(true);
    expect(specialistLibraries.has("SBTi Power")).toBe(false);
    expect(specialistLibraries.has("SBTi Steel")).toBe(false);
  });

  it("keeps every ranked fallback in the same presentation section", () => {
    const plan = buildDriverSelectionPlan({
      country: "Saudi Arabia",
      sector: "Oil & Gas",
      language: "English",
    });
    const expectedOrder: EsgDriverSection[] = [
      "Global Drivers",
      "Global Drivers",
      "Global Drivers",
      "Regulatory Requirements",
      "Regulatory Requirements",
      "Regulatory Requirements",
      "Climate Risks",
      "Climate Risks",
      "Capital Markets",
      "Capital Markets",
      "Supply Chain",
      "Supply Chain",
    ];
    expect(plan.slots.map((slot) => slot.section)).toEqual(expectedOrder);
    const candidate = plan.slots[0].candidateQueue[0];
    const logic = rankedCandidateToDriverLogic(candidate);
    expect(logic.catalogArchetypeId).toBe(candidate.archetypeId);
    expect(logic.registryLogicIds).toEqual(candidate.registryLogicIds);
    expect(logic.seedUrls).toEqual(candidate.seedUrls);
    expect(logic.exampleGuidance).toBe(candidate.archetype.exampleGuidance);
  });

  it("adapts legacy rollback selection to the same plan and catalog version", () => {
    const plan = buildLegacyDriverSelectionPlan({
      country: "UAE",
      sector: "Banking",
      language: "English",
    });
    expect(plan.mode).toBe("legacy");
    expect(plan.catalogVersion).toBe(getCatalogVersion());
    expect(plan.slots).toHaveLength(12);
    expect(plan.slots.map((slot) => slot.candidateQueue[0].id)).toEqual([
      "global-climate-commitments",
      "sector-emissions-footprint",
      "sector-transition-initiative",
      "global-disclosure-standards",
      "country-climate-policy",
      "country-sector-regulation",
      "global-climate-macro-risk",
      "country-sector-climate-risk",
      "investor-lender-expectations",
      "development-finance-pressure",
      "supply-chain-climate-exposure",
      "sector-supply-chain-solution",
    ]);
  });
});
