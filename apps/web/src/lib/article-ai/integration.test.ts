import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const provider = vi.hoisted(() => ({ request: vi.fn() }));
const queue = vi.hoisted(() => ({
  enqueue: vi.fn(),
  throwIfCancelled: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("server-only", () => ({}));
vi.mock("./provider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./provider")>()),
  requestArticleAiDecisions: provider.request,
}));
vi.mock("@/lib/jobs/queue", () => ({
  enqueueBackgroundJob: queue.enqueue,
  throwIfJobCancelled: queue.throwIfCancelled,
}));

const integration = process.env.RUN_DB_INTEGRATION_TESTS === "1" ? describe : describe.skip;

let esg: (typeof import("@esgcredit/db-esg"))["esgPrisma"];
let credit: (typeof import("@esgcredit/db-credit"))["creditPrisma"];
let normalizeArticle: (typeof import("./policy"))["normalizeArticle"];
let service: typeof import("./service");
let reconcileArticleAiFeedback: (typeof import("./jobs"))["reconcileArticleAiFeedback"];
let runArticleAiJob: (typeof import("./jobs"))["runArticleAiJob"];

const suffix = randomUUID();
const userIds: number[] = [];
const esgArticleIds: number[] = [];
const creditArticleIds: number[] = [];
const now = new Date();

type Domain = "esg" | "credit";

type TestArticle = {
  id: number;
  title: string;
  summary: string;
  content: string | null;
  source: string;
  url: string;
  publishedAt: Date;
};

const articles = new Map<string, TestArticle>();

function key(domain: Domain, id: number) {
  return `${domain}:${id}`;
}

function articleHash(domain: Domain, id: number) {
  const article = articles.get(key(domain, id));
  if (!article) throw new Error(`Missing ${domain} test article ${id}`);
  return normalizeArticle(article).contentHash;
}

async function insertSelection(args: {
  userId: number;
  domain: Domain;
  articleId: number;
  contentHash?: string;
  expiresAt?: Date;
  version?: number;
  pending?: boolean;
  state?: "selected" | "confirmed" | "dismissed";
}) {
  const rows = await esg.$queryRaw<Array<{ id: string }>>`
    INSERT INTO article_ai_selections (
      user_id, domain, article_id, state, reason, relevance_score, version,
      selected_at, expires_at, content_hash, pending_confirmation
    ) VALUES (
      ${args.userId}, ${args.domain}, ${args.articleId}, ${args.state ?? "selected"},
      ${`QA reason for ${args.domain}:${args.articleId}`}, 0.91, ${args.version ?? 1},
      ${now}, ${args.expiresAt ?? new Date(now.getTime() + 86_400_000)},
      ${args.contentHash ?? articleHash(args.domain, args.articleId)}, ${args.pending ?? false}
    )
    RETURNING id::text
  `;
  return rows[0].id;
}

