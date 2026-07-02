import { z } from "zod";

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
    .min(3)
    .describe("Driver logic id copied exactly from the provided driver logic plan."),
  driverSection: driverSectionSchema,
  driverType: driverTypeSchema,
  driverTitle: z.string().min(4),
  driverText: z.string().min(40),
  countrySectorRelevance: z.string().min(20),
  evidenceKpi: z.string().min(8),
  keySources: z
    .array(
      z
        .string()
        .min(2)
        .describe("Exact organization or publisher names from the evidence."),
    )
    .min(1)
    .max(5),
  sourceLinks: z
    .array(z.string().min(8).describe("Source URL copied exactly from the evidence list."))
    .min(1)
    .max(5),
  confidence: z.number().min(0).max(100),
  sourceRefs: z.array(z.string().min(2)).min(1).max(5),
});

export const generatedDriverPackSchema = z.object({
  drivers: z.array(generatedDriverSchema).length(12),
  warnings: z.array(z.string()).max(8),
});

export const generatedSingleDriverSchema = generatedDriverSchema.extend({
  sourceLinks: z
    .array(z.string().min(8).describe("Source URL copied exactly from this driver's evidence pack."))
    .min(1)
    .max(3),
  sourceRefs: z.array(z.string().min(2)).min(1).max(3),
});

export const driverQueryPlanSchema = z.object({
  queries: z
    .array(z.string().min(8).max(180))
    .min(4)
    .max(8)
    .describe("Targeted web search queries for this single ESG driver logic."),
  rationale: z.string().min(20).max(500),
});

export const driverVerificationSchema = z.object({
  passed: z.boolean(),
  score: z.number().min(0).max(100),
  reasons: z.array(z.string()).max(8),
  requiredRepairs: z.array(z.string()).max(8),
  unsupportedMetrics: z.array(z.string()).max(8),
  sourceIssues: z.array(z.string()).max(8),
  styleIssues: z.array(z.string()).max(8),
  recommendedConfidence: z.number().min(0).max(100),
  canRepair: z.boolean(),
});

export const deckReviewSchema = z.object({
  passed: z.boolean(),
  score: z.number().min(0).max(100),
  warnings: z.array(z.string()).max(12),
});

export const generateDriversRequestSchema = z.object({
  country: z.string().trim().min(2).max(120),
  sector: z.string().trim().min(2).max(160),
  language: z.string().trim().min(2).max(80).default("English"),
});

export type GeneratedDriverPack = z.infer<typeof generatedDriverPackSchema>;
export type GeneratedSingleDriver = z.infer<typeof generatedSingleDriverSchema>;
