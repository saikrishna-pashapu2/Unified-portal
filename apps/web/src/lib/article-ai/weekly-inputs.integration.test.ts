import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { getArticleAiWeeklyCalendar } from "./weekly-calendar";

const integration = process.env.RUN_DB_INTEGRATION_TESTS === "1" ? describe : describe.skip;
const marker = randomUUID();
const calendar = getArticleAiWeeklyCalendar("2099-02-02");
const previous = getArticleAiWeeklyCalendar("2099-01-26");
let esg: (typeof import("@esgcredit/db-esg"))["esgPrisma"];
let credit: (typeof import("@esgcredit/db-credit"))["creditPrisma"];
let load: (typeof import("./weekly-inputs"))["loadWeeklyManifestInputs"];
let userId: number;
const ids: { esg: number[]; credit: number[] } = { esg: [], credit: [] };
const missingId = 2_000_000_000 + Number.parseInt(marker.slice(0, 6), 16);
const assessmentIds: string[] = [];

integration("weekly input source database contracts", () => {
  beforeAll(async () => {
    for (const key of ["ESG_DATABASE_URL", "CREDIT_DATABASE_URL"] as const) {
      const url = new URL(process.env[key] ?? "");
      if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("Disposable loopback databases required");
    }
    ({ esgPrisma: esg } = await import("@esgcredit/db-esg"));
    ({ creditPrisma: credit } = await import("@esgcredit/db-credit"));
    ({ loadWeeklyManifestInputs: load } = await import("./weekly-inputs"));
    const user = await esg.users.create({ data: {
      username: `weekly-input-${marker}`, email: `weekly-input-${marker}@example.test`,
      password_hash: "fixture-only", is_active_db: false, team: null,
    } });
    userId = user.id;
    for (const domain of ["esg", "credit"] as const) {
      const assessmentId = randomUUID(); assessmentIds.push(assessmentId);
      await esg.$executeRaw`
        INSERT INTO article_ai_domain_assessments
          (id, domain, assessment_date, policy_version, source_start_at, status, coverage_json)
        VALUES (${assessmentId}::uuid, ${domain}, ${previous.targetWeekKey}::date, 3,
          ${previous.sourceStart}, 'error', '{"status":"incomplete"}'::jsonb)
      `;
      for (const [index, date, firstSeen] of [
        [0, "2098-01-01", "2098-01-01T12:00:00Z"],
        [1, "2099-01-30", "2099-01-30T19:59:00Z"],
        [2, "2099-01-30", "2099-01-30T20:01:00Z"],
        [3, "2099-01-24", "2099-01-24T12:00:00Z"],
        [4, "2099-01-23", "2099-01-23T12:00:00Z"],
        [5, null, "2099-01-29T12:00:00Z"],
        [6, null, "2099-01-29T12:00:00Z"],
      ] as const) {
        const url = `https://example.test/weekly-input/${marker}/${domain}/${index}`;
        const rows = domain === "esg"
          ? await esg.$queryRaw<Array<{ id: number }>>`
              INSERT INTO esg_articles(title, summary, link, source, published, save_time)
              VALUES ('Weekly evidence', 'Complete stored article content', ${url}, 'Fixture', ${date}::date,
                ${new Date(firstSeen)}::timestamptz AT TIME ZONE 'UTC') RETURNING id
            `
          : await credit.$queryRaw<Array<{ id: number }>>`
              INSERT INTO credit_articles(title, summary, content, link, source, date, created_at, save_time, updated_at)
              VALUES ('Weekly evidence', 'Complete stored article summary', 'Full credit text', ${url}, 'Fixture',
                ${date}::date, ${index === 6 ? null : new Date(firstSeen)}::timestamptz AT TIME ZONE 'UTC',
                ${new Date(firstSeen)}::timestamptz AT TIME ZONE 'UTC', '2099-01-30'::timestamp) RETURNING id
            `;
        ids[domain].push(rows[0].id);
      }
      const db = domain === "esg" ? esg : credit;
      for (const id of [ids[domain][0], missingId]) await db.$executeRaw`
        INSERT INTO likes(user_id, content_type, content_id, created_at)
        VALUES (${userId}, 'article', ${id}, '2098-01-01'::timestamp)
      `;
      await esg.$executeRaw`
        INSERT INTO article_ai_weekly_inputs (assessment_id, kind, domain, article_id, state, ordinal)
        VALUES (${assessmentId}::uuid, 'candidate', ${domain}, ${ids[domain][4]}, 'processed', 0)
      `;
    }
  });

  afterAll(async () => {
    if (esg && userId) {
      if (credit) await credit.$executeRaw`DELETE FROM likes WHERE user_id = ${userId}`;
      await esg.$executeRaw`DELETE FROM likes WHERE user_id = ${userId}`;
      if (ids.esg.length) await esg.$executeRaw`DELETE FROM esg_articles WHERE id = ANY(${ids.esg}::int[])`;
      if (ids.credit.length) await credit.$executeRaw`DELETE FROM credit_articles WHERE id = ANY(${ids.credit}::int[])`;
      if (assessmentIds.length) await esg.$executeRaw`DELETE FROM article_ai_domain_assessments WHERE id = ANY(${assessmentIds}::uuid[])`;
      await esg.users.delete({ where: { id: userId } });
    }
    await Promise.allSettled([esg?.$disconnect(), credit?.$disconnect()]);
  });

  it.each(["esg", "credit"] as const)("%s preserves inactive users' history, missing IDs, Friday dates and failed-cohort carryover", async (domain) => {
    const result = await load(domain, calendar, calendar.processingAt);
    expect(result.history.find((input) => input.articleId === ids[domain][0])?.exclusionReason).toBeNull();
    expect(result.history.find((input) => input.articleId === missingId)?.exclusionReason).toBe("article_missing");
    const picked = result.candidates.filter((input) => ids[domain].includes(input.articleId));
    const expected = [ids[domain][1], ids[domain][4], ids[domain][5], ...(domain === "esg" ? [ids[domain][6]] : [])];
    expect(picked.map((input) => input.articleId).sort((a, b) => a - b)).toEqual(expected.sort((a, b) => a - b));
    expect(picked.find((input) => input.articleId === ids[domain][1])?.publishedAt).toBe("2099-01-29T20:00:00.000Z");
    expect(picked.find((input) => input.articleId === ids[domain][4])?.carryoverFromWeek).toBe(previous.targetWeekKey);
    expect(result.coverage.historyTotal).toBe(result.coverage.historyResolved + result.coverage.historyExcluded);
  });

  it.each(["esg", "credit"] as const)("%s excludes prior candidates only after a fully ready cohort", async (domain) => {
    const assessmentId = assessmentIds[domain === "esg" ? 0 : 1];
    await esg.$executeRaw`
      UPDATE article_ai_domain_assessments SET status = 'ready', coverage_json = '{"status":"complete"}'::jsonb
      WHERE id = ${assessmentId}::uuid
    `;
    const result = await load(domain, calendar, calendar.processingAt);
    expect(result.candidates.some((input) => input.articleId === ids[domain][4])).toBe(false);
  });

  it.each(["esg", "credit"] as const)("%s rejects an oversized whole manifest before materializing article text", async (domain) => {
    if (domain === "esg") {
      await esg.$executeRaw`UPDATE esg_articles SET summary = repeat('x', 9000000) WHERE id = ${ids.esg[0]}`;
    } else {
      await credit.$executeRaw`UPDATE credit_articles SET content = repeat('x', 9000000) WHERE id = ${ids.credit[0]}`;
    }
    try {
      await expect(load(domain, calendar, calendar.processingAt)).rejects.toThrow(/worker memory budget/);
    } finally {
      if (domain === "esg") await esg.$executeRaw`UPDATE esg_articles SET summary = 'Complete stored article content' WHERE id = ${ids.esg[0]}`;
      else await credit.$executeRaw`UPDATE credit_articles SET content = 'Full credit text' WHERE id = ${ids.credit[0]}`;
    }
  });
});
