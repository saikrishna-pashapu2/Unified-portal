import { describe, expect, it } from "vitest";
import {
  driverVerificationSchema,
  generateDriversRequestSchema,
  generatedSingleDriverSchema,
} from "../schema";

describe("ESG driver request coverage", () => {
  it("canonicalizes supported country and sector aliases", () => {
    expect(
      generateDriversRequestSchema.parse({
        country: "  United Arab Emirates ",
        sector: " financial services ",
        language: " Arabic ",
      }),
    ).toEqual({ country: "UAE", sector: "Banking", language: "Arabic" });
  });

  it("accepts any country and sector, passing unknown values through as typed", () => {
    const parsed = generateDriversRequestSchema.parse({
      country: "Germany",
      sector: "Aviation",
      language: "English",
    });
    expect(parsed).toEqual({
      country: "Germany",
      sector: "Aviation",
      language: "English",
    });
  });

  it("still enforces a minimum length for country and sector", () => {
    const country = generateDriversRequestSchema.safeParse({
      country: "X",
      sector: "Banking",
      language: "English",
    });
    expect(country.success).toBe(false);
  });
});

describe("trimmed structured model output", () => {
  it("trims every schema-owned generated string", () => {
    const result = generatedSingleDriverSchema.parse({
      driverLogicId: " logic-1 ",
      driverSection: "Global Drivers",
      driverType: "General",
      driverTitle: " Specific title ",
      driverText:
        " A sufficiently detailed ESG driver statement that clears the minimum length. ",
      countrySectorRelevance:
        " This explicitly connects the UAE banking sector to the driver. ",
      evidenceKpi: " ISSB S2 in 2026 ",
      keySources: [" IFRS Foundation "],
      sourceLinks: [" https://example.com/source "],
      confidence: 80,
      sourceRefs: [" D1-S1 "],
    });

    expect(result).toMatchObject({
      driverLogicId: "logic-1",
      driverTitle: "Specific title",
      keySources: ["IFRS Foundation"],
      sourceLinks: ["https://example.com/source"],
      sourceRefs: ["D1-S1"],
    });
  });

  it("rejects whitespace-only verifier messages", () => {
    const result = driverVerificationSchema.safeParse({
      passed: false,
      score: 0,
      reasons: ["   "],
      requiredRepairs: [],
      unsupportedMetrics: [],
      sourceIssues: [],
      styleIssues: [],
      recommendedConfidence: 0,
      canRepair: false,
    });

    expect(result.success).toBe(false);
  });
});
