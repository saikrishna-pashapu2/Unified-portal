import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const integration = process.env.RUN_DB_INTEGRATION_TESTS === "1" ? describe : describe.skip;
vi.mock("server-only", () => ({}));

let esg: (typeof import("@esgcredit/db-esg"))["esgPrisma"];
let credit: (typeof import("@esgcredit/db-credit"))["creditPrisma"];
let service: typeof import("./service");
let reconcileSharedFeedback: typeof import("./service-v2")["reconcileDomainArticleAiFeedbackV2"];

const suffix = randomUUID();
const userIds: number[] = [];
const esgArticleIds: number[] = [];
const creditArticleIds: number[] = [];
const assessmentIds = { esg: randomUUID(), credit: randomUUID() };
const rolloverAssessmentIds: string[] = [];
const sharedIds = { esg: "", credit: "" };
const now = new Date();
const since = new Date(now.getTime() - 86_400_000);
const until = new Date(now.getTime() + 86_400_000);

integration("shared domain article AI service", () => {
  beforeAll(async () => {
    for (const key of ["ESG_DATABASE_URL", "CREDIT_DATABASE_URL"]) {
      const url = new URL(process.env[key] ?? "");
      if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Requires disposable loopback databases");
    }
    ({ esgPrisma: esg } = await import("@esgcredit/db-esg"));
    ({ creditPrisma: credit } = await import("@esgcredit/db-credit"));
    service = await import("./service");
    ({ reconcileDomainArticleAiFeedbackV2: reconcileSharedFeedback } = await import("./service-v2"));
    const { normalizeArticle } = await import("./policy");
    vi.stubEnv("ARTICLE_AI_ENABLED", "true");
    vi.stubEnv("ARTICLE_AI_EMAIL_ENABLED", "true");

    const curator = await esg.users.create({ data: {
      username: `shared-curator-${suffix}`, email: `shared-curator-${suffix}@example.test`, password_hash: "not-a-real-password",
      team: `curator-${suffix}`, is_active_db: true,
    } });
    const recipient = await esg.users.create({ data: {
      username: `shared-recipient-${suffix}`, email: `shared-recipient-${suffix}@example.test`, password_hash: "not-a-real-password",
      team: null, is_active_db: true,
    } });
    userIds.push(curator.id, recipient.id);
    await esg.$executeRaw`
      INSERT INTO alert_preferences
        (user_id, domain, domains, alert_name, alert_type, is_active, email_enabled,
         alert_articles, alert_events, alert_publications, sources, keywords,
         digest_day, digest_hour, timezone, created_at)
      VALUES (${recipient.id}, 'esg', ARRAY['esg','credit']::varchar[], 'Shared AI QA', 'weekly_digest',
        true, true, true, false, false, ARRAY[]::text[], ARRAY[]::text[], 'monday', 9, 'UTC', now())
    `;

    const [esgArticle] = await esg.$queryRaw<Array<{ id: number }>>`
      INSERT INTO esg_articles (title, summary, link, source, published)
      VALUES (${`Shared ESG example ${suffix}`}, 'Transition risk evidence.', ${`https://example.test/${suffix}/esg`}, 'QA', ${now}::date)
      RETURNING id
    `;
    const [creditArticle] = await credit.$queryRaw<Array<{ id: number }>>`
      INSERT INTO credit_articles (title, summary, content, link, source, date)
      VALUES (${`Shared Credit example ${suffix}`}, 'Credit evidence.', 'Rating methodology evidence.', ${`https://example.test/${suffix}/credit`}, 'QA', ${now}::date)
      RETURNING id
    `;
    esgArticleIds.push(esgArticle.id);
    creditArticleIds.push(creditArticle.id);
    const esgHash = normalizeArticle({ id: esgArticle.id, title: `Shared ESG example ${suffix}`, summary: "Transition risk evidence.", content: null, source: "QA", url: `https://example.test/${suffix}/esg`, publishedAt: now }).contentHash;
    const creditHash = normalizeArticle({ id: creditArticle.id, title: `Shared Credit example ${suffix}`, summary: "Credit evidence.", content: "Rating methodology evidence.", source: "QA", url: `https://example.test/${suffix}/credit`, publishedAt: now }).contentHash;
    await esg.$executeRaw`INSERT INTO likes (user_id, content_type, content_id, created_at) VALUES (${curator.id}, 'article', ${esgArticle.id}, ${now})`;
    await credit.$executeRaw`INSERT INTO likes (user_id, content_type, content_id, created_at) VALUES (${curator.id}, 'article', ${creditArticle.id}, ${now})`;

    for (const domain of ["esg", "credit"] as const) {
      const assessmentId = assessmentIds[domain];
      await esg.$executeRaw`
        INSERT INTO article_ai_domain_assessments
          (id, domain, assessment_date, policy_version, status, profile_source, history_count, completed_at)
        VALUES (${assessmentId}::uuid, ${domain}, ${now}::date, 2, 'ready', 'domain', 1, ${now})
      `;
    }
    const [esgSelection] = await esg.$queryRaw<Array<{ id: string }>>`
      INSERT INTO article_ai_domain_selections
        (assessment_id, domain, article_id, reason, selected_at, expires_at, content_hash, relevance_score)
      VALUES (${assessmentIds.esg}::uuid, 'esg', ${esgArticle.id}, 'Shared ESG evidence.', ${now}, ${until},
        ${esgHash}, 0.9) RETURNING id::text
    `;
    const [creditSelection] = await esg.$queryRaw<Array<{ id: string }>>`
      INSERT INTO article_ai_domain_selections
        (assessment_id, domain, article_id, reason, selected_at, expires_at, content_hash, relevance_score)
      VALUES (${assessmentIds.credit}::uuid, 'credit', ${creditArticle.id}, 'Shared Credit evidence.', ${now}, ${until},
        ${creditHash}, 0.9) RETURNING id::text
    `;
    sharedIds.esg = esgSelection.id;
    sharedIds.credit = creditSelection.id;
  });

  afterAll(async () => {
    if (esg) {
      await esg.$executeRaw`DELETE FROM article_ai_domain_assessments WHERE id = ANY(ARRAY[${assessmentIds.esg}::uuid, ${assessmentIds.credit}::uuid])`;
      if (rolloverAssessmentIds.length) await esg.$executeRaw`DELETE FROM article_ai_domain_assessments WHERE id = ANY(${rolloverAssessmentIds}::uuid[])`;
      if (userIds.length) await esg.$executeRaw`DELETE FROM likes WHERE user_id = ANY(${userIds}::int[])`;
      if (userIds.length) await esg.users.deleteMany({ where: { id: { in: userIds } } });
      if (esgArticleIds.length) await esg.$executeRaw`DELETE FROM esg_articles WHERE id = ANY(${esgArticleIds}::int[])`;
    }
    if (credit) {
      if (userIds.length) await credit.$executeRaw`DELETE FROM likes WHERE user_id = ANY(${userIds}::int[])`;
      if (creditArticleIds.length) await credit.$executeRaw`DELETE FROM credit_articles WHERE id = ANY(${creditArticleIds}::int[])`;
    }
    await Promise.all([esg?.$disconnect(), credit?.$disconnect()]);
    vi.unstubAllEnvs();
  });

  it("uses the same shared picks for a recipient with no personal likes or team", async () => {
    const recipient = userIds[1];
    const preference = await service.getArticleAiPreference(recipient, "esg");
    expect(preference.enabled).toBe(false);
    expect(preference.historyCount).toBe(1);
    expect(preference.profileSource).toBe("domain");
    const esgSelections = await service.getArticleAiSelections(recipient, "esg", esgArticleIds);
    const creditSelections = await service.getArticleAiSelections(recipient, "credit", creditArticleIds);
    expect(esgSelections[0].sharedSelectionId).toBe(sharedIds.esg);
    expect(creditSelections[0].sharedSelectionId).toBe(sharedIds.credit);
    const [personal] = await esg.$queryRaw<Array<{ count: number }>>`SELECT count(*)::int AS count FROM likes WHERE user_id = ${recipient} AND content_type = 'article'`;
    expect(personal.count).toBe(0);
  });

  it("keeps feedback private and supports cross-domain email inclusion", async () => {
    const recipient = userIds[1];
    await service.setArticleAiPreference(recipient, "esg", true);
    await service.setArticleAiPreference(recipient, "credit", true);
    const before = await service.getArticleAiDigestPicks(recipient, ["esg", "credit"], { since, until }, now);
    expect(before.map((pick) => pick.articleId).sort()).toEqual([...esgArticleIds, ...creditArticleIds].sort());
    await service.recordArticleAiFeedback(recipient, "esg", esgArticleIds[0], "dismiss", 1, sharedIds.esg);
    const afterDismiss = await service.getArticleAiDigestPicks(recipient, ["esg", "credit"], { since, until }, now);
    expect(afterDismiss.map((pick) => pick.articleId)).toEqual(creditArticleIds);
    const other = await esg.users.create({ data: {
      username: `shared-other-${suffix}`, email: `shared-other-${suffix}@example.test`, password_hash: "not-a-real-password",
      team: `other-${suffix}`, is_active_db: true,
    } });
    userIds.push(other.id);
    await esg.$executeRaw`
      INSERT INTO alert_preferences (user_id, domain, domains, alert_type, is_active, email_enabled, alert_articles)
      VALUES (${other.id}, 'esg', ARRAY['esg']::varchar[], 'weekly_digest', true, true, true)
    `;
    await service.setArticleAiPreference(other.id, "esg", true);
    expect((await service.getArticleAiDigestPicks(other.id, ["esg"], { since, until }, now)).map((pick) => pick.articleId)).toEqual(esgArticleIds);
  });

  it("rejects stale shared IDs and reconciles Credit confirmation idempotently", async () => {
    const recipient = userIds[1];
    await expect(service.recordArticleAiFeedback(recipient, "esg", esgArticleIds[0], "confirm", 1, randomUUID())).rejects.toMatchObject({ status: 409 });
    const pending = await service.recordArticleAiFeedback(recipient, "credit", creditArticleIds[0], "confirm", 1, sharedIds.credit);
    expect(pending.pending).toBe(true);
    await reconcileSharedFeedback();
    await reconcileSharedFeedback();
    const rolloverAssessmentId = randomUUID();
    rolloverAssessmentIds.push(rolloverAssessmentId);
    await esg.$executeRaw`
      INSERT INTO article_ai_domain_assessments
        (id, domain, assessment_date, policy_version, status, profile_source, history_count, completed_at)
      VALUES (${rolloverAssessmentId}::uuid, 'credit', ${(new Date(now.getTime() + 86_400_000)).toISOString().slice(0, 10)}::date,
        2, 'ready', 'domain', 1, ${now})
    `;
    const [{ content_hash: creditHash }] = await esg.$queryRaw<Array<{ content_hash: string }>>`
      SELECT content_hash FROM article_ai_domain_selections WHERE id = ${sharedIds.credit}::uuid
    `;
    const [rolloverSelection] = await esg.$queryRaw<Array<{ id: string }>>`
      INSERT INTO article_ai_domain_selections
        (assessment_id, domain, article_id, reason, selected_at, expires_at, content_hash, relevance_score)
      VALUES (${rolloverAssessmentId}::uuid, 'credit', ${creditArticleIds[0]}, 'Rollover Credit evidence.', ${now}, ${new Date(now.getTime() + 2 * 86_400_000)}, ${creditHash}, 0.95)
      RETURNING id::text
    `;
    // The old UUID is stale for new actions, but a completed retry remains idempotent.
    await expect(service.recordArticleAiFeedback(recipient, "credit", creditArticleIds[0], "confirm", 1, sharedIds.credit))
      .resolves.toMatchObject({ humanLiked: true, pending: false });
    const rolloverUser = await esg.users.create({ data: {
      username: `shared-rollover-${suffix}`, email: `shared-rollover-${suffix}@example.test`, password_hash: "not-a-real-password",
      team: null, is_active_db: true,
    } });
    userIds.push(rolloverUser.id);
    await expect(service.recordArticleAiFeedback(rolloverUser.id, "credit", creditArticleIds[0], "confirm", 1, sharedIds.credit))
      .rejects.toMatchObject({ status: 409 });
    const rolloverPending = await service.recordArticleAiFeedback(rolloverUser.id, "credit", creditArticleIds[0], "confirm", 1, rolloverSelection.id);
    expect(rolloverPending.pending).toBe(true);
    const [creditLike] = await credit.$queryRaw<Array<{ count: number }>>`
      SELECT count(*)::int AS count FROM likes WHERE user_id = ${recipient} AND content_type = 'article' AND content_id = ${creditArticleIds[0]}
    `;
    expect(creditLike.count).toBe(1);
  });

  it("rechecks a private dismissal after waiting for the shared selection lock", async () => {
    const user = await esg.users.create({ data: {
      username: `shared-lock-${suffix}`, email: `shared-lock-${suffix}@example.test`, password_hash: "not-a-real-password",
      team: null, is_active_db: true,
    } });
    userIds.push(user.id);
    await esg.$executeRaw`
      INSERT INTO alert_preferences (user_id, domain, domains, alert_type, is_active, email_enabled, alert_articles)
      VALUES (${user.id}, 'esg', ARRAY['esg']::varchar[], 'weekly_digest', true, true, true)
    `;
    await service.setArticleAiPreference(user.id, "esg", true);
    const picks = await service.getArticleAiDigestPicks(user.id, ["esg"], { since, until }, now);
    expect(picks).toHaveLength(1);

    let signalInserted!: () => void;
    const inserted = new Promise<void>((resolve) => { signalInserted = resolve; });
    let releaseDismissal!: () => void;
    const hold = new Promise<void>((resolve) => { releaseDismissal = resolve; });
    const dismissalTx = esg.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM article_ai_domain_selections WHERE id = ${sharedIds.esg}::uuid FOR UPDATE`;
      await tx.$executeRaw`
        INSERT INTO article_ai_user_selections
          (user_id, domain_selection_id, domain, article_id, state, version, pending_confirmation)
        VALUES (${user.id}, ${sharedIds.esg}::uuid, 'esg', ${esgArticleIds[0]}, 'dismissed', 2, false)
      `;
      signalInserted();
      await hold;
    });

    let filterPromise: Promise<unknown[]> | null = null;
    try {
      await inserted;
      filterPromise = esg.$transaction((tx) => service.filterArticleAiDigestPicksForCommit(tx, user.id, picks));
      // Give the commit-filter transaction time to enter its first statement
      // and wait on the feedback transaction's ds lock.
      await new Promise((resolve) => setTimeout(resolve, 100));
      releaseDismissal();
      const [filtered] = await Promise.all([filterPromise, dismissalTx]);
      expect(filtered).toEqual([]);
    } finally {
      releaseDismissal();
      await dismissalTx.catch(() => undefined);
    }
  });
});
