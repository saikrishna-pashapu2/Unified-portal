import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const provider = vi.hoisted(() => ({ request: vi.fn() }));
const queue = vi.hoisted(() => ({ throwIfCancelled: vi.fn().mockResolvedValue(undefined) }));

vi.mock("server-only", () => ({}));
vi.mock("./provider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./provider")>()),
  requestArticleAiDecisions: provider.request,
}));
vi.mock("@/lib/jobs/queue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/jobs/queue")>()),
  throwIfJobCancelled: queue.throwIfCancelled,
}));

const integration = process.env.RUN_DB_INTEGRATION_TESTS === "1" ? describe : describe.skip;

let esg: (typeof import("@esgcredit/db-esg"))["esgPrisma"];
let credit: (typeof import("@esgcredit/db-credit"))["creditPrisma"];
let runSharedArticleAiAssessment: (typeof import("./shared"))["runSharedArticleAiAssessment"];
let getCurrentSharedSelections: (typeof import("./shared"))["getCurrentSharedSelections"];

const suffix = randomUUID();
const userIds: number[] = [];
const esgArticleIds: number[] = [];
const creditArticleIds: number[] = [];
const assessmentDates = ["2099-01-01", "2099-01-02", "2099-01-03", "2099-01-04", "2099-01-05"];

