import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const statements: Array<{ sql: string; values: unknown[] }> = [];
  const state = {
    queueRows: [] as unknown[],
    domainRows: [] as unknown[],
    checkpointRows: [] as unknown[],
    jobRows: [] as unknown[],
    lockedDomainRows: [] as unknown[],
    childRows: [] as unknown[],
    resumeParentRows: [] as unknown[],
  };
  const queryRaw = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join("?");
    statements.push({ sql, values });
    if (sql.includes("result_json, checkpoint_json") && sql.includes("FOR UPDATE")) {
      return state.resumeParentRows;
    }
    if (sql.includes("WHERE parent_job_id =")) return state.childRows;
    if (
      sql.includes("SELECT id::text") &&
      sql.includes("FROM esg_driver_jobs") &&
      sql.includes("WHERE id =") &&
      sql.includes("FOR UPDATE")
    ) {
      return state.lockedDomainRows;
    }
    if (sql.includes("SELECT user_id, status")) return state.queueRows;
    if (sql.includes("SELECT status FROM background_jobs")) return state.queueRows;
    if (sql.includes("SELECT status FROM esg_driver_jobs")) return state.domainRows;
    if (sql.includes("SET checkpoint_json =")) return state.checkpointRows;
    if (sql.includes("checkpoint_json") && sql.includes("LIMIT 1")) {
      return state.jobRows;
    }
    return [];
  });
  const executeRaw = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    statements.push({ sql: strings.join("?"), values });
    return 1;
  });
  const client = { $executeRaw: executeRaw, $queryRaw: queryRaw };
  return {
    client,
    executeRaw,
    queryRaw,
    state,
    statements,
    transaction: vi.fn(async (callback: (database: {
      $executeRaw: typeof executeRaw;
      $queryRaw: typeof queryRaw;
    }) => unknown) => callback(client)),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@esgcredit/db-esg", () => ({
  esgPrisma: {
    ...mocks.client,
    $transaction: mocks.transaction,
  },
}));

afterEach(() => {
  mocks.state.queueRows = [];
  mocks.state.domainRows = [];
  mocks.state.checkpointRows = [];
  mocks.state.jobRows = [];
  mocks.state.lockedDomainRows = [];
  mocks.state.childRows = [];
  mocks.state.resumeParentRows = [];
  mocks.statements.length = 0;
  vi.clearAllMocks();
});

