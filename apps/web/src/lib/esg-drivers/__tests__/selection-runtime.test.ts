import { describe, expect, it, vi } from "vitest";
import type {
  DriverArchetype,
  DriverSelectionPlan,
  DriverSlot,
  RankedDriverCandidate,
} from "../catalog/types";
import {
  buildEsgDriverCheckpoint,
  preflightNextVerifiedSlotCandidate,
  preflightSelectionCandidates,
  reservedPrimaryCandidateIds,
  restoreCheckpointCandidateAttempts,
  verifiedSlotCandidateQueue,
} from "../selection-runtime";
import type {
  EsgDriverCandidateTrace,
  EsgDriverCheckpointSlotState,
} from "../types";

function candidate(
  id: string,
  section: DriverArchetype["section"],
  order: number,
): RankedDriverCandidate {
  const archetype: DriverArchetype = {
    id,
    catalogOrder: order,
    origin: "master",
    sourceSheet: "Mastersheet",
    sourceRow: order + 2,
    specialistLibrary: null,
    activeForSectors: [],
    section,
    type: "General",
    name: id,
    countryScopes: ["All"],
    sectorScopes: ["All"],
    sectorFamilies: ["All"],
    logic: `Logic ${id}`,
    preciseQuestion: `Question ${id}`,
    evidenceTarget: `Evidence ${id}`,
    exampleGuidance: "",
    keyPublishers: ["Example"],
    workbookUrls: [`https://example.com/${id}`],
    seedUrls: [`https://example.com/${id}`],
    guidanceOnlyUrls: [],
    sourceStatus: "reviewed-seed",
    document: null,
    evidenceCategory: "other",
    registryLogicIds: [],
  };
  return {
    id,
    archetypeId: id,
    score: 100 - order,
    scoreBreakdown: {
      countryFit: 0,
      sectorFit: 0,
      specialistFit: 0,
      directSourceAvailability: 0,
      evidenceSpecificity: 0,
      freshness: 0,
      typeBalance: 0,
      duplicationRisk: 0,
    },
    scoreReasons: [],
    sourceStatus: "reviewed-seed",
    seedUrls: archetype.seedUrls,
    registryLogicIds: [],
    archetype,
  };
}

function slot(
  driverNumber: number,
  section: DriverSlot["section"],
  candidates: RankedDriverCandidate[],
): DriverSlot {
  return {
    id: `slot-${driverNumber}`,
    driverId: `D${driverNumber}`,
    driverNumber,
    section,
    candidateQueue: candidates,
  };
}

function plan(maxCandidatePreflights = 30): DriverSelectionPlan {
  const global = Array.from({ length: 6 }, (_, index) =>
    candidate(`global-${index + 1}`, "Global Drivers", index),
  );
  const regulatory = Array.from({ length: 4 }, (_, index) =>
    candidate(
      `regulatory-${index + 1}`,
      "Regulatory Requirements",
      index + 10,
    ),
  );
  return {
    mode: "catalog",
    catalogVersion: "test-v1",
    input: { country: "UAE", sector: "Banking", language: "English" },
    sectionQuotas: {
      "Global Drivers": 3,
      "Regulatory Requirements": 1,
      "Climate Risks": 0,
      "Capital Markets": 0,
      "Supply Chain": 0,
    },
    backupTargetPerSection: 2,
    maxCandidatePreflights,
    slots: [
      slot(1, "Global Drivers", global),
      slot(2, "Global Drivers", global),
      slot(3, "Global Drivers", global),
      slot(4, "Regulatory Requirements", regulatory),
    ],
  };
}

describe("catalog candidate preflight runtime", () => {
  it("preflights required coverage breadth-first without spending calls on backups", async () => {
    const runCandidate = vi.fn(async () => ({ verified: true, value: "evidence" }));
    const result = await preflightSelectionCandidates({
      plan: plan(6),
      runCandidate,
    });

    expect(result.attemptedCandidateIds).toEqual([
      "global-1",
      "regulatory-1",
      "global-2",
      "global-3",
    ]);
    expect(runCandidate).toHaveBeenCalledTimes(4);
    expect(result.cache.size).toBe(4);
  });

  it("reuses the cache for every slot and excludes an already accepted candidate", async () => {
    const selectionPlan = plan();
    const result = await preflightSelectionCandidates({
      plan: selectionPlan,
      runCandidate: async () => ({ verified: true, value: "cached" }),
    });
    const queue = verifiedSlotCandidateQueue(
      selectionPlan.slots[1],
      result.cache,
      new Set(["global-1"]),
    );

    expect(queue.map((item) => item.id).slice(0, 2)).toEqual([
      "global-2",
      "global-3",
    ]);
  });

  it("stops preflight at a global budget error and preserves verified cache entries", async () => {
    const budgetError = new Error("source request budget was exhausted");
    const runCandidate = vi.fn(async (item: RankedDriverCandidate) => {
      if (item.id === "global-3") throw budgetError;
      return { verified: true, value: `evidence:${item.id}` };
    });

    const result = await preflightSelectionCandidates({
      plan: plan(),
      runCandidate,
      shouldStop: (error) => error === budgetError,
    });

    expect(result.stoppedEarly).toBe(true);
    expect(result.stopReason).toContain("budget was exhausted");
    expect(result.attemptedCandidateIds).toEqual([
      "global-1",
      "regulatory-1",
      "global-2",
      "global-3",
    ]);
    expect(result.verifiedCandidateIds).toEqual([
      "global-1",
      "regulatory-1",
      "global-2",
    ]);
    expect(result.cache.size).toBe(3);
    expect(runCandidate).toHaveBeenCalledTimes(4);
  });

  it("preflights ranked same-section fallbacks only when a slot needs one", async () => {
    const selectionPlan = plan();
    const cache = new Map();
    const attemptedCandidateIds = [
      "global-1",
      "global-2",
      "global-3",
      "regulatory-1",
    ];
    const verifiedCandidateIds = [...attemptedCandidateIds];
    const runCandidate = vi.fn(async (item: RankedDriverCandidate) => ({
      verified: item.id === "global-5",
      value: item.id === "global-5" ? "fallback evidence" : undefined,
      rejectionReason: item.id === "global-5" ? undefined : "stale source",
    }));

    const result = await preflightNextVerifiedSlotCandidate({
      slot: selectionPlan.slots[0],
      cache,
      attemptedCandidateIds,
      verifiedCandidateIds,
      maxCandidatePreflights: 30,
      runCandidate,
    });

    expect(result.candidate?.id).toBe("global-5");
    expect(result.attempted.map((item) => item.candidate.id)).toEqual([
      "global-4",
      "global-5",
    ]);
    expect(runCandidate).toHaveBeenCalledTimes(2);
  });

  it("reserves other same-section slot primaries while an earlier slot falls back", () => {
    const global1 = candidate("global-1", "Global Drivers", 1);
    const global2 = candidate("global-2", "Global Drivers", 2);
    const global3 = candidate("global-3", "Global Drivers", 3);
    const global4 = candidate("global-4", "Global Drivers", 4);
    const regulatory1 = candidate(
      "regulatory-1",
      "Regulatory Requirements",
      5,
    );
    const slots = [
      slot(1, "Global Drivers", [global1, global2, global3, global4]),
      slot(2, "Global Drivers", [global2, global1, global3, global4]),
      slot(3, "Global Drivers", [global3, global1, global2, global4]),
      slot(4, "Regulatory Requirements", [regulatory1]),
    ];
    const selectionPlan = { ...plan(), slots };

    expect(
      Array.from(reservedPrimaryCandidateIds(selectionPlan, slots[0])).sort(),
    ).toEqual(["global-2", "global-3"]);
    expect(
      Array.from(reservedPrimaryCandidateIds(selectionPlan, slots[3])),
    ).toEqual([]);
  });
});

