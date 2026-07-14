import type {
  DriverSelectionPlan,
  DriverSlot,
  RankedDriverCandidate,
} from "./catalog/types";
import type {
  EsgDriverCandidateTrace,
  EsgDriverCheckpoint,
  EsgDriverCheckpointSlotState,
  GenerateEsgDriversInput,
} from "./types";

export interface CandidatePreflightResult<T> {
  candidate: RankedDriverCandidate;
  verified: boolean;
  value?: T;
  rejectionReason?: string;
}

export interface CandidatePreflightRun<T> {
  cache: Map<string, CandidatePreflightResult<T>>;
  attemptedCandidateIds: string[];
  verifiedCandidateIds: string[];
  stoppedEarly: boolean;
  stopReason?: string;
}

/**
 * Preflights a stable, de-duplicated candidate stream breadth-first across
 * sections. The first pass stops at required slot coverage; backups are
 * researched lazily only after a selected candidate fails generation. The
 * shared map is consumed by the per-driver graph, so successful evidence is
 * never fetched twice.
 */
export async function preflightSelectionCandidates<T>(input: {
  plan: DriverSelectionPlan;
  unfinishedSlotIds?: ReadonlySet<string>;
  skipCandidateIds?: ReadonlySet<string>;
  runCandidate: (
    candidate: RankedDriverCandidate,
    slot: DriverSlot,
  ) => Promise<Omit<CandidatePreflightResult<T>, "candidate">>;
  shouldStop?: (error: unknown) => boolean;
  shouldRethrow?: (error: unknown) => boolean;
}): Promise<CandidatePreflightRun<T>> {
  const cache = new Map<string, CandidatePreflightResult<T>>();
  const attemptedCandidateIds: string[] = [];
  const verifiedCandidateIds: string[] = [];
  const unfinishedSlots = input.plan.slots.filter(
    (slot) => !input.unfinishedSlotIds || input.unfinishedSlotIds.has(slot.id),
  );
  const sectionOrder = unique(
    input.plan.slots.map((slot) => slot.section),
  );

  const sectionStates = sectionOrder
    .map((section) => ({
      section,
      target: unfinishedSlots.filter((slot) => slot.section === section).length,
      verified: 0,
      cursor: 0,
      ranked: dedupeSectionCandidates(
        input.plan.slots.filter((slot) => slot.section === section),
      ),
    }))
    .filter((state) => state.target > 0);

  while (attemptedCandidateIds.length < input.plan.maxCandidatePreflights) {
    let attemptedInRound = false;
    for (const state of sectionStates) {
      if (state.verified >= state.target) continue;
      let next: { candidate: RankedDriverCandidate; slot: DriverSlot } | undefined;
      while (state.cursor < state.ranked.length && !next) {
        const candidate = state.ranked[state.cursor++];
        if (!input.skipCandidateIds?.has(candidate.candidate.id)) next = candidate;
      }
      if (!next) continue;
      if (attemptedCandidateIds.length >= input.plan.maxCandidatePreflights) break;

      attemptedInRound = true;
      attemptedCandidateIds.push(next.candidate.id);
      let result: CandidatePreflightResult<T>;
      try {
        const outcome = await input.runCandidate(next.candidate, next.slot);
        result = { candidate: next.candidate, ...outcome };
      } catch (error) {
        if (input.shouldStop?.(error)) {
          return {
            cache,
            attemptedCandidateIds,
            verifiedCandidateIds,
            stoppedEarly: true,
            stopReason: error instanceof Error ? error.message : String(error),
          };
        }
        if (input.shouldRethrow?.(error)) throw error;
        result = {
          candidate: next.candidate,
          verified: false,
          rejectionReason: error instanceof Error ? error.message : String(error),
        };
      }
      cache.set(next.candidate.id, result);
      if (result.verified) {
        state.verified += 1;
        verifiedCandidateIds.push(next.candidate.id);
      }
    }
    if (!attemptedInRound || sectionStates.every((state) => state.verified >= state.target)) {
      break;
    }
  }

  return {
    cache,
    attemptedCandidateIds,
    verifiedCandidateIds,
    stoppedEarly: false,
  };
}

export async function preflightNextVerifiedSlotCandidate<T>(input: {
  slot: DriverSlot;
  cache: Map<string, CandidatePreflightResult<T>>;
  attemptedCandidateIds: string[];
  verifiedCandidateIds: string[];
  maxCandidatePreflights: number;
  skipCandidateIds?: ReadonlySet<string>;
  runCandidate: (
    candidate: RankedDriverCandidate,
    slot: DriverSlot,
  ) => Promise<Omit<CandidatePreflightResult<T>, "candidate">>;
  shouldStop?: (error: unknown) => boolean;
  shouldRethrow?: (error: unknown) => boolean;
}): Promise<{
  candidate: RankedDriverCandidate | null;
  attempted: CandidatePreflightResult<T>[];
  stoppedEarly: boolean;
  stopReason?: string;
}> {
  const attempted: CandidatePreflightResult<T>[] = [];
  const alreadyAttempted = new Set(input.attemptedCandidateIds);

  for (const candidate of input.slot.candidateQueue) {
    if (input.attemptedCandidateIds.length >= input.maxCandidatePreflights) break;
    if (alreadyAttempted.has(candidate.id) || input.skipCandidateIds?.has(candidate.id)) {
      continue;
    }
    alreadyAttempted.add(candidate.id);
    input.attemptedCandidateIds.push(candidate.id);

    let result: CandidatePreflightResult<T>;
    try {
      const outcome = await input.runCandidate(candidate, input.slot);
      result = { candidate, ...outcome };
    } catch (error) {
      if (input.shouldStop?.(error)) {
        return {
          candidate: null,
          attempted,
          stoppedEarly: true,
          stopReason: error instanceof Error ? error.message : String(error),
        };
      }
      if (input.shouldRethrow?.(error)) throw error;
      result = {
        candidate,
        verified: false,
        rejectionReason: error instanceof Error ? error.message : String(error),
      };
    }

    input.cache.set(candidate.id, result);
    attempted.push(result);
    if (result.verified) {
      input.verifiedCandidateIds.push(candidate.id);
      return { candidate, attempted, stoppedEarly: false };
    }
  }

  return { candidate: null, attempted, stoppedEarly: false };
}