integration("article AI service and Credit feedback outbox", () => {
  beforeAll(async () => {
    for (const name of ["ESG_DATABASE_URL", "CREDIT_DATABASE_URL"] as const) {
      const url = new URL(process.env[name] ?? "");
      if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
        throw new Error("Article AI integration tests require disposable loopback databases");
      }
    }

    vi.stubEnv("ARTICLE_AI_ENABLED", "true");
    vi.stubEnv("ARTICLE_AI_EMAIL_ENABLED", "false");
    vi.stubEnv("ARTICLE_AI_DAILY_TOKEN_LIMIT", "100000");
    ({ esgPrisma: esg } = await import("@esgcredit/db-esg"));
    ({ creditPrisma: credit } = await import("@esgcredit/db-credit"));
    ({ normalizeArticle } = await import("./policy"));
    service = await import("./service");
    ({ reconcileArticleAiFeedback, runArticleAiJob } = await import("./jobs"));

    for (let index = 0; index < 2; index += 1) {
      const user = await esg.users.create({
        data: {
          username: `article-ai-${suffix}-${index}`,
          email: `article-ai-${suffix}-${index}@example.test`,
          password_hash: "not-a-real-password",
          team: `article-ai-team-${suffix}-${index}`,
          is_active_db: true,
          email_notifications: true,
        },
      });
      userIds.push(user.id);
    }

    for (let index = 0; index < 6; index += 1) {
      const title = `ESG QA article ${suffix} ${index}`;
      const summary = `Climate transition evidence ${index}`;
      const url = `https://example.test/${suffix}/esg/${index}`;
      const source = "QA Wire";
      const [row] = await esg.$queryRaw<Array<{ id: number }>>`
        INSERT INTO esg_articles (title, summary, link, source, published)
        VALUES (${title}, ${summary}, ${url}, ${source}, ${now})
        RETURNING id
      `;
      esgArticleIds.push(row.id);
      articles.set(key("esg", row.id), {
        id: row.id,
        title,
        summary,
        content: null,
        source,
        url,
        publishedAt: now,
      });
    }

    for (let index = 0; index < 2; index += 1) {
      const title = `Credit QA article ${suffix} ${index}`;
      const summary = `Sovereign rating evidence ${index}`;
      const content = `Credit fundamentals and rating action ${index}`;
      const url = `https://example.test/${suffix}/credit/${index}`;
      const source = "QA Ratings";
      const [row] = await credit.$queryRaw<Array<{ id: number }>>`
        INSERT INTO credit_articles (title, summary, content, link, source, date, created_at, updated_at)
        VALUES (${title}, ${summary}, ${content}, ${url}, ${source}, ${now}, ${now}, ${now})
        RETURNING id
      `;
      creditArticleIds.push(row.id);
      articles.set(key("credit", row.id), {
        id: row.id,
        title,
        summary,
        content,
        source,
        url,
        publishedAt: now,
      });
    }
  });

  afterAll(async () => {
    if (credit && userIds.length) {
      await credit.$executeRaw`DELETE FROM likes WHERE user_id = ANY(${userIds}::integer[])`;
    }
    if (credit && creditArticleIds.length) {
      await credit.$executeRaw`DELETE FROM credit_articles WHERE id = ANY(${creditArticleIds}::integer[])`;
    }
    if (esg && userIds.length) {
      await esg.users.deleteMany({ where: { id: { in: userIds } } });
    }
    if (esg && esgArticleIds.length) {
      await esg.$executeRaw`DELETE FROM esg_articles WHERE id = ANY(${esgArticleIds}::integer[])`;
    }
    await Promise.all([esg?.$disconnect(), credit?.$disconnect()]);
    vi.unstubAllEnvs();
  });

  it("keeps preferences domain-specific and changes the settings epoch only when the value changes", async () => {
    const userId = userIds[0];
    const initial = await service.getArticleAiPreference(userId, "esg");
    expect(initial).toMatchObject({ domain: "esg", enabled: false, settingsVersion: 0 });

    const off = await service.setArticleAiPreference(userId, "esg", false);
    const repeatedOff = await service.setArticleAiPreference(userId, "esg", false);
    const on = await service.setArticleAiPreference(userId, "esg", true);
    const repeatedOn = await service.setArticleAiPreference(userId, "esg", true);
    const creditPreference = await service.getArticleAiPreference(userId, "credit");

    expect(off.settingsVersion).toBe(1);
    expect(repeatedOff.settingsVersion).toBe(1);
    expect(on).toMatchObject({ enabled: true, settingsVersion: 2 });
    expect(repeatedOn.settingsVersion).toBe(2);
    expect(creditPreference).toMatchObject({ domain: "credit", enabled: false, settingsVersion: 0 });
  });

  it("isolates selections by owner and domain", async () => {
    const articleId = esgArticleIds[0];
    await insertSelection({ userId: userIds[0], domain: "esg", articleId });

    expect((await service.getArticleAiSelections(userIds[0], "esg", [articleId])).map(row => row.articleId)).toEqual([articleId]);
    expect(await service.getArticleAiSelections(userIds[1], "esg", [articleId])).toEqual([]);
    expect(await service.getArticleAiSelections(userIds[0], "credit", [articleId])).toEqual([]);
  });

  it("creates an ESG human like idempotently and preserves an existing like timestamp", async () => {
    const userId = userIds[0];
    const createdArticleId = esgArticleIds[1];
    const existingArticleId = esgArticleIds[2];
    await insertSelection({ userId, domain: "esg", articleId: createdArticleId });
    await insertSelection({ userId, domain: "esg", articleId: existingArticleId });
    const originalTimestamp = new Date("2025-01-02T03:04:05.000Z");
    await esg.$executeRaw`
      INSERT INTO likes (user_id, content_type, content_id, created_at)
      VALUES (${userId}, 'article', ${existingArticleId}, ${originalTimestamp})
    `;
    const [existingBefore] = await esg.$queryRaw<Array<{ created_at: Date | null }>>`
      SELECT created_at FROM likes
      WHERE user_id = ${userId} AND content_type = 'article' AND content_id = ${existingArticleId}
    `;

    const first = await service.recordArticleAiFeedback(userId, "esg", createdArticleId, "confirm", 1);
    const retry = await service.recordArticleAiFeedback(userId, "esg", createdArticleId, "confirm", 1);
    await service.recordArticleAiFeedback(userId, "esg", existingArticleId, "confirm", 1);

    expect(first).toMatchObject({ humanLiked: true, pending: false, selection: { state: "confirmed", version: 2 } });
    expect(retry).toMatchObject({ humanLiked: true, pending: false, selection: { state: "confirmed", version: 2 } });
    const likes = await esg.$queryRaw<Array<{ content_id: number; created_at: Date | null }>>`
      SELECT content_id, created_at FROM likes
      WHERE user_id = ${userId} AND content_type = 'article'
        AND content_id = ANY(${[createdArticleId, existingArticleId]}::integer[])
      ORDER BY content_id
    `;
    expect(likes).toHaveLength(2);
    expect(likes.find(row => row.content_id === existingArticleId)?.created_at?.toISOString()).toBe(existingBefore.created_at?.toISOString());
  });

  it("rejects expired and content-stale selections without manufacturing likes", async () => {
    const userId = userIds[0];
    const expiredArticleId = esgArticleIds[3];
    const staleArticleId = esgArticleIds[4];
    await insertSelection({
      userId,
      domain: "esg",
      articleId: expiredArticleId,
      expiresAt: new Date(now.getTime() - 1_000),
    });
    await insertSelection({ userId, domain: "esg", articleId: staleArticleId, contentHash: "stale-content-hash" });

    expect(await service.getArticleAiSelections(userId, "esg", [expiredArticleId])).toEqual([]);
    await expect(service.recordArticleAiFeedback(userId, "esg", expiredArticleId, "confirm", 1)).rejects.toMatchObject({ status: 409 });
    await expect(service.recordArticleAiFeedback(userId, "esg", staleArticleId, "confirm", 1)).rejects.toMatchObject({ status: 409 });
    const [likes] = await esg.$queryRaw<Array<{ count: number }>>`
      SELECT count(*)::int AS count FROM likes
      WHERE user_id = ${userId} AND content_id = ANY(${[expiredArticleId, staleArticleId]}::integer[])
    `;
    expect(likes.count).toBe(0);
  });

  it("persists dismissal as a tombstone without adding a human like", async () => {
    const userId = userIds[1];
    const articleId = esgArticleIds[5];
    await insertSelection({ userId, domain: "esg", articleId });

    const result = await service.recordArticleAiFeedback(userId, "esg", articleId, "dismiss", 1);
    expect(result).toMatchObject({ humanLiked: false, pending: false, selection: { state: "dismissed", version: 2 } });
    const [likes] = await esg.$queryRaw<Array<{ count: number }>>`
      SELECT count(*)::int AS count FROM likes
      WHERE user_id = ${userId} AND content_type = 'article' AND content_id = ${articleId}
    `;
    expect(likes.count).toBe(0);
  });

  it("reconciles a Credit confirmation exactly once and leaves stale outbox work without a Credit like", async () => {
    const userId = userIds[0];
    const validArticleId = creditArticleIds[0];
    const staleArticleId = creditArticleIds[1];
    await insertSelection({ userId, domain: "credit", articleId: validArticleId });
    const pending = await service.recordArticleAiFeedback(userId, "credit", validArticleId, "confirm", 1);
    expect(pending).toMatchObject({ humanLiked: false, pending: true, selection: { pendingConfirmation: true, version: 1 } });
    const [before] = await credit.$queryRaw<Array<{ count: number }>>`
      SELECT count(*)::int AS count FROM likes
      WHERE user_id = ${userId} AND content_type = 'article' AND content_id = ${validArticleId}
    `;
    expect(before.count).toBe(0);

    const staleSelectionId = await insertSelection({
      userId,
      domain: "credit",
      articleId: staleArticleId,
      version: 2,
      pending: true,
    });
    await esg.$executeRaw`
      INSERT INTO article_ai_feedback (
        user_id, domain, article_id, selection_id, action, expected_version,
        status, idempotency_key
      ) VALUES (
        ${userId}, 'credit', ${staleArticleId}, ${staleSelectionId}::uuid,
        'confirm', 1, 'pending', ${`qa-stale-credit:${suffix}`}
      )
    `;

    await reconcileArticleAiFeedback();
    const [validLike] = await credit.$queryRaw<Array<{ count: number; created_at: Date | null }>>`
      SELECT count(*)::int AS count, min(created_at) AS created_at FROM likes
      WHERE user_id = ${userId} AND content_type = 'article' AND content_id = ${validArticleId}
    `;
    expect(validLike.count).toBe(1);
    const firstTimestamp = validLike.created_at?.toISOString();
    await reconcileArticleAiFeedback();
    const [afterRetry] = await credit.$queryRaw<Array<{ count: number; created_at: Date | null }>>`
      SELECT count(*)::int AS count, min(created_at) AS created_at FROM likes
      WHERE user_id = ${userId} AND content_type = 'article' AND content_id = ${validArticleId}
    `;
    expect(afterRetry).toEqual({ count: 1, created_at: validLike.created_at });
    expect(afterRetry.created_at?.toISOString()).toBe(firstTimestamp);

    const [selection] = await esg.$queryRaw<Array<{ state: string; version: number; pending_confirmation: boolean }>>`
      SELECT state, version, pending_confirmation FROM article_ai_selections
      WHERE user_id = ${userId} AND domain = 'credit' AND article_id = ${validArticleId}
    `;
    expect(selection).toEqual({ state: "confirmed", version: 2, pending_confirmation: false });
    const [staleFeedback] = await esg.$queryRaw<Array<{ status: string }>>`
      SELECT status FROM article_ai_feedback WHERE idempotency_key = ${`qa-stale-credit:${suffix}`}
    `;
    expect(staleFeedback.status).toBe("error");
    const [staleLikes] = await credit.$queryRaw<Array<{ count: number }>>`
      SELECT count(*)::int AS count FROM likes
      WHERE user_id = ${userId} AND content_type = 'article' AND content_id = ${staleArticleId}
    `;
    expect(staleLikes.count).toBe(0);
    expect(provider.request).not.toHaveBeenCalled();
  });

  it("runs the real ESG and Credit SQL pipelines without manufacturing likes and fences opt-out during provider work", async () => {
    const userId = userIds[1];
    const candidateIds = new Map<Domain, number>();

    for (const domain of ["esg", "credit"] as const) {
      for (let index = 0; index < 21; index += 1) {
        const isCandidate = index === 20;
        const title = domain === "esg"
          ? `Climate transition disclosure emissions evidence ${suffix} ${index}`
          : `Sovereign credit rating methodology outlook evidence ${suffix} ${index}`;
        const summary = domain === "esg"
          ? "Climate transition risk disclosure and emissions accounting"
          : "Sovereign credit rating methodology and rating outlook";
        const source = domain === "esg" ? "QA Climate Wire" : "QA Rating Wire";
        const url = `https://example.test/${suffix}/pipeline/${domain}/${index}`;
        let articleId: number;
        if (domain === "esg") {
          const [row] = await esg.$queryRaw<Array<{ id: number }>>`
            INSERT INTO esg_articles (title, summary, link, source, published)
            VALUES (${title}, ${summary}, ${url}, ${source}, ${now})
            RETURNING id
          `;
          articleId = row.id;
          esgArticleIds.push(articleId);
        } else {
          const content = "Credit fundamentals, sovereign risk, and rating action evidence";
          const [row] = await credit.$queryRaw<Array<{ id: number }>>`
            INSERT INTO credit_articles (title, summary, content, link, source, date, created_at, updated_at)
            VALUES (${title}, ${summary}, ${content}, ${url}, ${source}, ${now}, ${now}, ${now})
            RETURNING id
          `;
          articleId = row.id;
          creditArticleIds.push(articleId);
        }
        if (isCandidate) {
          candidateIds.set(domain, articleId);
        } else {
          const database = domain === "esg" ? esg : credit;
          await database.$executeRaw`
            INSERT INTO likes (user_id, content_type, content_id, created_at)
            VALUES (${userId}, 'article', ${articleId}, ${new Date(now.getTime() - index * 60_000)})
          `;
        }
      }
    }

    const esgPreference = await service.setArticleAiPreference(userId, "esg", true);
    const creditPreference = await service.setArticleAiPreference(userId, "credit", true);
    expect(esgPreference).toMatchObject({ enabled: true, settingsVersion: 1, profileSource: "personal" });
    expect(creditPreference).toMatchObject({ enabled: true, settingsVersion: 1, profileSource: "personal" });

    provider.request.mockReset();
    queue.throwIfCancelled.mockClear();
    provider.request.mockImplementation(async (
      profile: { domain: Domain },
      candidates: Array<{ id: number }>,
    ) => {
      const articleId = candidateIds.get(profile.domain);
      expect(articleId).toBeDefined();
      expect(candidates.some(candidate => candidate.id === articleId)).toBe(true);
      return {
        decisions: [{ articleId, action: "select", confidence: 0.92, reason: `QA ${profile.domain} match` }],
        model: "qa-provider-mock",
        inputTokens: 100,
        outputTokens: 20,
      };
    });

    const runDate = now.toISOString().slice(0, 10);
    const fakeJob = (domain: Domain, settingsVersion: number, date = runDate) => ({
      id: randomUUID(),
      jobType: domain === "esg" ? "article_ai_esg_v1" : "article_ai_credit_v1",
      userId,
      payload: { domain, settingsVersion, runDate: date },
      attempts: 1,
      maxAttempts: 2,
      leaseOwner: `qa-${suffix}`,
      cancelRequested: false,
    }) as unknown as Parameters<typeof runArticleAiJob>[0];

    for (const [domain, settingsVersion] of [
      ["esg", esgPreference.settingsVersion],
      ["credit", creditPreference.settingsVersion],
    ] as const) {
      const result = await runArticleAiJob(fakeJob(domain, settingsVersion));
      expect(result.result).toMatchObject({ status: "done", domain, selected: 1, model: "qa-provider-mock" });
      const [selection] = await esg.$queryRaw<Array<{ article_id: number; domain: string; state: string }>>`
        SELECT article_id, domain, state FROM article_ai_selections
        WHERE user_id = ${userId} AND domain = ${domain} AND article_id = ${candidateIds.get(domain)}
      `;
      expect(selection).toEqual({ article_id: candidateIds.get(domain), domain, state: "selected" });
    }
    expect(provider.request).toHaveBeenCalledTimes(2);
    expect(queue.throwIfCancelled).toHaveBeenCalled();

    const esgCandidate = candidateIds.get("esg")!;
    const creditCandidate = candidateIds.get("credit")!;
    const [esgCandidateLikes] = await esg.$queryRaw<Array<{ count: number }>>`
      SELECT count(*)::int AS count FROM likes
      WHERE user_id = ${userId} AND content_type = 'article' AND content_id = ${esgCandidate}
    `;
    const [creditCandidateLikes] = await credit.$queryRaw<Array<{ count: number }>>`
      SELECT count(*)::int AS count FROM likes
      WHERE user_id = ${userId} AND content_type = 'article' AND content_id = ${creditCandidate}
    `;
    expect(esgCandidateLikes.count).toBe(0);
    expect(creditCandidateLikes.count).toBe(0);

    const callsBeforeReplay = provider.request.mock.calls.length;
    for (const [domain, settingsVersion] of [
      ["esg", esgPreference.settingsVersion],
      ["credit", creditPreference.settingsVersion],
    ] as const) {
      expect((await runArticleAiJob(fakeJob(domain, settingsVersion))).result).toMatchObject({ status: "already_done", domain });
    }
    expect(provider.request).toHaveBeenCalledTimes(callsBeforeReplay);

    const optOutTitle = `Sovereign credit rating methodology fresh optout ${suffix}`;
    const optOutSummary = "Sovereign credit rating methodology and rating outlook";
    const optOutContent = "Credit fundamentals, sovereign risk, and rating action evidence";
    const optOutUrl = `https://example.test/${suffix}/pipeline/credit/optout`;
    const [optOutCandidate] = await credit.$queryRaw<Array<{ id: number }>>`
      INSERT INTO credit_articles (title, summary, content, link, source, date, created_at, updated_at)
      VALUES (${optOutTitle}, ${optOutSummary}, ${optOutContent}, ${optOutUrl}, 'QA Rating Wire', ${now}, ${now}, ${now})
      RETURNING id
    `;
    creditArticleIds.push(optOutCandidate.id);
    const disabled = await service.setArticleAiPreference(userId, "credit", false);
    const reenabled = await service.setArticleAiPreference(userId, "credit", true);
    expect(reenabled.settingsVersion).toBe(disabled.settingsVersion + 1);
    provider.request.mockImplementationOnce(async (
      profile: { domain: Domain },
      candidates: Array<{ id: number }>,
    ) => {
      expect(profile.domain).toBe("credit");
      expect(candidates.some(candidate => candidate.id === optOutCandidate.id)).toBe(true);
      await service.setArticleAiPreference(userId, "credit", false);
      return {
        decisions: [{ articleId: optOutCandidate.id, action: "select", confidence: 0.95, reason: "Must be fenced" }],
        model: "qa-provider-mock",
        inputTokens: 100,
        outputTokens: 20,
      };
    });
    expect((await runArticleAiJob(fakeJob("credit", reenabled.settingsVersion, runDate))).result).toMatchObject({ status: "stale_settings" });
    const [fencedSelection] = await esg.$queryRaw<Array<{ count: number }>>`
      SELECT count(*)::int AS count FROM article_ai_selections
      WHERE user_id = ${userId} AND domain = 'credit' AND article_id = ${optOutCandidate.id}
    `;
    const [fencedLike] = await credit.$queryRaw<Array<{ count: number }>>`
      SELECT count(*)::int AS count FROM likes
      WHERE user_id = ${userId} AND content_type = 'article' AND content_id = ${optOutCandidate.id}
    `;
    expect(fencedSelection.count).toBe(0);
    expect(fencedLike.count).toBe(0);
    const [staleRun] = await esg.$queryRaw<Array<{ status: string; completed_at: Date | null; error: string | null }>>`
      SELECT status, completed_at, error FROM article_ai_runs
      WHERE user_id = ${userId} AND domain = 'credit' AND run_date = ${runDate}::date
        AND settings_version = ${reenabled.settingsVersion}
    `;
    expect(staleRun.status).toBe("cancelled");
    expect(staleRun.completed_at).toBeInstanceOf(Date);
    expect(staleRun.error).toMatch(/settings changed/i);

    const callsBeforeExpiredReplay = provider.request.mock.calls.length;
    const pastRunDate = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
    for (let replay = 0; replay < 2; replay += 1) {
      expect((await runArticleAiJob(fakeJob("credit", reenabled.settingsVersion, pastRunDate))).result).toEqual({
        status: "expired_run",
        domain: "credit",
        runDate: pastRunDate,
      });
    }
    expect(provider.request).toHaveBeenCalledTimes(callsBeforeExpiredReplay);
  });
});