describe("ESG driver checkpoint derivation", () => {
  it("stores canonical accepted slots and explicit exhausted-slot failures", () => {
    const selectionPlan = plan();
    const accepted: EsgDriverCheckpointSlotState = {
      slotId: "slot-1",
      driverId: "D1",
      candidateId: "global-1",
      status: "accepted",
      attemptedCandidateIds: ["global-1"],
      driver: {
        id: "D1",
        driverSection: "Global Drivers",
        driverType: "General",
        driverTitle: "Approved driver",
        driverText: "Approved evidence-grounded ESG driver narrative.",
        countrySectorRelevance: "Relevant to UAE banking.",
        evidenceKpi: "Official framework",
        keySources: ["Example"],
        sourceLinks: ["https://example.com/global-1"],
        confidence: 90,
        lastChecked: "2026-07-14",
        sourceRefs: ["D1-S1"],
      },
      evidencePack: {
        driverId: "D1",
        driverLogicId: "global-1",
        queries: [],
        candidateSources: [],
        selectedSources: [],
        rejectedSources: [],
        extractedMetrics: [],
        evidenceSummary: "Verified evidence.",
      },
    };
    const exhausted: EsgDriverCheckpointSlotState = {
      slotId: "slot-2",
      driverId: "D2",
      candidateId: "",
      status: "exhausted",
      attemptedCandidateIds: ["global-2", "global-3"],
      failure: {
        driverId: "D2",
        driverNumber: 2,
        originalDriverLogicId: "global-2",
        attemptedDriverLogicIds: ["global-2", "global-3"],
        reasons: ["No approved direct evidence"],
        createdAt: "2026-07-14T00:00:00.000Z",
      },
    };

    const checkpoint = buildEsgDriverCheckpoint({
      catalogVersion: "test-v1",
      selectionPlan,
      slotStates: [exhausted, accepted],
    });

    expect(checkpoint.canonicalDrivers.map((driver) => driver.id)).toEqual(["D1"]);
    expect(checkpoint.completedSlotIds).toEqual(["slot-1", "slot-2"]);
    expect(checkpoint.failedSlots.map((failure) => failure.driverId)).toEqual(["D2"]);
    expect(checkpoint.attemptedCandidateIds).toEqual([
      "global-1",
      "global-2",
      "global-3",
    ]);
  });

  it("round-trips candidate trace history while accepting legacy checkpoints", () => {
    const selectionPlan = plan();
    const candidateAttempt: EsgDriverCandidateTrace = {
      slotId: "slot-1",
      driverId: "D1",
      candidateId: "global-1",
      score: 97,
      scoreReasons: ["exact country fit"],
      sourceStatus: "reviewed-seed",
      attempts: 2,
      status: "rejected",
      rejectionReason: "fresh semantic verification rejected the claim",
      createdAt: "2026-07-14T00:00:00.000Z",
    };
    const checkpoint = buildEsgDriverCheckpoint({
      catalogVersion: "test-v1",
      selectionPlan,
      slotStates: [],
      candidateAttempts: [candidateAttempt],
    });

    expect(
      restoreCheckpointCandidateAttempts(checkpoint, selectionPlan.input),
    ).toEqual([candidateAttempt]);
    expect(
      restoreCheckpointCandidateAttempts(
        { ...checkpoint, candidateAttempts: undefined },
        selectionPlan.input,
      ),
    ).toEqual([]);
    expect(
      restoreCheckpointCandidateAttempts(checkpoint, {
        ...selectionPlan.input,
        sector: "Construction",
      }),
    ).toEqual([]);
  });
});