export function verifiedSlotCandidateQueue<T>(
  slot: DriverSlot,
  cache: ReadonlyMap<string, CandidatePreflightResult<T>>,
  usedCandidateIds: ReadonlySet<string>,
): RankedDriverCandidate[] {
  return slot.candidateQueue.filter(
    (candidate) =>
      !usedCandidateIds.has(candidate.id) && cache.get(candidate.id)?.verified,
  );
}

/**
 * Keeps a failed early slot from consuming the primary candidate that was
 * selected for another required slot in the same section. The failed slot can
 * still use shared lower-ranked fallbacks, while every required slot retains a
 * fair first attempt at its own primary.
 */
export function reservedPrimaryCandidateIds(
  plan: DriverSelectionPlan,
  currentSlot: DriverSlot,
): Set<string> {
  return new Set(
    plan.slots.flatMap((slot) =>
      slot.id !== currentSlot.id &&
      slot.section === currentSlot.section &&
      slot.candidateQueue[0]
        ? [slot.candidateQueue[0].id]
        : [],
    ),
  );
}

export function selectionCandidateById(
  plan: DriverSelectionPlan,
  candidateId: string,
): RankedDriverCandidate | undefined {
  for (const slot of plan.slots) {
    const candidate = slot.candidateQueue.find((item) => item.id === candidateId);
    if (candidate) return candidate;
  }
  return undefined;
}

export function selectionSlotById(
  plan: DriverSelectionPlan,
  slotId: string,
): DriverSlot | undefined {
  return plan.slots.find((slot) => slot.id === slotId);
}

export function buildEsgDriverCheckpoint(input: {
  catalogVersion: string;
  selectionPlan: DriverSelectionPlan;
  slotStates: EsgDriverCheckpointSlotState[];
  candidateAttempts?: EsgDriverCandidateTrace[];
  resume?: EsgDriverCheckpoint["resume"];
}): EsgDriverCheckpoint {
  const slotOrder = new Map(
    input.selectionPlan.slots.map((slot, index) => [slot.id, index]),
  );
  const slotStates = [...input.slotStates].sort(
    (left, right) =>
      (slotOrder.get(left.slotId) ?? Number.MAX_SAFE_INTEGER) -
      (slotOrder.get(right.slotId) ?? Number.MAX_SAFE_INTEGER),
  );
  const accepted = slotStates.filter(
    (slot) => slot.status === "accepted" && slot.driver && slot.evidencePack,
  );

  return {
    version: 1,
    catalogVersion: input.catalogVersion,
    selectionPlan: input.selectionPlan,
    canonicalDrivers: accepted.flatMap((slot) => (slot.driver ? [slot.driver] : [])),
    evidencePacks: accepted.flatMap((slot) =>
      slot.evidencePack ? [slot.evidencePack] : [],
    ),
    completedSlotIds: slotStates.map((slot) => slot.slotId),
    failedSlots: slotStates.flatMap((slot) =>
      slot.status === "exhausted" && slot.failure ? [slot.failure] : [],
    ),
    attemptedCandidateIds: unique(
      slotStates.flatMap((slot) => slot.attemptedCandidateIds),
    ),
    ...(input.candidateAttempts
      ? {
          candidateAttempts: input.candidateAttempts.map((attempt) => ({
            ...attempt,
            scoreReasons: [...attempt.scoreReasons],
          })),
        }
      : {}),
    slotStates,
    updatedAt: new Date().toISOString(),
    ...(input.resume ? { resume: input.resume } : {}),
  };
}

export function restoreCheckpointCandidateAttempts(
  checkpoint: EsgDriverCheckpoint | undefined,
  request: GenerateEsgDriversInput,
): EsgDriverCandidateTrace[] {
  if (!checkpoint || !checkpointMatchesRequest(checkpoint, request)) return [];
  return (checkpoint.candidateAttempts || []).map((attempt) => ({
    ...attempt,
    scoreReasons: [...attempt.scoreReasons],
  }));
}

export function checkpointMatchesRequest(
  checkpoint: EsgDriverCheckpoint,
  request: GenerateEsgDriversInput,
): boolean {
  return (
    normalize(checkpoint.selectionPlan.input.country) === normalize(request.country) &&
    normalize(checkpoint.selectionPlan.input.sector) === normalize(request.sector) &&
    normalize(checkpoint.selectionPlan.input.language) === normalize(request.language)
  );
}

function dedupeSectionCandidates(
  slots: DriverSlot[],
): Array<{ candidate: RankedDriverCandidate; slot: DriverSlot }> {
  const seen = new Set<string>();
  const result: Array<{ candidate: RankedDriverCandidate; slot: DriverSlot }> = [];

  for (const slot of slots) {
    for (const candidate of slot.candidateQueue) {
      if (seen.has(candidate.id)) continue;
      seen.add(candidate.id);
      result.push({ candidate, slot });
    }
  }

  result.sort((left, right) => {
    if (right.candidate.score !== left.candidate.score) {
      return right.candidate.score - left.candidate.score;
    }
    const orderDelta =
      left.candidate.archetype.catalogOrder -
      right.candidate.archetype.catalogOrder;
    return orderDelta || left.candidate.id.localeCompare(right.candidate.id);
  });
  return result;
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}
