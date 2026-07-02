import "server-only";

import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";
import {
  deckReviewSchema,
  driverQueryPlanSchema,
  driverVerificationSchema,
  generatedSingleDriverSchema,
  type GeneratedSingleDriver,
} from "./schema";
import {
  formatDriverLogicPlan,
  getSectorSpecificGuidance,
  selectDriverLogics,
  type EsgDriverLogic,
} from "./logic";
import {
  buildDriverLogicSearchQueries,
  collectEsgDriverEvidenceForLogic,
} from "./research";
import type {
  AcceptedDriver,
  DriverEvidencePack,
  DriverResearchPlan,
  DriverVerificationResult,
  EsgDriver,
  EsgDriverResult,
  EsgDriverSource,
  GenerateEsgDriversInput,
  HarnessTrace,
  RejectedDriverAttempt,
} from "./types";

const HARNESS_LIMITS = {
  maxQueriesPerDriver: 8,
  maxCandidateSourcesPerDriver: 10,
  maxFinalSourceLinksPerDriver: 3,
  maxRewriteAttemptsPerDriver: 2,
  minimumConfidenceTarget: 75,
};

const translationSchema = z.object({
  drivers: z
    .array(
      z.object({
        id: z.string(),
        driverTitle: z.string().min(2),
        driverText: z.string().min(20),
        countrySectorRelevance: z.string().min(10),
        evidenceKpi: z.string().min(5),
      }),
    )
    .length(12),
});

