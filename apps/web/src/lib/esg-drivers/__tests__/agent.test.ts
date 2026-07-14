import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { esgDriverAgentTestHelpers as helpers } from "../agent";

const {
  selectDriverArchetypes,
  archetypeSourceUrls,
  scopeApplies,
  kpiIsGrounded,
  normalizeConfidence,
} = helpers;

describe("normalizeConfidence", () => {
  it("rescales a 0-1 probability to 0-100", () => {
    expect(normalizeConfidence(0.9)).toBe(90);
    expect(normalizeConfidence(1)).toBe(100);
    expect(normalizeConfidence(0.55)).toBe(55);
  });

  it("keeps an already 0-100 value", () => {
    expect(normalizeConfidence(85)).toBe(85);
    expect(normalizeConfidence(42)).toBe(42);
  });

  it("clamps and guards bad input", () => {
    expect(normalizeConfidence(150)).toBe(100);
    expect(normalizeConfidence(-5)).toBe(0);
    expect(normalizeConfidence(Number.NaN)).toBe(0);
  });
});

describe("scopeApplies", () => {
  it("treats All / empty scopes as universal", () => {
    expect(scopeApplies(["All"], "Germany")).toBe(true);
    expect(scopeApplies([], "Anything")).toBe(true);
  });

  it("matches specific scopes case-insensitively", () => {
    expect(scopeApplies(["UAE"], "uae")).toBe(true);
    expect(scopeApplies(["Banking"], "Banking")).toBe(true);
  });

  it("rejects a non-matching specific scope", () => {
    expect(scopeApplies(["UAE"], "Germany")).toBe(false);
    expect(scopeApplies(["Oil & Gas"], "Banking")).toBe(false);
  });
});

describe("selectDriverArchetypes", () => {
  it("selects a capped, Mastersheet-only deck for an arbitrary country/sector", () => {
    const selected = selectDriverArchetypes({
      country: "Germany",
      sector: "Aviation",
      language: "English",
    });
    expect(selected.length).toBeGreaterThan(0);
    expect(selected.length).toBeLessThanOrEqual(12);
    // No specialist SBTi rows, every driver in scope with at least one Excel URL.
    for (const archetype of selected) {
      expect(archetype.origin).toBe("master");
      expect(archetypeSourceUrls(archetype).length).toBeGreaterThan(0);
      expect(scopeApplies(archetype.countryScopes, "Germany")).toBe(true);
      expect(scopeApplies(archetype.sectorScopes, "Aviation")).toBe(true);
    }
  });

  it("produces a balanced 12-driver deck for a well-covered country/sector", () => {
    const selected = selectDriverArchetypes({
      country: "UAE",
      sector: "Banking",
      language: "English",
    });
    expect(selected.length).toBe(12);
    expect(selected.every((a) => a.origin === "master")).toBe(true);
    // Grouped by section order (Global Drivers first).
    expect(selected[0].section).toBe("Global Drivers");
  });

  it("orders country-matching Excel URLs first for a multi-country archetype", () => {
    const fake = {
      document: null,
      workbookUrls: [
        "https://unfccc.int/kazakhstan_carbon_strategy.pdf",
        "https://u.ae/uae-net-zero-2050",
        "https://zerotracker.net/",
      ],
    } as unknown as Parameters<typeof archetypeSourceUrls>[0];
    const ordered = archetypeSourceUrls(fake, "UAE");
    expect(ordered[0].toLowerCase()).toContain("uae");
  });

  it("only ever cites Excel-derived URLs", () => {
    const selected = selectDriverArchetypes({
      country: "UAE",
      sector: "Banking",
      language: "English",
    });
    for (const archetype of selected) {
      for (const url of archetypeSourceUrls(archetype)) {
        expect(archetype.workbookUrls.concat(archetype.document?.url ?? [])).toContain(
          url,
        );
      }
    }
  });
});

describe("kpiIsGrounded", () => {
  const evidence = (text: string) => [
    { url: "https://x", domain: "x", text, lastModified: null },
  ];

  it("treats a qualitative KPI (no numbers) as grounded", () => {
    expect(kpiIsGrounded("Mainstream disclosure", evidence("anything"))).toBe(true);
  });

  it("grounds when a KPI number appears in the evidence", () => {
    expect(
      kpiIsGrounded("140+ countries by 2050", evidence("more than 140 countries")),
    ).toBe(true);
  });

  it("is not grounded when the KPI number is absent from evidence", () => {
    expect(
      kpiIsGrounded("300 billion by 2035", evidence("a goal of 100 billion")),
    ).toBe(false);
  });
});