describe("ESG driver durable job lifecycle", () => {
  const id = "4c4ebf2b-a9e5-4f40-b633-740ee43ea7ec";

  it("rejects malformed and oversized pagination cursors before querying", async () => {
    const {
      InvalidEsgDriverJobsCursorError,
      listEsgDriverJobsPage,
    } = await import("../jobs");

    await expect(
      listEsgDriverJobsPage(7, { cursor: "not*base64url" }),
    ).rejects.toBeInstanceOf(InvalidEsgDriverJobsCursorError);
    await expect(
      listEsgDriverJobsPage(7, { cursor: "a".repeat(513) }),
    ).rejects.toBeInstanceOf(InvalidEsgDriverJobsCursorError);
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });

  it("locks a processing queue row before requesting cancellation", async () => {
    const { deleteEsgDriverJob } = await import("../jobs");
    mocks.state.queueRows = [{ status: "processing" }];
    mocks.state.lockedDomainRows = [{ id }];

    await expect(deleteEsgDriverJob(id, 7)).resolves.toBe("cancelling");

    expect(mocks.statements[0]?.sql).toContain("FOR UPDATE");
    expect(mocks.statements.some(({ sql }) => sql.includes("cancel_requested = TRUE"))).toBe(true);
    expect(mocks.statements.some(({ sql }) => sql.includes("stage = 'cancelling'"))).toBe(true);
  });

  it("allows the owner to delete a legacy domain row with no queue row", async () => {
    const { deleteEsgDriverJob } = await import("../jobs");
    mocks.state.queueRows = [];
    mocks.state.lockedDomainRows = [{ id }];

    await expect(deleteEsgDriverJob(id, 7)).resolves.toBe("deleted");
    expect(mocks.statements.some(({ sql }) => sql.includes("DELETE FROM esg_driver_jobs"))).toBe(true);
  });

  it("retains a parent job while linked resume children exist", async () => {
    const { deleteEsgDriverJob } = await import("../jobs");
    mocks.state.queueRows = [{ status: "done" }];
    mocks.state.lockedDomainRows = [{ id }];
    mocks.state.childRows = [{ id: "9320f9d0-1091-4484-9b56-e6e695bcf653" }];

    await expect(deleteEsgDriverJob(id, 7)).resolves.toBe("linked");
    expect(
      mocks.statements.some(({ sql }) => sql.includes("DELETE FROM esg_driver_jobs")),
    ).toBe(false);
    expect(
      mocks.statements.some(({ sql }) => sql.includes("DELETE FROM background_jobs")),
    ).toBe(false);
  });

  it("commits queue and domain completion inside one fenced transaction", async () => {
    const { completeEsgDriverJob } = await import("../jobs");
    mocks.state.queueRows = [{
      attempts: 1,
      cancel_requested: false,
      lease_owner: "lease-token-a",
      lease_valid: true,
      max_attempts: 2,
      status: "processing",
      user_id: 7,
    }];
    mocks.state.domainRows = [{ status: "processing" }];

    const completed = await completeEsgDriverJob(id, "lease-token-a", {
      country: "United Arab Emirates",
      sector: "Banking",
      language: "English",
      catalogVersion: "2026-07-14",
      generatedAt: new Date().toISOString(),
      drivers: [],
      evidence: [],
      warnings: [],
      trace: {} as any,
    });

    expect(completed).toBe(true);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.statements.some(({ sql }) => sql.includes("SET status = 'done', progress = 100"))).toBe(true);
    expect(mocks.statements.some(({ sql }) => sql.includes("AND lease_owner ="))).toBe(true);
    expect(mocks.statements.some(({ sql }) => sql.includes("AND lease_expires_at >= now()"))).toBe(true);
    expect(mocks.statements.some(({ sql }) => sql.includes("AND cancel_requested = FALSE"))).toBe(true);
    expect(mocks.statements.some(({ sql }) => sql.includes("AND status IN ('queued', 'processing')"))).toBe(true);
  });

  it("commits an approved partial pack as done with an explicit omission stage", async () => {
    const { completeEsgDriverJob } = await import("../jobs");
    mocks.state.queueRows = [{
      attempts: 1,
      cancel_requested: false,
      lease_owner: "lease-token-a",
      lease_valid: true,
      max_attempts: 2,
      status: "processing",
      user_id: 7,
    }];
    mocks.state.domainRows = [{ status: "processing" }];

    const completed = await completeEsgDriverJob(id, "lease-token-a", {
      ...emptyResult(),
      completion: "partial",
      expectedDriverCount: 12,
      slotFailures: [
        {
          driverId: "D7",
          driverNumber: 7,
          originalDriverLogicId: "global-climate-macro-risk",
          attemptedDriverLogicIds: ["global-climate-macro-risk"],
          reasons: ["No candidate passed"],
          createdAt: "2026-07-14T00:00:00.000Z",
        },
      ],
    });

    expect(completed).toBe(true);
    expect(
      mocks.statements.some(({ values }) =>
        values.includes("complete with omissions"),
      ),
    ).toBe(true);
    expect(
      mocks.statements.some(({ values }) =>
        values.some(
          (value) =>
            typeof value === "string" &&
            value.includes('"completion":"partial"'),
        ),
      ),
    ).toBe(true);
  });

  it("persists checkpoints only through the active worker lease fence", async () => {
    const { updateEsgDriverJobCheckpoint } = await import("../jobs");
    mocks.state.checkpointRows = [{ id }];

    await expect(
      updateEsgDriverJobCheckpoint(id, "lease-token-a", checkpoint()),
    ).resolves.toBeUndefined();

    const statement = mocks.statements.find(({ sql }) =>
      sql.includes("SET checkpoint_json ="),
    );
    expect(statement?.sql).toContain("AND lease_owner =");
    expect(statement?.sql).toContain("AND lease_expires_at >= now()");
    expect(statement?.sql).toContain("AND cancel_requested = FALSE");
    expect(statement?.sql).toContain("AND domain.status IN ('queued', 'processing')");
    expect(statement?.values).toContain("2026-07-14");
  });

  it("creates an immutable child job seeded with resume revalidation metadata", async () => {
    const { createEsgDriverResumeJob } = await import("../jobs");
    const childId = "9320f9d0-1091-4484-9b56-e6e695bcf653";
    mocks.state.resumeParentRows = [resumeParentRow(id)];
    mocks.state.jobRows = [jobRow(childId, id)];

    const child = await createEsgDriverResumeJob(7, {
      ...mappedJob(id),
      status: "done",
      result: { ...emptyResult(), completion: "partial" },
      checkpoint: checkpoint(),
    });

    expect(child.id).toBe(childId);
    expect(child.parentJobId).toBe(id);
    const parentLock = mocks.statements.find(
      ({ sql }) => sql.includes("result_json, checkpoint_json") && sql.includes("FOR UPDATE"),
    );
    expect(parentLock?.values).toContain(id);
    expect(parentLock?.values).toContain(7);
    const domainInsert = mocks.statements.find(({ sql }) =>
      sql.includes("INSERT INTO esg_driver_jobs"),
    );
    expect(domainInsert?.values).toContain(id);
    expect(
      domainInsert?.values.some(
        (value) =>
          typeof value === "string" &&
          value.includes('"revalidateAcceptedSources":true'),
      ),
    ).toBe(true);
  });

  it("fails resume atomically when the locked parent was deleted", async () => {
    const {
      createEsgDriverResumeJob,
      EsgDriverResumeParentNotFoundError,
    } = await import("../jobs");

    await expect(
      createEsgDriverResumeJob(7, mappedJob(id)),
    ).rejects.toBeInstanceOf(EsgDriverResumeParentNotFoundError);
    expect(
      mocks.statements.some(({ sql }) => sql.includes("INSERT INTO esg_driver_jobs")),
    ).toBe(false);
  });

  it("rechecks resumability while holding the parent lock", async () => {
    const {
      createEsgDriverResumeJob,
      EsgDriverResumeConflictError,
    } = await import("../jobs");
    mocks.state.resumeParentRows = [
      { ...resumeParentRow(id), result_json: { ...emptyResult(), completion: "complete" } },
    ];

    await expect(
      createEsgDriverResumeJob(7, mappedJob(id)),
    ).rejects.toBeInstanceOf(EsgDriverResumeConflictError);
  });

  it("does not complete the queue when the domain job is already terminal", async () => {
    const { completeEsgDriverJob } = await import("../jobs");
    mocks.state.queueRows = [{
      attempts: 1,
      cancel_requested: false,
      lease_owner: "lease-token-a",
      lease_valid: true,
      max_attempts: 2,
      status: "processing",
      user_id: 7,
    }];
    mocks.state.domainRows = [{ status: "done" }];

    const completed = await completeEsgDriverJob(
      id,
      "lease-token-a",
      emptyResult(),
    );

    expect(completed).toBe(false);
    expect(mocks.executeRaw).not.toHaveBeenCalled();
  });

  it("does not complete the queue when the active domain update affects no row", async () => {
    const { completeEsgDriverJob } = await import("../jobs");
    mocks.state.queueRows = [{
      attempts: 1,
      cancel_requested: false,
      lease_owner: "lease-token-a",
      lease_valid: true,
      max_attempts: 2,
      status: "processing",
      user_id: 7,
    }];
    mocks.state.domainRows = [{ status: "processing" }];
    mocks.executeRaw.mockResolvedValueOnce(0);

    const completed = await completeEsgDriverJob(
      id,
      "lease-token-a",
      emptyResult(),
    );

    expect(completed).toBe(false);
    expect(mocks.executeRaw).toHaveBeenCalledTimes(1);
    expect(
      mocks.statements.some(
        ({ sql }) =>
          sql.includes("UPDATE background_jobs") &&
          sql.includes("SET status = 'done'"),
      ),
    ).toBe(false);
  });

  it("keeps ordinary first-attempt failures queued for retry", async () => {
    const { failEsgDriverJob } = await import("../jobs");
    mocks.state.queueRows = [lockedQueueRow()];

    await expect(
      failEsgDriverJob(claimedJob(), "temporary provider failure"),
    ).resolves.toMatchObject({ status: "queued", transitioned: true });

    expect(
      mocks.statements.some(
        ({ sql }) =>
          sql.includes("UPDATE esg_driver_jobs") &&
          sql.includes("stage ="),
      ),
    ).toBe(true);
  });

  it("classifies global budget failures as terminal worker errors", async () => {
    const { isRetryableEsgDriverFailure } = await import("../jobs");
    const { EsgDriverQualityGateError } = await import("../errors");
    const researchBudgetError = new Error("research budget exhausted");
    researchBudgetError.name = "EsgResearchBudgetExceededError";
    const harnessBudgetError = new Error("generation deadline exceeded");
    harnessBudgetError.name = "HarnessBudgetExceededError";
    const transientNetworkError = Object.assign(new Error("connection reset"), {
      code: "ECONNRESET",
    });
    const transientRateLimit = Object.assign(new Error("too many requests"), {
      status: 429,
    });

    expect(isRetryableEsgDriverFailure(researchBudgetError)).toBe(false);
    expect(isRetryableEsgDriverFailure(harnessBudgetError)).toBe(false);
    expect(isRetryableEsgDriverFailure(transientNetworkError)).toBe(true);
    expect(isRetryableEsgDriverFailure(transientRateLimit)).toBe(true);
    expect(
      isRetryableEsgDriverFailure(new EsgDriverQualityGateError("quality gates failed")),
    ).toBe(false);
    expect(isRetryableEsgDriverFailure(new Error("driver quality failed"))).toBe(false);
    expect(
      isRetryableEsgDriverFailure(Object.assign(new Error("invalid API key"), { status: 401 })),
    ).toBe(false);
  });

  it("marks deterministic budget exhaustion terminal without replaying the job", async () => {
    const { failEsgDriverJob } = await import("../jobs");
    mocks.state.queueRows = [lockedQueueRow()];

    await expect(
      failEsgDriverJob(
        claimedJob(),
        "ESG research deadline was exceeded.",
        { retryable: false },
      ),
    ).resolves.toMatchObject({ status: "error", transitioned: true });

    const queueUpdate = mocks.statements.find(({ sql }) =>
      sql.includes("UPDATE background_jobs"),
    );
    expect(queueUpdate?.values).toContain(false);
  });
});