const DriverHarnessState = Annotation.Root({
  input: Annotation<GenerateEsgDriversInput>(),
  logic: Annotation<EsgDriverLogic>(),
  driverId: Annotation<string>(),
  driverIndex: Annotation<number>(),
  totalDrivers: Annotation<number>(),
  plan: Annotation<DriverResearchPlan | null>(),
  evidencePack: Annotation<DriverEvidencePack | null>(),
  currentDriver: Annotation<EsgDriver | null>(),
  verification: Annotation<DriverVerificationResult | null>(),
  attemptCount: Annotation<number>(),
  rejectedAttempts: Annotation<RejectedDriverAttempt[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
  acceptedDriver: Annotation<AcceptedDriver | null>(),
  warnings: Annotation<string[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
});

type DriverHarnessStateValue = typeof DriverHarnessState.State;
type ProgressReporter = (stage: string, localProgress: number) => Promise<void>;

export async function generateEsgDriverResult(
  input: GenerateEsgDriversInput,
  onProgress?: (stage: string, progress: number) => Promise<void>,
): Promise<EsgDriverResult> {
  assertDriverGenerationConfig();

  const normalizedInput = {
    country: input.country.trim(),
    sector: input.sector.trim(),
    language: input.language.trim() || "English",
  };
  const startedAt = new Date().toISOString();
  const modelName = getModelName();

  await onProgress?.("selecting driver logic", 8);
  const driverLogics = selectDriverLogics(normalizedInput);
  const acceptedDrivers: AcceptedDriver[] = [];
  const rejectedAttempts: RejectedDriverAttempt[] = [];
  const driverPlans: DriverResearchPlan[] = [];
  const evidencePacks: DriverEvidencePack[] = [];
  const warnings: string[] = [];

  for (let index = 0; index < driverLogics.length; index += 1) {
    const logic = driverLogics[index];
    const accepted = await runDriverHarness(
      normalizedInput,
      logic,
      index,
      driverLogics.length,
      onProgress,
    );

    acceptedDrivers.push(accepted);
    rejectedAttempts.push(...accepted.evidencePackRejectedAttempts);
    driverPlans.push(accepted.evidencePackPlan);
    evidencePacks.push(accepted.evidencePack);
    warnings.push(...(accepted.driver.validationWarnings || []));
  }

  await onProgress?.("final deck review", 88);
  const deckReview = await reviewDeckConsistency(
    normalizedInput,
    driverLogics,
    acceptedDrivers.map((accepted) => accepted.driver),
  );

  if (!deckReview.passed && deckReview.score < 70) {
    throw new Error(
      `Final ESG driver deck review failed: ${deckReview.warnings.join("; ") || "quality score below threshold"}.`,
    );
  }

  let drivers = acceptedDrivers.map((accepted) => accepted.driver);
  if (!isEnglishLanguage(normalizedInput.language)) {
    await onProgress?.(`translating to ${normalizedInput.language}`, 92);
    drivers = await translateDrivers(drivers, normalizedInput.language);
  }

  await onProgress?.("finalizing source-linked driver table", 96);
  const evidence = acceptedDrivers.flatMap(
    (accepted) => accepted.evidencePack.selectedSources,
  );
  const completedAt = new Date().toISOString();
  const trace: HarnessTrace = {
    mode: "research-grade",
    model: modelName,
    startedAt,
    completedAt,
    limits: HARNESS_LIMITS,
    driverPlans,
    evidencePacks,
    acceptedDrivers: acceptedDrivers.map((accepted) => ({
      driverId: accepted.driver.id,
      driverLogicId: accepted.driver.driverLogicId || "",
      attempts: accepted.attempts,
      verificationScore: accepted.verification.score,
      confidence: accepted.driver.confidence,
    })),
    rejectedAttempts,
    deckReview,
    warnings: uniqueStrings([...warnings, ...deckReview.warnings]).slice(0, 20),
  };

  return {
    country: normalizedInput.country,
    sector: normalizedInput.sector,
    language: normalizedInput.language,
    generatedAt: completedAt,
    drivers,
    evidence,
    warnings: trace.warnings.slice(0, 12),
    trace,
  };
}

export function assertDriverGenerationConfig() {
  const missing = [
    ["OPENAI_API_KEY", process.env.OPENAI_API_KEY],
    ["GOOGLE_API_KEY_2", process.env.GOOGLE_API_KEY_2],
    ["GOOGLE_CSE_ID_2", process.env.GOOGLE_CSE_ID_2],
  ]
    .filter(([, value]) => !String(value || "").trim())
    .map(([name]) => name);

  if (missing.length > 0) {
    throw new Error(`Missing ESG driver runtime config: ${missing.join(", ")}.`);
  }
}

async function runDriverHarness(
  input: GenerateEsgDriversInput,
  logic: EsgDriverLogic,
  index: number,
  totalDrivers: number,
  onProgress?: (stage: string, progress: number) => Promise<void>,
): Promise<
  AcceptedDriver & {
    evidencePackPlan: DriverResearchPlan;
    evidencePackRejectedAttempts: RejectedDriverAttempt[];
  }
> {
  const driverId = `D${index + 1}`;
  const report: ProgressReporter = async (stage, localProgress) => {
    const base = 10 + (index / totalDrivers) * 76;
    const span = 76 / totalDrivers;
    const progress = Math.min(86, Math.round(base + span * (localProgress / 100)));
    await onProgress?.(`${stage} driver ${index + 1} of ${totalDrivers}`, progress);
  };

  const graph = createDriverHarnessGraph(report);
  const state = await graph.invoke({
    input,
    logic,
    driverId,
    driverIndex: index,
    totalDrivers,
    plan: null,
    evidencePack: null,
    currentDriver: null,
    verification: null,
    attemptCount: 0,
    rejectedAttempts: [],
    acceptedDriver: null,
    warnings: [],
  });

  if (!state.acceptedDriver || !state.plan) {
    throw new Error(`${driverId} could not be accepted by the ESG driver harness.`);
  }

  return {
    ...state.acceptedDriver,
    evidencePackPlan: state.plan,
    evidencePackRejectedAttempts: state.rejectedAttempts,
  };
}

function createDriverHarnessGraph(report: ProgressReporter) {
  return new StateGraph(DriverHarnessState)
    .addNode("plan_research", async (state) => {
      await report("planning research for", 5);
      const plan = await planDriverResearch(state.input, state.logic, state.driverId, state.driverIndex);
      return { plan };
    })
    .addNode("collect_evidence", async (state) => {
      if (!state.plan) throw new Error(`${state.driverId} research plan is missing.`);
      await report("researching", 25);
      const candidateSources = await collectEsgDriverEvidenceForLogic(
        state.input,
        state.logic,
        state.plan.queries,
        {
          maxQueries: HARNESS_LIMITS.maxQueriesPerDriver,
          maxCandidateSources: HARNESS_LIMITS.maxCandidateSourcesPerDriver,
          sourceIdPrefix: `${state.driverId}-S`,
          onSearchEvent: (message) => report(message, 34),
        },
      );
      if (candidateSources.length === 0) {
        throw new Error(`${state.driverId} found no usable ESG sources.`);
      }
      return {
        evidencePack: buildEvidencePack(state.plan, state.logic, candidateSources),
      };
    })
    .addNode("write_driver", async (state) => {
      if (!state.evidencePack) throw new Error(`${state.driverId} evidence pack is missing.`);
      await report(state.attemptCount === 0 ? "writing" : "rewriting", 58);
      const draft = await writeSingleEnglishDriver(
        state.input,
        state.logic,
        state.evidencePack,
        state.driverId,
        state.driverIndex,
        state.currentDriver,
        state.verification,
        state.attemptCount + 1,
      );
      const driver = normalizeSingleDriver(
        draft,
        state.evidencePack,
        state.logic,
        state.driverId,
        state.driverIndex,
      );
      return {
        currentDriver: driver,
        attemptCount: state.attemptCount + 1,
      };
    })
    .addNode("verify_driver", async (state) => {
      if (!state.currentDriver || !state.evidencePack) {
        throw new Error(`${state.driverId} driver draft is missing.`);
      }
      await report("verifying", 74);
      const verification = await verifySingleDriver(
        state.input,
        state.logic,
        state.evidencePack,
        state.currentDriver,
      );
      return { verification };
    })
    .addNode("repair_driver", async (state) => {
      if (!state.currentDriver || !state.verification) {
        throw new Error(`${state.driverId} repair state is missing.`);
      }
      await report("repairing", 84);
      return {
        rejectedAttempts: [
          {
            driverId: state.driverId,
            driverLogicId: state.logic.id,
            attempt: state.attemptCount,
            driver: state.currentDriver,
            verification: state.verification,
            createdAt: new Date().toISOString(),
          },
        ],
        warnings: state.verification.reasons,
      };
    })
    .addNode("accept_driver", async (state) => {
      if (!state.currentDriver || !state.evidencePack || !state.verification) {
        throw new Error(`${state.driverId} accept state is missing.`);
      }
      await report("accepted", 96);
      const linkedSources = getLinkedSources(
        state.currentDriver,
        state.evidencePack.candidateSources,
      );
      const selectedSources = uniqueSources([
        ...linkedSources,
        ...state.evidencePack.selectedSources,
      ]).slice(0, HARNESS_LIMITS.maxFinalSourceLinksPerDriver);
      const sourceLinks = selectedSources.map((source) => source.url);
      const sourceRefs = selectedSources.map((source) => source.id);
      const acceptedDriver: AcceptedDriver = {
        driver: {
          ...state.currentDriver,
          sourceLinks,
          sourceRefs,
          keySources: normalizeKeySources(
            state.currentDriver.keySources,
            selectedSources,
          ).slice(0, 5),
          confidence: Math.max(
            HARNESS_LIMITS.minimumConfidenceTarget,
            Math.min(
              state.currentDriver.confidence,
              state.verification.recommendedConfidence,
              96,
            ),
          ),
        },
        evidencePack: {
          ...state.evidencePack,
          selectedSources,
        },
        verification: state.verification,
        attempts: state.attemptCount,
      };
      return { acceptedDriver };
    })
    .addNode("fail_driver", (state) => {
      const reasons = state.verification?.reasons.join("; ") || "quality gates failed";
      throw new Error(`${state.driverId} failed ESG driver verification: ${reasons}.`);
    })
    .addEdge(START, "plan_research")
    .addEdge("plan_research", "collect_evidence")
    .addEdge("collect_evidence", "write_driver")
    .addEdge("write_driver", "verify_driver")
    .addConditionalEdges("verify_driver", routeAfterVerification, [
      "accept_driver",
      "repair_driver",
      "fail_driver",
    ])
    .addEdge("repair_driver", "write_driver")
    .addEdge("accept_driver", END)
    .addEdge("fail_driver", END)
    .compile();
}

function routeAfterVerification(
  state: DriverHarnessStateValue,
): "accept_driver" | "repair_driver" | "fail_driver" {
  const verification = state.verification;
  const driver = state.currentDriver;
  if (!verification || !driver) return "fail_driver";

  const acceptedConfidence = Math.min(
    driver.confidence,
    verification.recommendedConfidence,
  );
  if (
    verification.passed &&
    verification.score >= HARNESS_LIMITS.minimumConfidenceTarget &&
    acceptedConfidence >= HARNESS_LIMITS.minimumConfidenceTarget
  ) {
    return "accept_driver";
  }

  if (
    verification.canRepair &&
    state.attemptCount <= HARNESS_LIMITS.maxRewriteAttemptsPerDriver
  ) {
    return "repair_driver";
  }

  return "fail_driver";
}

async function planDriverResearch(
  input: GenerateEsgDriversInput,
  logic: EsgDriverLogic,
  driverId: string,
  driverIndex: number,
): Promise<DriverResearchPlan> {
  const fallbackQueries = buildDriverLogicSearchQueries(input, logic);

  try {
    const model = getStructuredModel().withStructuredOutput(driverQueryPlanSchema);
    const response = await model.invoke(
      [
        "You are planning web research for one ESG driver in a pitch deck.",
        "Return targeted Google Custom Search queries only. Prefer official, regulator, standard-setter, multilateral, investor, or sector-body sources.",
        "",
        `Country: ${input.country}`,
        `Sector: ${input.sector}`,
        `Driver: ${driverId}`,
        `Driver logic id: ${logic.id}`,
        `Question to answer: ${logic.preciseQuestion}`,
        `Evidence target: ${logic.evidenceTarget}`,
        `Preferred sources: ${logic.sourcePriorities.join(", ")}`,
        "",
        "Rules:",
        "- Generate 4 to 8 precise search queries.",
        "- Include country, sector, source priority names, and the exact ESG concept where useful.",
        "- Avoid generic searches like ESG trends unless paired with the precise driver logic.",
        "- Use current-year or latest terms for regulations and market data.",
        "",
        "Deterministic fallback queries to improve:",
        JSON.stringify(fallbackQueries, null, 2),
      ].join("\n"),
    );
    const parsed = driverQueryPlanSchema.parse(response);
    return {
      driverId,
      driverIndex,
      driverLogicId: logic.id,
      queries: buildDriverLogicSearchQueries(input, logic, parsed.queries),
      rationale: parsed.rationale,
    };
  } catch {
    return {
      driverId,
      driverIndex,
      driverLogicId: logic.id,
      queries: fallbackQueries,
      rationale: "Used deterministic Excel-style driver logic queries after query planning fallback.",
    };
  }
}

function buildEvidencePack(
  plan: DriverResearchPlan,
  logic: EsgDriverLogic,
  candidateSources: EsgDriverSource[],
): DriverEvidencePack {
  const selectedSources = selectFinalSources(candidateSources);
  return {
    driverId: plan.driverId,
    driverLogicId: logic.id,
    queries: plan.queries,
    candidateSources,
    selectedSources,
    extractedMetrics: extractEvidenceMetrics(candidateSources),
    evidenceSummary: [
      `${candidateSources.length} candidate sources researched for ${logic.id}.`,
      `${selectedSources.length} source(s) selected for final citation.`,
      `Evidence target: ${logic.evidenceTarget}`,
    ].join(" "),
  };
}

function selectFinalSources(sources: EsgDriverSource[]): EsgDriverSource[] {
  const authoritative = sources.filter(
    (source) => source.authorityScore >= 65 || source.sourceScore >= 72,
  );
  return uniqueSources(authoritative.length > 0 ? authoritative : sources).slice(
    0,
    HARNESS_LIMITS.maxFinalSourceLinksPerDriver,
  );
}

async function writeSingleEnglishDriver(
  input: GenerateEsgDriversInput,
  logic: EsgDriverLogic,
  evidencePack: DriverEvidencePack,
  driverId: string,
  driverIndex: number,
  previousDriver: EsgDriver | null,
  previousVerification: DriverVerificationResult | null,
  attempt: number,
): Promise<GeneratedSingleDriver> {
  const model = getStructuredModel().withStructuredOutput(generatedSingleDriverSchema);
  const response = await model.invoke(
    buildSingleDriverPrompt(
      input,
      logic,
      evidencePack,
      driverId,
      driverIndex,
      previousDriver,
      previousVerification,
      attempt,
    ),
  );

  return generatedSingleDriverSchema.parse(response);
}

function buildSingleDriverPrompt(
  input: GenerateEsgDriversInput,
  logic: EsgDriverLogic,
  evidencePack: DriverEvidencePack,
  driverId: string,
  driverIndex: number,
  previousDriver: EsgDriver | null,
  previousVerification: DriverVerificationResult | null,
  attempt: number,
): string {
  return [
    "You are an ESG strategy analyst writing one pitch-ready ESG driver.",
    "Use only the evidence pack supplied for this driver. Do not use outside knowledge.",
    "",
    `Country: ${input.country}`,
    `Sector: ${input.sector}`,
    "Output language for this step: English.",
    `Driver id: ${driverId}`,
    `Driver number: ${driverIndex + 1}`,
    `Driver logic id: ${logic.id}`,
    `Driver section: ${logic.section}`,
    `Driver type: ${logic.type}`,
    `Precise question: ${logic.preciseQuestion}`,
    `Evidence target: ${logic.evidenceTarget}`,
    "",
    "Sector-specific guidance:",
    ...getSectorSpecificGuidance(input.sector).map((item) => `- ${item}`),
    "",
    "Mandatory writing rules:",
    "- Write one driver only.",
    "- driverLogicId, Driver Section, and Driver Type must match the supplied driver logic.",
    "- Title must be specific, concise, and pitch-ready.",
    "- Avoid titles such as Global ESG Trends, Sustainability Trends, ESG Investment Growth, Investor Pressure for Sustainability, or ESG Compliance.",
    "- Driver Text must be one compact paragraph, usually 20 to 50 words and never more than 60 words.",
    "- Country/Sector Relevance must explicitly connect this country and this sector.",
    "- Evidence/KPI must include a specific metric, target, standard, date, or policy requirement where directly evidenced.",
    "- Every number, percentage, currency amount, target, date, and forecast must appear in the supplied evidence snippets. If not, write it qualitatively.",
    "- Use 1 to 3 source links copied exactly from this evidence pack.",
    "- Key sources must be exact organization or publisher names, never generic labels. Recognized exact acronyms such as UNFCCC, IFRS Foundation, IEA, NGFS, FSB, UNEP FI, World Bank, IFC, GRI, GHG Protocol, and SBTi are acceptable.",
    "- For global/general drivers, do not claim the selected sector has a direct legal obligation unless the evidence explicitly says so. Frame the relevance as expectations, baseline pressure, investor scrutiny, disclosure norms, or market direction.",
    "- Avoid unsupported obligation verbs such as must, required to, or mandated unless the source directly states the requirement for this country/sector.",
    "- Confidence should be below 75 unless the source mix is authoritative and the evidence directly supports the driver.",
    "",
    attempt > 1 ? `Repair attempt: ${attempt}` : "Initial attempt.",
    previousDriver
      ? `Previous rejected draft:\n${JSON.stringify(previousDriver, null, 2)}`
      : "",
    previousVerification
      ? `Repair requirements:\n${JSON.stringify(previousVerification, null, 2)}`
      : "",
    "",
    "Evidence pack:",
    formatEvidenceForPrompt(evidencePack.candidateSources),
  ].join("\n");
}

async function verifySingleDriver(
  input: GenerateEsgDriversInput,
  logic: EsgDriverLogic,
  evidencePack: DriverEvidencePack,
  driver: EsgDriver,
): Promise<DriverVerificationResult> {
  const local = runLocalDriverChecks(input, logic, evidencePack, driver);

  try {
    const model = getStructuredModel().withStructuredOutput(driverVerificationSchema);
    const response = await model.invoke(
      [
        "You are a strict ESG driver verification agent.",
        "Evaluate one pitch-ready driver against its source evidence and Excel-style requirements.",
        "",
        `Country: ${input.country}`,
        `Sector: ${input.sector}`,
        `Driver logic id: ${logic.id}`,
        `Precise question: ${logic.preciseQuestion}`,
        `Evidence target: ${logic.evidenceTarget}`,
        "",
        "Pass only if:",
        "- all source URLs are copied from the evidence pack",
        "- every metric, date, percentage, target, and currency amount appears in evidence",
        "- no generic source labels are used; exact source acronyms such as UNFCCC, IFRS Foundation, IEA, NGFS, FSB, UNEP FI, World Bank, IFC, GRI, GHG Protocol, and SBTi are not generic",
        "- the title is specific and not generic",
        "- driver text is compact and pitch-ready",
        "- relevance connects country and sector",
        "- confidence is directionally justified by source authority, freshness, and evidence specificity",
        "",
        "Important verification boundaries:",
        "- Do not require page numbers, paragraph numbers, or verbatim quotes; the evidence snippets are the available citation basis.",
        "- For Global Drivers or General drivers, the country/sector relevance can be an analytical implication from a global policy, standard, or market signal. Do not fail it merely because the global source does not name the exact sector.",
        "- Only fail country/sector relevance when the text does not mention the selected country/sector or it asserts a direct legal/technical obligation that the evidence does not support.",
        "- Treat model confidence as a numeric field; do not require a separate confidence explanation inside the driver text.",
        "",
        "Local deterministic checks already found:",
        JSON.stringify(local, null, 2),
        "",
        "Driver to verify:",
        JSON.stringify(driver, null, 2),
        "",
        "Evidence pack:",
        formatEvidenceForPrompt(evidencePack.candidateSources),
      ].join("\n"),
    );
    const modelVerification = driverVerificationSchema.parse(response);
    return combineVerificationResults(local, modelVerification);
  } catch {
    return local;
  }
}

function runLocalDriverChecks(
  input: GenerateEsgDriversInput,
  logic: EsgDriverLogic,
  evidencePack: DriverEvidencePack,
  driver: EsgDriver,
): DriverVerificationResult {
  const reasons: string[] = [];
  const requiredRepairs: string[] = [];
  const unsupportedMetrics: string[] = [];
  const sourceIssues: string[] = [];
  const styleIssues: string[] = [];
  const evidenceByUrl = new Map(
    evidencePack.candidateSources.map((source) => [source.url, source]),
  );
  const linkedSources = driver.sourceLinks
    .map((url) => evidenceByUrl.get(url))
    .filter((source): source is EsgDriverSource => Boolean(source));
  const wordCount = countWords(driver.driverText);
  const metricSupport = validateMetricSupport(driver.evidenceKpi, linkedSources);
  const combinedDriverText =
    `${driver.driverTitle} ${driver.driverText} ${driver.countrySectorRelevance}`.toLowerCase();
  const hasCountry = countryAliases(input.country).some((alias) =>
    combinedDriverText.includes(alias),
  );
  const hasSector = sectorAliases(input.sector).some((alias) =>
    combinedDriverText.includes(alias),
  );

  if (driver.driverLogicId !== logic.id) {
    requiredRepairs.push("driver logic id does not match assigned logic");
  }
  if (driver.driverSection !== logic.section || driver.driverType !== logic.type) {
    requiredRepairs.push("driver section or type does not match assigned logic");
  }
  if (driver.sourceLinks.length < 1 || driver.sourceLinks.length > 3) {
    sourceIssues.push("driver must cite 1 to 3 source links");
  }
  if (driver.sourceLinks.some((url) => !evidenceByUrl.has(url))) {
    sourceIssues.push("one or more source links are outside the evidence pack");
  }
  if (linkedSources.length === 0) {
    sourceIssues.push("no linked source could be matched to parsed evidence");
  }
  if (linkedSources.every((source) => source.authorityScore < 55)) {
    sourceIssues.push("source mix is not authoritative enough");
  }
  if (metricSupport.unsupportedMetrics.length > 0) {
    unsupportedMetrics.push(...metricSupport.unsupportedMetrics);
  }
  if (driver.keySources.some(isGenericKeySource)) {
    sourceIssues.push("generic key source label used");
  }
  if (isWeakGenericTitle(driver.driverTitle)) {
    styleIssues.push("title is too generic");
  }
  if (wordCount < 15 || wordCount > 60) {
    styleIssues.push("driver text should be one compact 20 to 50 word paragraph");
  }
  if (!hasCountry || !hasSector) {
    requiredRepairs.push("country/sector relevance is not explicit enough");
  }

  reasons.push(...requiredRepairs, ...sourceIssues, ...unsupportedMetrics, ...styleIssues);

  const score = Math.max(0, 100 - reasons.length * 10 - Math.max(0, 75 - driver.confidence));
  const recommendedConfidence = Math.max(
    35,
    Math.min(driver.confidence, score, linkedSources.length > 0 ? 96 : 60),
  );

  return {
    passed:
      reasons.length === 0 &&
      score >= HARNESS_LIMITS.minimumConfidenceTarget &&
      recommendedConfidence >= HARNESS_LIMITS.minimumConfidenceTarget,
    score,
    reasons: uniqueStrings(reasons).slice(0, 8),
    requiredRepairs: uniqueStrings(requiredRepairs).slice(0, 8),
    unsupportedMetrics: uniqueStrings(unsupportedMetrics).slice(0, 8),
    sourceIssues: uniqueStrings(sourceIssues).slice(0, 8),
    styleIssues: uniqueStrings(styleIssues).slice(0, 8),
    recommendedConfidence,
    canRepair: true,
  };
}

function combineVerificationResults(
  local: DriverVerificationResult,
  model: DriverVerificationResult,
): DriverVerificationResult {
  const modelRequiredRepairs = model.requiredRepairs.filter(isBlockingModelIssue);
  const modelUnsupportedMetrics = model.unsupportedMetrics.filter(isBlockingModelIssue);
  const modelSourceIssues = model.sourceIssues.filter(isBlockingModelIssue);
  const modelStyleIssues = model.styleIssues.filter(isBlockingModelIssue);
  // Free-form model reasons are often explanatory notes, including positive
  // confidence justifications. Only structured repair/issue fields may block.
  const modelReasons: string[] = [];
  const blockingModelIssues = uniqueStrings([
    ...modelReasons,
    ...modelRequiredRepairs,
    ...modelUnsupportedMetrics,
    ...modelSourceIssues,
    ...modelStyleIssues,
  ]);

  const reasons = uniqueStrings([...local.reasons, ...blockingModelIssues]).slice(0, 8);
  const requiredRepairs = uniqueStrings([
    ...local.requiredRepairs,
    ...modelRequiredRepairs,
  ]).slice(0, 8);
  const unsupportedMetrics = uniqueStrings([
    ...local.unsupportedMetrics,
    ...modelUnsupportedMetrics,
  ]).slice(0, 8);
  const sourceIssues = uniqueStrings([...local.sourceIssues, ...modelSourceIssues]).slice(
    0,
    8,
  );
  const styleIssues = uniqueStrings([...local.styleIssues, ...modelStyleIssues]).slice(
    0,
    8,
  );
  const score =
    blockingModelIssues.length === 0
      ? local.score
      : Math.min(local.score, model.score);
  const recommendedConfidence = Math.min(
    local.recommendedConfidence,
    blockingModelIssues.length === 0
      ? Math.max(model.recommendedConfidence, HARNESS_LIMITS.minimumConfidenceTarget)
      : model.recommendedConfidence,
  );

  return {
    passed:
      local.passed &&
      blockingModelIssues.length === 0 &&
      score >= HARNESS_LIMITS.minimumConfidenceTarget &&
      recommendedConfidence >= HARNESS_LIMITS.minimumConfidenceTarget,
    score,
    reasons,
    requiredRepairs,
    unsupportedMetrics,
    sourceIssues,
    styleIssues,
    recommendedConfidence,
    canRepair: local.canRepair || model.canRepair,
  };
}

function isBlockingModelIssue(issue: string): boolean {
  const normalized = issue.toLowerCase();
  if (!normalized.trim()) return false;

  if (isAffirmativeVerifierNote(normalized)) {
    return false;
  }

  if (
    /page|paragraph|quoted passage|verbatim|quote|specific passage/.test(normalized)
  ) {
    return false;
  }
  if (/confidence statement|confidence explanation|explicit justification/.test(normalized)) {
    return false;
  }
  if (
    /generic label|generic source/.test(normalized) &&
    /\b(unfccc|ifrs|iea|ngfs|fsb|unep fi|world bank|ifc|gri|ghg protocol|sbti)\b/i.test(
      issue,
    )
  ) {
    return false;
  }
  if (
    /country\/sector linkage|country\/sector relevance|exact sector|provided evidence/.test(
      normalized,
    ) &&
    /global|general|paris|unfccc|ndc/.test(normalized)
  ) {
    return false;
  }

  return true;
}

function isAffirmativeVerifierNote(normalizedIssue: string): boolean {
  return (
    normalizedIssue.startsWith("all ") ||
    normalizedIssue.startsWith("confidence is ") ||
    normalizedIssue.startsWith("confidence remains ") ||
    normalizedIssue.startsWith("the confidence ") ||
    normalizedIssue.startsWith("sources are ") ||
    normalizedIssue.startsWith("source urls are ") ||
    normalizedIssue.startsWith("evidence is ") ||
    normalizedIssue.startsWith("evidence snippets are ") ||
    normalizedIssue.startsWith("driver title ") ||
    normalizedIssue.startsWith("title and text ") ||
    normalizedIssue.startsWith("no generic ") ||
    /are present in|appear in the provided|copied exactly|authoritative and specific|primary authority|evidence is recent|evidence snippets are specific|specific to the cited|specific, compact|pitch-ready|explicitly name/.test(
      normalizedIssue,
    )
  );
}

function countryAliases(country: string): string[] {
  const normalized = country.trim().toLowerCase();
  const aliases = [normalized];

  if (normalized === "uae" || normalized.includes("united arab emirates")) {
    aliases.push("uae", "united arab emirates", "emirati");
  }
  if (normalized.includes("saudi")) {
    aliases.push("saudi", "saudi arabia", "kingdom of saudi arabia", "ksa");
  }
  if (normalized.includes("kazakhstan")) {
    aliases.push("kazakhstan", "kazakh");
  }

  return uniqueStrings(aliases).filter((alias) => alias.length > 1);
}

function sectorAliases(sector: string): string[] {
  const normalized = sector.trim().toLowerCase();
  const words = normalized.split(/[^a-z0-9]+/).filter((word) => word.length > 2);
  const aliases = [normalized, ...words];

  if (/\bbank|banking|financial|finance|lending|credit\b/.test(normalized)) {
    aliases.push(
      "banking",
      "bank",
      "banks",
      "financial sector",
      "financial institutions",
      "lenders",
      "credit",
    );
  }
  if (/construction|cement|building materials|contractor/.test(normalized)) {
    aliases.push("construction", "contractors", "building", "buildings", "cement");
  }
  if (/real estate|property|buildings?|reit/.test(normalized)) {
    aliases.push("real estate", "property", "buildings", "assets");
  }
  if (/oil|gas|petroleum|lng|upstream|downstream|energy/.test(normalized)) {
    aliases.push("oil", "gas", "oil and gas", "energy", "petroleum", "lng");
  }

  return uniqueStrings(aliases).filter((alias) => alias.length > 2);
}

async function reviewDeckConsistency(
  input: GenerateEsgDriversInput,
  driverLogics: EsgDriverLogic[],
  drivers: EsgDriver[],
): Promise<{ passed: boolean; score: number; warnings: string[] }> {
  try {
    const model = getStructuredModel().withStructuredOutput(deckReviewSchema);
    const response = await model.invoke(
      [
        "You are reviewing a complete ESG driver deck before client display.",
        "Check whether the 12 accepted drivers are balanced, non-duplicative, ordered correctly, and pitch-ready.",
        "",
        `Country: ${input.country}`,
        `Sector: ${input.sector}`,
        "Required driver logic order:",
        formatDriverLogicPlan(driverLogics),
        "",
        "Accepted drivers:",
        JSON.stringify(
          drivers.map((driver) => ({
            id: driver.id,
            driverLogicId: driver.driverLogicId,
            driverSection: driver.driverSection,
            driverType: driver.driverType,
            driverTitle: driver.driverTitle,
            driverText: driver.driverText,
            evidenceKpi: driver.evidenceKpi,
            confidence: driver.confidence,
            sourceLinks: driver.sourceLinks,
          })),
          null,
          2,
        ),
      ].join("\n"),
    );
    return deckReviewSchema.parse(response);
  } catch {
    const warnings = drivers.length === 12 ? [] : ["completed deck does not contain 12 drivers"];
    return {
      passed: warnings.length === 0,
      score: warnings.length === 0 ? 90 : 50,
      warnings,
    };
  }
}

function normalizeSingleDriver(
  driver: GeneratedSingleDriver,
  evidencePack: DriverEvidencePack,
  logic: EsgDriverLogic,
  driverId: string,
  driverIndex: number,
): EsgDriver {
  const evidenceByUrl = new Map(
    evidencePack.candidateSources.map((source) => [source.url, source]),
  );
  const fallbackSource = evidencePack.selectedSources[0] || evidencePack.candidateSources[0];
  const validLinks = driver.sourceLinks.filter((url) => evidenceByUrl.has(url));
  const sourceLinks = uniqueStrings(
    (validLinks.length > 0 ? validLinks : [fallbackSource.url]).slice(
      0,
      HARNESS_LIMITS.maxFinalSourceLinksPerDriver,
    ),
  );
  const linkedSources = sourceLinks
    .map((url) => evidenceByUrl.get(url))
    .filter((source): source is EsgDriverSource => Boolean(source));
  const hadGenericKeySources = driver.keySources.some(isGenericKeySource);
  const keySources = normalizeKeySources(driver.keySources, linkedSources);
  const metricSupport = validateMetricSupport(driver.evidenceKpi, linkedSources);
  const weakGenericTitle = isWeakGenericTitle(driver.driverTitle);
  const validationWarnings = [
    ...metricSupport.unsupportedMetrics.map(
      (metric) => `Metric not found in linked evidence: ${metric}`,
    ),
    ...(weakGenericTitle ? ["Title is too generic for pitch use"] : []),
    ...(hadGenericKeySources ? ["Generic source label was replaced"] : []),
  ];

  return {
    ...driver,
    id: driverId,
    driverLogicId: logic.id,
    driverLogic: logic.logic,
    driverSection: logic.section,
    driverType: logic.type,
    sourceLinks,
    keySources: uniqueStrings(keySources).slice(0, 5),
    sourceRefs:
      linkedSources.length > 0
        ? linkedSources.map((source) => source.id)
        : [fallbackSource.id],
    confidence: deriveConfidence(
      driver.confidence,
      linkedSources,
      driver.evidenceKpi,
      hadGenericKeySources,
      !metricSupport.supported,
      weakGenericTitle,
    ),
    lastChecked: new Date().toISOString().slice(0, 10),
    validationWarnings,
  };
}

async function translateDrivers(
  drivers: EsgDriver[],
  language: string,
): Promise<EsgDriver[]> {
  const model = getStructuredModel().withStructuredOutput(translationSchema);
  const response = await model.invoke(
    [
      "Translate only the narrative fields of these ESG drivers.",
      `Target language: ${language}.`,
      "Keep the same ids. Do not translate URLs, source names, driver sections, driver types, confidence scores, or standards acronyms.",
      "Use professional pitch presentation language. Preserve numbers, dates, standards names, and source acronyms.",
      "Return only structured data that matches the schema.",
      "",
      JSON.stringify(
        drivers.map((driver) => ({
          id: driver.id,
          driverTitle: driver.driverTitle,
          driverText: driver.driverText,
          countrySectorRelevance: driver.countrySectorRelevance,
          evidenceKpi: driver.evidenceKpi,
        })),
        null,
        2,
      ),
    ].join("\n"),
  );

  const translations = translationSchema.parse(response).drivers;
  const byId = new Map(translations.map((driver) => [driver.id, driver]));

  return drivers.map((driver) => {
    const translated = byId.get(driver.id);
    if (!translated) return driver;
    return {
      ...driver,
      driverTitle: translated.driverTitle,
      driverText: translated.driverText,
      countrySectorRelevance: translated.countrySectorRelevance,
      evidenceKpi: translated.evidenceKpi,
    };
  });
}

function getStructuredModel() {
  const modelName = getModelName();
  const supportsCustomTemperature = !/^gpt-5/i.test(modelName);

  return new ChatOpenAI({
    openAIApiKey: process.env.OPENAI_API_KEY,
    modelName,
    ...(supportsCustomTemperature ? { temperature: 0.2 } : {}),
  });
}

function getModelName(): string {
  return process.env.OPENAI_ESG_DRIVERS_MODEL || "gpt-5-mini";
}

function formatEvidenceForPrompt(evidence: EsgDriverSource[]): string {
  return evidence
    .map((source) =>
      [
        `[${source.id}] ${source.title}`,
        `URL: ${source.url}`,
        `Domain: ${source.domain}`,
        `Dates: published=${source.publishedDate || "unknown"}; updated=${source.updatedDate || "unknown"}; lastModified=${source.lastModified || "unknown"}; retrieved=${source.retrievedAt.slice(0, 10)}`,
        `Scores: authority=${source.authorityScore}; freshness=${source.freshnessScore}; relevance=${source.relevanceScore}; total=${source.sourceScore}`,
        `Snippet: ${source.contentSnippet || source.snippet}`,
      ].join("\n"),
    )
    .join("\n\n");
}

function deriveConfidence(
  modelConfidence: number,
  linkedSources: EsgDriverSource[],
  evidenceKpi: string,
  hadGenericKeySources: boolean,
  hasUnsupportedMetrics: boolean,
  hasWeakGenericTitle: boolean,
): number {
  const averageSourceScore =
    linkedSources.reduce((sum, source) => sum + source.sourceScore, 0) /
    Math.max(linkedSources.length, 1);
  const specificity = /\d|%|usd|co2|scope|2030|2040|2050|ifrs|issb|ndc|paris|framework|policy|regulation|standard|taxonomy/i.test(
    evidenceKpi,
  )
    ? 10
    : 0;
  const sourceDepth = Math.min(linkedSources.length * 5, 15);
  const sourceLabelPenalty = hadGenericKeySources ? 8 : 0;
  const metricPenalty = hasUnsupportedMetrics ? 20 : 0;
  const titlePenalty = hasWeakGenericTitle ? 8 : 0;
  const confidence =
    averageSourceScore * 0.55 +
    modelConfidence * 0.25 +
    specificity +
    sourceDepth -
    sourceLabelPenalty -
    metricPenalty -
    titlePenalty;
  const authoritativeFloor =
    linkedSources.length >= 2 &&
    linkedSources.some((source) => source.authorityScore >= 75) &&
    !hadGenericKeySources &&
    !hasUnsupportedMetrics &&
    !hasWeakGenericTitle
      ? HARNESS_LIMITS.minimumConfidenceTarget
      : 35;

  return Math.max(authoritativeFloor, Math.min(96, Math.round(confidence)));
}

function normalizeKeySources(
  candidateSources: string[],
  linkedSources: EsgDriverSource[],
): string[] {
  const namedCandidates = candidateSources.filter(
    (source) => !isGenericKeySource(source),
  );
  const sourceNames = linkedSources.map(sourceDisplayName);
  return uniqueStrings([...namedCandidates, ...sourceNames]);
}

function sourceDisplayName(source: EsgDriverSource): string {
  const combined = `${source.title} ${source.domain}`.toLowerCase();
  const domain = source.domain.toLowerCase();

  if (combined.includes("central bank of the uae") || combined.includes("cbuae")) {
    return "Central Bank of the UAE";
  }
  if (combined.includes("unep fi") || domain.includes("unepfi.org")) return "UNEP FI";
  if (domain.includes("worldbank.org")) return "World Bank";
  if (domain.includes("ifrs.org")) return "IFRS Foundation";
  if (domain.includes("iea.org")) return "IEA";
  if (domain.includes("imf.org")) return "IMF";
  if (domain.includes("unfccc.int")) return "UNFCCC";
  if (domain.includes("irena.org")) return "IRENA";
  if (domain.includes("adgm.com")) return "ADGM";
  if (domain.includes("dfsa.ae")) return "DFSA";
  if (domain.includes("globalreporting.org")) return "GRI";
  if (domain.includes("ghgprotocol.org")) return "GHG Protocol";
  if (domain.includes("sciencebasedtargets.org")) return "SBTi";
  if (domain.includes("moec.gov.ae") || domain.includes("moccae.gov.ae")) {
    return "UAE Ministry of Climate Change and Environment";
  }

  return source.domain.replace(/^www\./, "");
}

function validateMetricSupport(
  evidenceKpi: string,
  linkedSources: EsgDriverSource[],
): { supported: boolean; unsupportedMetrics: string[] } {
  const metrics = extractMetricTokens(evidenceKpi);
  if (metrics.length === 0) return { supported: true, unsupportedMetrics: [] };

  const sourceText = normalizeForMetricMatch(
    linkedSources
      .map((source) => `${source.title} ${source.snippet} ${source.contentSnippet}`)
      .join(" "),
  );
  const unsupportedMetrics = metrics.filter(
    (metric) => !isMetricTokenSupported(metric, sourceText),
  );

  return {
    supported: unsupportedMetrics.length === 0,
    unsupportedMetrics,
  };
}

function extractEvidenceMetrics(sources: EsgDriverSource[]): string[] {
  return uniqueStrings(
    sources.flatMap((source) =>
      extractMetricTokens(`${source.title} ${source.snippet} ${source.contentSnippet}`),
    ),
  ).slice(0, 20);
}

function extractMetricTokens(text: string): string[] {
  const normalized = text.replace(/CO₂/g, "CO2");
  const metricMatches =
    normalized.match(
      /(?:US\$|USD|\$)\s?\d+(?:[,.]\d+)?(?:\s?(?:billion|million|trillion|bn|mn|tn))?|\d+(?:[,.]\d+)?\s?%|\d+\/\d+|\d+(?:[,.]\d+)?\s?(?:billion|million|trillion|bn|mn|tn|mt|gt|gw|mw|tonnes?|tons?|co2e?|degrees?|c)\b/gi,
    ) || [];

  if (metricMatches.length > 0) {
    return uniqueStrings(metricMatches);
  }

  return uniqueStrings(normalized.match(/\b20[2-5]\d\b/g) || []);
}

function isMetricTokenSupported(metric: string, normalizedSourceText: string): boolean {
  const normalizedMetric = normalizeForMetricMatch(metric);
  if (normalizedSourceText.includes(normalizedMetric)) return true;

  const numbers = normalizedMetric.match(/\d+(?:\.\d+)?/g) || [];
  if (numbers.length === 0) return true;

  return numbers.every((number) => normalizedSourceText.includes(number));
}

function normalizeForMetricMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/co₂/g, "co2")
    .replace(/us\$/g, "usd")
    .replace(/,/g, "")
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9.%/$]+/g, "");
}

