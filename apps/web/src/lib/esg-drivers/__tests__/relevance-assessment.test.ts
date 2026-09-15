import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assessment: vi.fn(),
  review: vi.fn(),
  translation: vi.fn(),
  calls: [] as Array<{ name: string; messages: unknown[] }>,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/config/env", () => ({
  env: { OPENAI_API_KEY: "test", OPENAI_ESG_DRIVERS_MODEL: "gpt-5.6-luna" },
}));
vi.mock("@langchain/openai", () => ({
  ChatOpenAI: class {
    withStructuredOutput(_schema: unknown, options: { name: string }) {
      return {
        invoke: async (...args: unknown[]) => {
          const messages = args[0] as unknown[];
          mocks.calls.push({ name: options.name, messages });
          const value = options.name === "esg_driver_relevance_translation"
            ? await mocks.translation(...args)
            : options.name === "esg_driver_relevance_review"
              ? await mocks.review(...args)
            : await mocks.assessment(...args);
          return {
            parsed: value,
            raw: {
              id: `${options.name}-response`,
              response_metadata: { model_name: "gpt-5.6-luna" },
            },
          };
        },
      };
    }
  },
}));

import {
  assessDriverRelevance,
  buildRelevanceScoringPayload,
  ensureDriverRelevance,
  needsRelevanceAssessment,
  RelevanceAssessmentRejectedError,
} from "../relevance-assessment";
import type { EsgDriver } from "../types";

const input = {
  country: "UAE",
  sector: "Banking",
  language: "English" as const,
  assessmentDate: "2026-09-15T00:00:00.000Z",
};
const baseDriver: EsgDriver = {
  id: "driver-1",
  driverTitle: "Paris Agreement",
  driverType: "General",
  driverSection: "Global Drivers",
  driverText: "Translated prose must not enter scoring.",
  countrySectorRelevance: "Translated country relevance must not enter scoring.",
  evidenceKpi: "Translated KPI must not enter scoring.",
  keySources: ["Workbook source"],
  sourceLinks: ["https://example.org/source"],
  sourceRefs: ["source-1"],
  confidence: 0,
  lastChecked: "2026-09-15T00:00:00.000Z",
  generationStatus: "verified",
  citations: [{
    sourceId: "source-1",
    passageId: "passage-1",
    quote: "The Paris Agreement applies broadly to parties and guides climate action.",
    location: "paragraph 1",
  }],
};

function scoredResponse() {
  return {
    dimensions: {
      country: { rating: 4, reason: "The supplied framework applies broadly to the selected country scope.", passageIds: ["passage-1"] },
      sector: { rating: 5, reason: "The supplied framework is directly applicable to climate action relevant to banking.", passageIds: ["passage-1"] },
      businessImpact: { rating: 3, reason: "The passage supports a material climate action implication without a quantified impact.", passageIds: ["passage-1"] },
      urgency: { rating: 2, reason: "The passage supports conditional pressure, with no unsupported deadline asserted.", passageIds: ["passage-1"] },
    },
    rationale: "The framework is directly relevant to the selected banking scope, with impact and urgency stated conservatively.",
  };
}

function translationResponse() {
  return {
    dimensions: {
      country: { rating: 4, reason: "سبب البلد المترجم.", passageIds: ["passage-1"] },
      sector: { rating: 5, reason: "سبب القطاع المترجم.", passageIds: ["passage-1"] },
      businessImpact: { rating: 3, reason: "سبب الأثر المترجم.", passageIds: ["passage-1"] },
      urgency: { rating: 2, reason: "سبب الاستعجال المترجم.", passageIds: ["passage-1"] },
    },
    rationale: "مبررات مترجمة مع الحفاظ على التقييم والأدلة.",
  };
}

function reviewResponse() {
  return {
    checks: {
      exactDriverSupport: true,
      noBorrowedObligations: true,
      urgencySupported: true,
      ratingsProportionate: true,
    },
    reasons: [],
  };
}

function repairedResponse() {
  const response = scoredResponse();
  return {
    ...response,
    dimensions: {
      ...response.dimensions,
      sector: { rating: 2, reason: "The passage supports only a limited conditional sector implication for this exact framework.", passageIds: ["passage-1"] },
      urgency: { rating: 0, reason: "The cited passage does not establish an implementation deadline for this exact framework.", passageIds: [] },
    },
  };
}

beforeEach(() => {
  mocks.assessment.mockReset().mockReturnValue(scoredResponse());
  mocks.review.mockReset().mockReturnValue(reviewResponse());
  mocks.translation.mockReset().mockReturnValue(translationResponse());
  mocks.calls.length = 0;
});