function lockedQueueRow() {
  return {
    attempts: 1,
    cancel_requested: false,
    lease_owner: "lease-token-a",
    lease_valid: true,
    max_attempts: 2,
    status: "processing",
    user_id: 7,
  };
}

function claimedJob() {
  return {
    id: "4c4ebf2b-a9e5-4f40-b633-740ee43ea7ec",
    userId: 7,
    leaseOwner: "lease-token-a",
    attempts: 1,
    maxAttempts: 2,
    progress: 18,
  } as any;
}

function emptyResult() {
  return {
    country: "United Arab Emirates",
    sector: "Banking",
    language: "English",
    catalogVersion: "2026-07-14",
    generatedAt: new Date().toISOString(),
    drivers: [],
    evidence: [],
    warnings: [],
    trace: {} as any,
  };
}

function checkpoint() {
  return {
    version: 1 as const,
    catalogVersion: "2026-07-14",
    selectionPlan: {} as any,
    canonicalDrivers: [],
    evidencePacks: [],
    completedSlotIds: [],
    failedSlots: [],
    attemptedCandidateIds: [],
    slotStates: [],
    updatedAt: "2026-07-14T00:00:00.000Z",
  };
}

function mappedJob(id: string) {
  return {
    id,
    userId: 7,
    country: "United Arab Emirates",
    sector: "Banking",
    language: "English",
    status: "done" as const,
    progress: 100,
    stage: "complete with omissions",
    error: null,
    result: { ...emptyResult(), completion: "partial" as const },
    evidence: [],
    checkpoint: checkpoint(),
    catalogVersion: "2026-07-14",
    parentJobId: null,
    activity: [],
    createdAt: "2026-07-14T00:00:00.000Z",
    updatedAt: "2026-07-14T00:01:00.000Z",
    completedAt: "2026-07-14T00:01:00.000Z",
  };
}

function jobRow(id: string, parentJobId: string) {
  return {
    id,
    user_id: 7,
    country: "United Arab Emirates",
    sector: "Banking",
    language: "English",
    status: "queued",
    progress: 0,
    stage: "queued",
    error_message: null,
    result_json: null,
    evidence_json: null,
    checkpoint_json: checkpoint(),
    catalog_version: "2026-07-14",
    parent_job_id: parentJobId,
    activity_json: [],
    created_at: "2026-07-14T00:02:00.000Z",
    updated_at: "2026-07-14T00:02:00.000Z",
    completed_at: null,
  };
}

function resumeParentRow(id: string) {
  return {
    id,
    user_id: 7,
    country: "United Arab Emirates",
    sector: "Banking",
    language: "English",
    status: "done",
    result_json: { ...emptyResult(), completion: "partial" as const },
    checkpoint_json: checkpoint(),
  };
}