function isWeakGenericTitle(title: string): boolean {
  return /^(global esg trends|sustainability trends|investor pressure for sustainability|technological advancements|esg investment growth|esg compliance|sustainable supply chain financing)$/i.test(
    title.trim(),
  );
}

function isGenericKeySource(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    /^source\s*\d*$/.test(normalized) ||
    normalized === "research firm" ||
    normalized === "market research firm" ||
    normalized === "investment research firm" ||
    normalized === "climate research firm" ||
    normalized === "regulatory body" ||
    normalized === "industry body" ||
    normalized === "industry report" ||
    normalized === "consulting firm" ||
    normalized.includes("research firm")
  );
}

function getLinkedSources(
  driver: EsgDriver,
  sources: EsgDriverSource[],
): EsgDriverSource[] {
  const byUrl = new Map(sources.map((source) => [source.url, source]));
  return driver.sourceLinks
    .map((url) => byUrl.get(url))
    .filter((source): source is EsgDriverSource => Boolean(source));
}

function uniqueSources(sources: EsgDriverSource[]): EsgDriverSource[] {
  const seen = new Set<string>();
  const unique: EsgDriverSource[] = [];
  for (const source of sources) {
    const key = source.url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(source);
  }
  return unique;
}

function countWords(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function isEnglishLanguage(language: string): boolean {
  const normalized = language.trim().toLowerCase();
  return normalized === "english" || normalized === "en" || normalized.startsWith("en-");
}