integration("shared article AI assessment", () => {
  beforeAll(async () => {
    for (const name of ["ESG_DATABASE_URL", "CREDIT_DATABASE_URL"] as const) {
      const url = new URL(process.env[name] ?? "");
      if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
        throw new Error("Shared article AI integration requires disposable loopback databases");
      }
    }
    vi.stubEnv("ARTICLE_AI_ENABLED", "true");
    vi.stubEnv("ARTICLE_AI_MAX_HISTORY_EXAMPLES", "200");
    vi.stubEnv("ARTICLE_AI_DAILY_REQUEST_LIMIT", "2");
    vi.stubEnv("ARTICLE_AI_DAILY_TOKEN_LIMIT", "100000");
    ({ esgPrisma: esg } = await import("@esgcredit/db-esg"));
    ({ creditPrisma: credit } = await import("@esgcredit/db-credit"));
    ({ runSharedArticleAiAssessment, getCurrentSharedSelections } = await import("./shared"));

    for (const [index, team] of [[0, "global-team-a"], [1, null]] as const) {
      const user = await esg.users.create({
        data: {
          username: `article-ai-shared-${suffix}-${index}`,
          email: `article-ai-shared-${suffix}-${index}@example.test`,
          password_hash: "not-a-real-password",
          team,
          is_active_db: true,
          email_notifications: true,
        },
      });
      userIds.push(user.id);
    }

    const [liked] = await esg.$queryRaw<Array<{ id: number }>>`
      INSERT INTO esg_articles (title, summary, link, source, published)
      VALUES (
        ${`Shared ESG liked ${suffix}`},
        'Climate transition risk and emissions accounting evidence',
        ${`https://example.test/${suffix}/esg/liked`}, 'Shared Wire', now()
      ) RETURNING id
    `;
    const [candidate] = await esg.$queryRaw<Array<{ id: number }>>`
      INSERT INTO esg_articles (title, summary, link, source, published)
      VALUES (
        ${`Shared ESG candidate ${suffix}`},
        'Climate transition risk disclosure and emissions accounting update',
        ${`https://example.test/${suffix}/esg/candidate`}, 'Candidate Wire', now()
      ) RETURNING id
    `;
    esgArticleIds.push(liked.id, candidate.id);
    await esg.$executeRaw`
      INSERT INTO likes (user_id, content_type, content_id, created_at)
      VALUES (${userIds[0]}, 'article', ${liked.id}, now())
    `;

    const [creditLiked] = await credit.$queryRaw<Array<{ id: number }>>`
      INSERT INTO credit_articles (title, summary, content, link, source, date, created_at, updated_at)
      VALUES (
        ${`Shared Credit liked ${suffix}`},
        'Sovereign rating methodology evidence',
        'Credit fundamentals and rating action evidence',
        ${`https://example.test/${suffix}/credit/liked`}, 'Ratings Wire', CURRENT_DATE, now(), now()
      ) RETURNING id
    `;
    const [creditCandidate] = await credit.$queryRaw<Array<{ id: number }>>`
      INSERT INTO credit_articles (title, summary, content, link, source, date, created_at, updated_at)
      VALUES (
        ${`Shared Credit candidate ${suffix}`},
        'Sovereign rating methodology outlook update',
        'Credit fundamentals, sovereign risk, and rating action update',
        ${`https://example.test/${suffix}/credit/candidate`}, 'Ratings Candidate', CURRENT_DATE, now(), now()
      ) RETURNING id
    `;
    creditArticleIds.push(creditLiked.id, creditCandidate.id);
    await credit.$executeRaw`
      INSERT INTO likes (user_id, content_type, content_id, created_at)
      VALUES (${userIds[0]}, 'article', ${creditLiked.id}, now())
    `;
  });

  afterAll(async () => {
    if (!userIds.length && !esgArticleIds.length && !creditArticleIds.length) {
      await Promise.all([esg?.$disconnect(), credit?.$disconnect()]);
      vi.unstubAllEnvs();
      return;
    }
    if (credit && userIds.length) await credit.$executeRaw`DELETE FROM likes WHERE user_id = ANY(${userIds}::int[])`;
    if (esg && userIds.length) await esg.$executeRaw`DELETE FROM article_ai_user_selections WHERE user_id = ANY(${userIds}::int[])`;
    if (esg) {
      await esg.$executeRaw`DELETE FROM article_ai_domain_feedback WHERE user_id = ANY(${userIds}::int[])`;
      await esg.$executeRaw`
        DELETE FROM article_ai_domain_selections
        WHERE (domain = 'esg' AND article_id = ANY(${esgArticleIds}::int[]))
           OR (domain = 'credit' AND article_id = ANY(${creditArticleIds}::int[]))
      `;
      await esg.$executeRaw`DELETE FROM article_ai_domain_assessments WHERE assessment_date = ANY(${assessmentDates}::date[])`;
      await esg.$executeRaw`
        DELETE FROM article_ai_article_features
        WHERE (domain = 'esg' AND article_id = ANY(${esgArticleIds}::int[]))
           OR (domain = 'credit' AND article_id = ANY(${creditArticleIds}::int[]))
      `;
      await esg.$executeRaw`DELETE FROM likes WHERE user_id = ANY(${userIds}::int[])`;
      await esg.$executeRaw`DELETE FROM esg_articles WHERE id = ANY(${esgArticleIds}::int[])`;
      await esg.users.deleteMany({ where: { id: { in: userIds } } });
    }
    if (credit && creditArticleIds.length) await credit.$executeRaw`DELETE FROM credit_articles WHERE id = ANY(${creditArticleIds}::int[])`;
    await Promise.all([esg?.$disconnect(), credit?.$disconnect()]);
    vi.unstubAllEnvs();
  });

  it("pools all human likes across blank/different teams and de-duplicates concurrent provider work", async () => {
    provider.request.mockImplementation(async (profile: { domain: string }, candidates: Array<{ id: number }>) => {
      expect(candidates.some((candidate) => candidate.id === esgArticleIds[1])).toBe(true);
      return {
        decisions: [{ articleId: esgArticleIds[1], action: "select", confidence: 0.92, reason: `shared ${profile.domain}` }],
        model: "qa-shared-provider", inputTokens: 100, outputTokens: 20,
      };
    });
    const payload = { domain: "esg" as const, runDate: assessmentDates[0], policyVersion: 2 as const };
    const job = (id: string) => ({ id, jobType: "article_ai_esg_v2", userId: userIds[0], payload, leaseOwner: `qa-${id}`, cancelRequested: false } as never);
    const results = await Promise.allSettled([
      runSharedArticleAiAssessment(job("one"), payload),
      runSharedArticleAiAssessment(job("two"), payload),
    ]);
    for (const result of results) {
      if (result.status === "fulfilled") expect(result.value.status).toBe("ready");
      else expect(String(result.reason?.message ?? result.reason)).toContain("Background job lease");
    }
    expect(results.some((result) => result.status === "fulfilled" && result.value.status === "ready")).toBe(true);
    expect(provider.request).toHaveBeenCalledTimes(1);
    expect(provider.request.mock.calls[0][0]).toMatchObject({ domain: "esg", profileSource: "domain", humanLikeCount: 1 });
    const first = await getCurrentSharedSelections(userIds[0], "esg", esgArticleIds, new Date());
    const second = await getCurrentSharedSelections(userIds[1], "esg", esgArticleIds, new Date());
    expect(first).toHaveLength(1);
    expect(second.map((row) => row.id)).toEqual(first.map((row) => row.id));
  });

  it("keeps Credit assessment and human history separate from ESG", async () => {
    provider.request.mockImplementation(async (profile: { domain: string }, candidates: Array<{ id: number }>) => {
      expect(candidates.some((candidate) => candidate.id === creditArticleIds[1])).toBe(true);
      return {
        decisions: [{ articleId: creditArticleIds[1], action: "select", confidence: 0.9, reason: profile.domain }],
        model: "qa-shared-provider", inputTokens: 100, outputTokens: 20,
      };
    });
    const payload = { domain: "credit" as const, runDate: assessmentDates[1], policyVersion: 2 as const };
    const job = { id: "credit-one", jobType: "article_ai_credit_v2", userId: userIds[0], payload, leaseOwner: "qa-credit", cancelRequested: false } as never;
    const result = await runSharedArticleAiAssessment(job, payload);
    expect(result).toMatchObject({ status: "ready", domain: "credit", historyCount: 1 });
    const creditSelections = await getCurrentSharedSelections(userIds[1], "credit", creditArticleIds, new Date());
    const esgSelections = await getCurrentSharedSelections(userIds[1], "esg", esgArticleIds, new Date());
    expect(creditSelections).toHaveLength(1);
    expect(esgSelections).toHaveLength(1);
    expect(creditSelections[0].domain).toBe("credit");
    expect(esgSelections[0].domain).toBe("esg");
    expect(creditSelections[0].id).not.toBe(esgSelections[0].id);
    expect(creditSelections[0].assessment_id).not.toBe(esgSelections[0].assessment_id);
  });

  it("treats a newer ready assessment with zero picks as authoritative", async () => {
    await esg.$executeRaw`
      INSERT INTO article_ai_domain_assessments (
        domain, assessment_date, policy_version, status, profile_source,
        history_count, completed_at, updated_at
      ) VALUES (
        'esg', ${assessmentDates[2]}::date, 2, 'ready', 'domain',
        1, now(), now()
      )
    `;

    // The older ready assessment has an unexpired shared selection, but the
    // newest ready assessment deliberately has no selections. A completed
    // empty run means "no picks", not "reuse the previous picks".
    const emptyReady = await getCurrentSharedSelections(userIds[1], "esg", esgArticleIds, new Date());
    expect(emptyReady).toEqual([]);

    // Incomplete runs do not become authoritative. While the newer run is
    // running or errored, the latest completed ready assessment is usable.
    await esg.$executeRaw`
      UPDATE article_ai_domain_assessments
      SET status = 'running', updated_at = now()
      WHERE domain = 'esg' AND assessment_date = ${assessmentDates[2]}::date AND policy_version = 2
    `;
    const runningFallback = await getCurrentSharedSelections(userIds[1], "esg", esgArticleIds, new Date());
    expect(runningFallback.map((selection) => selection.article_id)).toEqual([esgArticleIds[1]]);

    await esg.$executeRaw`
      UPDATE article_ai_domain_assessments
      SET status = 'error', updated_at = now()
      WHERE domain = 'esg' AND assessment_date = ${assessmentDates[2]}::date AND policy_version = 2
    `;
    const errorFallback = await getCurrentSharedSelections(userIds[1], "esg", esgArticleIds, new Date());
    expect(errorFallback.map((selection) => selection.article_id)).toEqual([esgArticleIds[1]]);
  });

  it("does not publish shared selections after the assessment lease is stolen", async () => {
    provider.request.mockReset();
    let releaseProvider!: () => void;
    const providerGate = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    provider.request.mockImplementation(async (_profile: { domain: string }, candidates: Array<{ id: number }>) => {
      expect(candidates.some((candidate) => candidate.id === esgArticleIds[1])).toBe(true);
      await providerGate;
      return {
        decisions: [{ articleId: esgArticleIds[1], action: "select", confidence: 0.92, reason: "stale lease" }],
        model: "qa-fence-provider", inputTokens: 100, outputTokens: 20,
      };
    });
    const payload = { domain: "esg" as const, runDate: assessmentDates[3], policyVersion: 2 as const };
    const job = { id: "lease-stolen", jobType: "article_ai_esg_v2", userId: userIds[0], payload, leaseOwner: "qa-stolen", cancelRequested: false } as never;
    const run = runSharedArticleAiAssessment(job, payload);
    await vi.waitFor(() => expect(provider.request).toHaveBeenCalledTimes(1));

    const assessment = (await esg.$queryRaw<Array<{ id: string; lease_token: string | null }>>`
      SELECT id::text, lease_token::text
      FROM article_ai_domain_assessments
      WHERE domain = 'esg' AND assessment_date = ${assessmentDates[3]}::date AND policy_version = 2
    `)[0];
    if (!assessment) throw new Error("Fence test assessment was not created");
    await esg.$executeRaw`
      UPDATE article_ai_domain_assessments
      SET lease_token = ${randomUUID()}::uuid, lease_owner = 'qa-stealer',
          lease_expires_at = now() + interval '120 seconds', updated_at = now()
      WHERE id = ${assessment.id}::uuid
    `;
    releaseProvider();

    await expect(run).rejects.toThrow("Background job lease");
    const selections = await esg.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count
      FROM article_ai_domain_selections
      WHERE assessment_id = ${assessment.id}::uuid
    `;
    expect(Number(selections[0]?.count ?? 0)).toBe(0);
  });

  it("does not call the provider when the lease expires at the pre-provider fence", async () => {
    provider.request.mockReset();
    queue.throwIfCancelled.mockImplementationOnce(async () => {
      await esg.$executeRaw`
        UPDATE article_ai_domain_assessments
        SET lease_expires_at = now() - interval '1 second', updated_at = now()
        WHERE domain = 'esg' AND assessment_date = ${assessmentDates[4]}::date AND policy_version = 2
      `;
    });
    const payload = { domain: "esg" as const, runDate: assessmentDates[4], policyVersion: 2 as const };
    const job = { id: "lease-expired-before-provider", jobType: "article_ai_esg_v2", userId: userIds[0], payload, leaseOwner: "qa-expired", cancelRequested: false } as never;

    await expect(runSharedArticleAiAssessment(job, payload)).rejects.toThrow("Background job lease");
    expect(provider.request).not.toHaveBeenCalled();
    const assessment = (await esg.$queryRaw<Array<{ status: string; requests_reserved: number }>>`
      SELECT status, requests_reserved
      FROM article_ai_domain_assessments
      WHERE domain = 'esg' AND assessment_date = ${assessmentDates[4]}::date AND policy_version = 2
    `)[0];
    expect(assessment?.status).toBe("running");
    expect(Number(assessment?.requests_reserved ?? 0)).toBe(1);
  });
});
