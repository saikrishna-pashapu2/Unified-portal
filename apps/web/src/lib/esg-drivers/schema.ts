import { z } from "zod";
import {
  canonicalizeEsgDriverCountry,
  canonicalizeEsgDriverSector,
  ESG_DRIVER_COUNTRY_OPTIONS,
  ESG_DRIVER_SECTOR_OPTIONS,
} from "./coverage";

export {
  ESG_DRIVER_COUNTRY_OPTIONS,
  ESG_DRIVER_SECTOR_OPTIONS,
} from "./coverage";

const nonBlankString = z.string().trim().min(1);
const verificationMessageSchema = nonBlankString.max(500);

export const SUPPORTED_ESG_DRIVER_COUNTRIES = ESG_DRIVER_COUNTRY_OPTIONS;
export const SUPPORTED_ESG_DRIVER_SECTORS = ESG_DRIVER_SECTOR_OPTIONS;

// Any country / any sector is accepted. Known aliases are normalized to the
// catalog's canonical label (so "UAE" and "United Arab Emirates" behave the
// same); anything else passes through as typed. The agent selects whichever
// reviewed archetypes apply (All-scoped drivers always apply).
const supportedCountrySchema = z
  .string()
  .trim()
  .min(2)
  .max(120)
  .transform((value) => canonicalizeEsgDriverCountry(value) || value);

const supportedSectorSchema = z
  .string()
  .trim()
  .min(2)
  .max(160)
  .transform((value) => canonicalizeEsgDriverSector(value) || value);

export const driverSectionSchema = z.enum([
  "Global Drivers",
  "Regulatory Requirements",
  "Climate Risks",
  "Capital Markets",
  "Supply Chain",
]);

export const driverTypeSchema = z.enum([
  "General",
  "Sector-related",
  "Country-related",
]);

export const generatedDriverSchema = z.object({
  driverLogicId: z
    .string()
    .trim()
    .min(3)
    .describe("Driver logic id copied exactly from the provided driver logic plan."),
  driverSection: driverSectionSchema,
  driverType: driverTypeSchema,
  driverTitle: z.string().trim().min(4).max(160),
  driverText: z.string().trim().min(40).max(600),
  countrySectorRelevance: z.string().trim().min(20).max(600),
  evidenceKpi: z.string().trim().min(8).max(400),
  keySources: z
    .array(
      z
        .string()
        .trim()
        .min(2)
        .max(160)
        .describe(
          "Distinct exact approved source labels for sourceLinks, in citation order. This redundant metadata is canonicalized from the cited evidence URLs.",
        ),
    )
    .min(1)
    .max(5),
  sourceLinks: z
    .array(
      z
        .string()
        .trim()
        .min(8)
        .max(2_048)
        .describe("Source URL copied exactly from the evidence list."),
    )
    .min(1)
    .max(5),
  confidence: z.number().min(0).max(100),
  sourceRefs: z
    .array(
      z
        .string()
        .trim()
        .min(2)
        .max(120)
        .describe(
          "Top-level evidence entry id for a cited sourceLink, not approvedSource.id. This is redundant metadata and is canonicalized from sourceLinks.",
        ),
    )
    .min(1)
    .max(5),
});

export const generatedDriverPackSchema = z.object({
  drivers: z.array(generatedDriverSchema).length(12),
  warnings: z.array(verificationMessageSchema).max(8),
});

export const generatedSingleDriverSchema = generatedDriverSchema.extend({
  sourceLinks: z
    .array(
      z
        .string()
        .trim()
        .min(8)
        .max(2_048)
        .describe("Source URL copied exactly from this driver's evidence pack."),
    )
    .min(1)
    .max(3),
  sourceRefs: z
    .array(
      z
        .string()
        .trim()
        .min(2)
        .max(120)
        .describe(
          "Top-level evidence entry id for a cited sourceLink, not approvedSource.id. This redundant metadata is canonicalized from sourceLinks.",
        ),
    )
    .min(1)
    .max(3),
});

export const driverQueryPlanSchema = z.object({
  queries: z
    .array(z.string().trim().min(8).max(180))
    .min(4)
    .max(8)
    .describe("Targeted web search queries for this single ESG driver logic."),
  rationale: z.string().trim().min(20).max(500),
});

export const driverVerificationSchema = z.object({
  passed: z.boolean(),
  score: z.number().min(0).max(100),
  reasons: z
    .array(verificationMessageSchema)
    .max(8)
    .describe(
      "Concise observations explaining the verdict. These may confirm passing checks; every blocking defect must also be placed in its typed issue array and set passed=false.",
    ),
  requiredRepairs: z
    .array(verificationMessageSchema)
    .max(8)
    .describe("Blocking semantic or structural repairs only; empty when none."),
  unsupportedMetrics: z
    .array(verificationMessageSchema)
    .max(8)
    .describe("Blocking unsupported metric/date/target defects only; empty when none."),
  sourceIssues: z
    .array(verificationMessageSchema)
    .max(8)
    .describe("Blocking citation or source defects only; empty when none."),
  styleIssues: z
    .array(verificationMessageSchema)
    .max(8)
    .describe("Blocking pitch-readiness defects only; empty when none."),
  recommendedConfidence: z.number().min(0).max(100),
  canRepair: z.boolean(),
});

export const deckReviewSchema = z.object({
  passed: z.boolean(),
  score: z.number().min(0).max(100),
  warnings: z.array(verificationMessageSchema).max(12),
});

export const generateDriversRequestSchema = z.object({
  country: supportedCountrySchema,
  sector: supportedSectorSchema,
  language: z.string().trim().min(2).max(80).default("English"),
});

export type GeneratedDriverPack = z.infer<typeof generatedDriverPackSchema>;
export type GeneratedSingleDriver = z.infer<typeof generatedSingleDriverSchema>;