describe("evidence-grounded relevance assessment", () => {
  it("builds scoring input from canonical identity and cited passages only", () => {
    const payload = buildRelevanceScoringPayload(baseDriver, input);
    expect(payload).toEqual({
      workbookDriver: { id: "driver-1", name: "Paris Agreement", type: "General", section: "Global Drivers" },
      country: "UAE",
      sector: "Banking",
      assessmentDate: "2026-09-15T00:00:00.000Z",
      citedPassages: [{
        sourceId: "source-1",
        passageId: "passage-1",
        location: "paragraph 1",
        text: "The Paris Agreement applies broadly to parties and guides climate action.",
      }],
    });
    expect(JSON.stringify(payload)).not.toContain("Translated prose");
    expect(JSON.stringify(payload)).not.toContain("language");
  });

  it("computes the weighted integer score and preserves evidence IDs", async () => {
    const result = await assessDriverRelevance(baseDriver, input);
    expect(result).toMatchObject({
      assessmentVersion: "driver-specific-v2",
      policyVersion: "relevance-top15-v1",
      score: 75,
      band: "medium",
      assessor: { model: "gpt-5.6-luna", responseId: "esg_driver_relevance_assessment-response" },
      review: {
        reviewer: { model: "gpt-5.6-luna", responseId: "esg_driver_relevance_review-response" },
        checks: reviewResponse().checks,
      },
    });
    expect(result.dimensions.country).toEqual(expect.objectContaining({ rating: 4, passageIds: ["passage-1"] }));
    const scoringPayload = JSON.parse((mocks.calls[0].messages[1] as { content: string }).content);
    expect(scoringPayload).not.toHaveProperty("language");
    expect(scoringPayload).not.toHaveProperty("driverText");
    expect(scoringPayload.citedPassages[0].passageId).toBe("passage-1");
    const reviewPayload = JSON.parse((mocks.calls[1].messages[1] as { content: string }).content);
    expect(reviewPayload).toMatchObject({
      workbookDriver: { id: "driver-1", name: "Paris Agreement", type: "General", section: "Global Drivers" },
      country: "UAE",
      sector: "Banking",
      proposedAssessment: { score: 75, band: "medium" },
    });
    expect(reviewPayload).not.toHaveProperty("language");
    expect(reviewPayload).not.toHaveProperty("driverText");
  });

  it("accepts a justified zero urgency rating without inventing a deadline", async () => {
    const response = scoredResponse();
    mocks.assessment.mockReturnValue({
      ...response,
      dimensions: {
        ...response.dimensions,
        urgency: { rating: 0, reason: "The supplied passage has no implementation deadline for this exact framework.", passageIds: [] },
      },
    });
    const result = await assessDriverRelevance(baseDriver, input);
    expect(result.score).toBe(69);
    expect(result.dimensions.urgency).toEqual({ rating: 0, reason: "The supplied passage has no implementation deadline for this exact framework.", passageIds: [] });
    expect(result.review?.checks.urgencySupported).toBe(true);
  });

  it("translates reasons separately while retaining canonical scores and IDs", async () => {
    const result = await assessDriverRelevance(baseDriver, { ...input, language: "Arabic" });
    expect(result.score).toBe(75);
    expect(result.band).toBe("medium");
    expect(result.dimensions).toMatchObject({
      country: { rating: 4, passageIds: ["passage-1"], reason: "سبب البلد المترجم." },
      sector: { rating: 5, passageIds: ["passage-1"], reason: "سبب القطاع المترجم." },
    });
    expect(result.rationale).toBe("مبررات مترجمة مع الحفاظ على التقييم والأدلة.");
    expect(mocks.calls.map(({ name }) => name)).toEqual([
      "esg_driver_relevance_assessment",
      "esg_driver_relevance_review",
      "esg_driver_relevance_translation",
    ]);
  });

  it("retries malformed rubric evidence without inventing a fallback score", async () => {
    mocks.assessment
      .mockReturnValueOnce({ ...scoredResponse(), dimensions: { ...scoredResponse().dimensions, country: { rating: 4, reason: "Missing supplied ID.", passageIds: ["forged"] } } })
      .mockReturnValueOnce(scoredResponse());
    const result = await assessDriverRelevance(baseDriver, input);
    expect(result.score).toBe(75);
    expect(mocks.calls.filter(({ name }) => name === "esg_driver_relevance_assessment")).toHaveLength(2);
    expect(mocks.calls.filter(({ name }) => name === "esg_driver_relevance_review")).toHaveLength(1);
  });

  it("independently rejects borrowed obligations and repairs the assessment from review feedback", async () => {
    mocks.assessment.mockReturnValueOnce(scoredResponse()).mockReturnValueOnce(repairedResponse());
    mocks.review
      .mockReturnValueOnce({
        checks: { exactDriverSupport: false, noBorrowedObligations: false, urgencySupported: false, ratingsProportionate: false },
        reasons: [
          "The sector rating borrows an obligation from a background local regulation.",
          "The urgency rating uses a deadline that is not for the exact named framework.",
        ],
      })
      .mockReturnValueOnce(reviewResponse());

    const result = await assessDriverRelevance(baseDriver, input);
    expect(result.assessmentVersion).toBe("driver-specific-v2");
    expect(result.score).toBe(51);
    expect(result.dimensions.urgency).toEqual({ rating: 0, reason: "The cited passage does not establish an implementation deadline for this exact framework.", passageIds: [] });
    expect(result.review?.checks).toEqual(reviewResponse().checks);
    expect(mocks.calls.map(({ name }) => name)).toEqual([
      "esg_driver_relevance_assessment",
      "esg_driver_relevance_review",
      "esg_driver_relevance_assessment",
      "esg_driver_relevance_review",
    ]);
    const repairPayload = JSON.parse((mocks.calls[2].messages[1] as { content: string }).content);
    expect(repairPayload.repairFeedback).toEqual([
      "The sector rating borrows an obligation from a background local regulation.",
      "The urgency rating uses a deadline that is not for the exact named framework.",
    ]);
    expect(repairPayload).not.toHaveProperty("language");
    expect(repairPayload).not.toHaveProperty("driverText");
  });

  it("fails closed after two valid review rejections without fallback or translation", async () => {
    mocks.review.mockReturnValue({
      checks: { exactDriverSupport: false, noBorrowedObligations: false, urgencySupported: false, ratingsProportionate: false },
      reasons: ["The proposed ratings rely on background context rather than exact-driver support."],
    });

    let rejection: unknown;
    try {
      await assessDriverRelevance(baseDriver, input);
    } catch (error) {
      rejection = error;
    }
    expect(rejection).toBeInstanceOf(RelevanceAssessmentRejectedError);
    const rejected = rejection as RelevanceAssessmentRejectedError;
    expect(rejected.assessment.score).toBe(75);
    expect(rejected.assessment.review?.checks).toEqual({
      exactDriverSupport: false,
      noBorrowedObligations: false,
      urgencySupported: false,
      ratingsProportionate: false,
    });
    expect(rejected.assessment.assessor).toEqual({ model: "gpt-5.6-luna", responseId: "esg_driver_relevance_assessment-response" });
    expect(rejected.assessment.review?.reviewer).toEqual({ model: "gpt-5.6-luna", responseId: "esg_driver_relevance_review-response" });
    expect(rejected.reasons).toEqual(["The proposed ratings rely on background context rather than exact-driver support."]);
    expect(rejected.message).toContain("after bounded repair attempts");
    expect(mocks.calls.filter(({ name }) => name === "esg_driver_relevance_assessment")).toHaveLength(2);
    expect(mocks.calls.filter(({ name }) => name === "esg_driver_relevance_review")).toHaveLength(2);
    expect(mocks.calls.filter(({ name }) => name === "esg_driver_relevance_translation")).toHaveLength(0);
  });

  it("reuses a valid assessment and requests a score when it is missing or evidence changes", async () => {
    const relevance = await assessDriverRelevance(baseDriver, input);
    mocks.calls.length = 0;
    const saved = { ...baseDriver, relevance };
    const sameDayInput = {
      ...input,
      assessmentDate: `${new Date(relevance.assessedAt).toISOString().slice(0, 10)}T23:59:59.000Z`,
    };
    const nextDayInput = {
      ...sameDayInput,
      assessmentDate: new Date(Date.parse(relevance.assessedAt) + 86_400_000).toISOString(),
    };
    expect(needsRelevanceAssessment(saved, sameDayInput)).toBe(false);
    expect(needsRelevanceAssessment(saved, nextDayInput)).toBe(true);
    expect(needsRelevanceAssessment(baseDriver, input)).toBe(true);
    expect(needsRelevanceAssessment({
      ...saved,
      citations: [{ ...baseDriver.citations![0], quote: `${baseDriver.citations![0].quote} Updated.` }],
    }, input)).toBe(true);
    const reused = await ensureDriverRelevance(saved, sameDayInput);
    expect(reused.relevance).toBe(relevance);
    expect(mocks.calls).toHaveLength(0);
  });
});
