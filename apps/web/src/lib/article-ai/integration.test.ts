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
const targetWeekKey = "2026-11-16";
const now = new Date("2026-11-16T06:00:00Z");
const completedAt = new Date("2026-11-15T20:00:00Z");
const since = new Date("2026-11-09T00:00:00Z");
const until = new Date("2026-11-14T00:00:00Z");
const selectionExpiresAt = new Date("2026-11-23T00:00:00Z");
const digestWindow = { since, until, targetWeekKey };

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
    const { weeklyArticleContentHash } = await import("./weekly-inputs");
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
        true, true, true, false, false, ARRAY[]::text[], ARRAY[]::text[], 'monday', 9, 'Asia/Dubai', now())
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
    const publishedAt = "2026-11-15T20:00:00.000Z";
    const esgHash = weeklyArticleContentHash({ domain: "esg", articleId: esgArticle.id, title: `Shared ESG example ${suffix}`, summary: "Transition risk evidence.", content: null, source: "QA", url: `https://example.test/${suffix}/esg`, publishedAt });
    const creditHash = weeklyArticleContentHash({ domain: "credit", articleId: creditArticle.id, title: `Shared Credit example ${suffix}`, summary: "Credit evidence.", content: "Rating methodology evidence.", source: "QA", url: `https://example.test/${suffix}/credit`, publishedAt });
    await esg.$executeRaw`INSERT INTO likes (user_id, content_type, content_id, created_at) VALUES (${curator.id}, 'article', ${esgArticle.id}, ${now})`;
    await credit.$executeRaw`INSERT INTO likes (user_id, content_type, content_id, created_at) VALUES (${curator.id}, 'article', ${creditArticle.id}, ${now})`;

    for (const domain of ["esg", "credit"] as const) {
      const assessmentId = assessmentIds[domain];
      await esg.$executeRaw`
        INSERT INTO article_ai_domain_assessments
          (id, domain, assessment_date, policy_version, status, profile_source, history_count, completed_at,
           source_start_at, source_cutoff_at, processing_at, email_at, valid_until, phase, coverage_json)
        VALUES (${assessmentId}::uuid, ${domain}, ${targetWeekKey}::date, 3, 'ready', 'domain', 1, ${completedAt},
          ${since}, ${until}, '2026-11-13T20:15:00Z'::timestamptz, '2026-11-16T05:00:00Z'::timestamptz,
          '2026-11-23T00:00:00Z'::timestamptz, 'finalize', '{"status":"complete"}'::jsonb)
      `;
    }
    const [esgSelection] = await esg.$queryRaw<Array<{ id: string }>>`
      INSERT INTO article_ai_domain_selections
        (assessment_id, domain, article_id, reason, selected_at, expires_at, content_hash, relevance_score)
      VALUES (${assessmentIds.esg}::uuid, 'esg', ${esgArticle.id}, 'Shared ESG evidence.', ${now}, ${selectionExpiresAt},
        ${esgHash}, 0.9) RETURNING id::text
    `;
    const [creditSelection] = await esg.$queryRaw<Array<{ id: string }>>`
      INSERT INTO article_ai_domain_selections
        (assessment_id, domain, article_id, reason, selected_at, expires_at, content_hash, relevance_score)
      VALUES (${assessmentIds.credit}::uuid, 'credit', ${creditArticle.id}, 'Shared Credit evidence.', ${now}, ${selectionExpiresAt},
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
    const before = await service.getArticleAiDigestPicks(recipient, ["esg", "credit"], digestWindow, now);
    expect(before.map((pick) => pick.articleId).sort()).toEqual([...esgArticleIds, ...creditArticleIds].sort());
    await service.recordArticleAiFeedback(recipient, "esg", esgArticleIds[0], "dismiss", 1, sharedIds.esg);
    const afterDismiss = await service.getArticleAiDigestPicks(recipient, ["esg", "credit"], digestWindow, now);
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
    expect((await service.getArticleAiDigestPicks(other.id, ["esg"], digestWindow, now)).map((pick) => pick.articleId)).toEqual(esgArticleIds);
  });

  it("rejects stale shared IDs and reconciles Credit confirmation idempotently", async () => {
    const recipient = userIds[1];
    await expect(service.recordArticleAiFeedback(recipient, "esg", esgArticleIds[0], "confirm", 1, randomUUID())).rejects.toMatchObject({ status: 409 });
    const pending = await service.recordArticleAiFeedback(recipient, "credit", creditArticleIds[0], "confirm", 1, sharedIds.credit);
    expect(pending.pending).toBe(true);
    const pendingRetry = await service.recordArticleAiFeedback(recipient, "credit", creditArticleIds[0], "confirm", 1, sharedIds.credit);
    expect(pendingRetry).toMatchObject({ humanLiked: false, pending: true });
    const [pendingFeedback] = await esg.$queryRaw<Array<{ count: number }>>`
      SELECT count(*)::int AS count
      FROM article_ai_domain_feedback
      WHERE user_id = ${recipient} AND domain = 'credit' AND article_id = ${creditArticleIds[0]}
        AND domain_selection_id = ${sharedIds.credit}::uuid AND action = 'confirm'
    `;
    expect(pendingFeedback.count).toBe(1);
    await reconcileSharedFeedback();
    await reconcileSharedFeedback();
    const rolloverAssessmentId = randomUUID();
    rolloverAssessmentIds.push(rolloverAssessmentId);
    await esg.$executeRaw`
      INSERT INTO article_ai_domain_assessments
        (id, domain, assessment_date, policy_version, status, profile_source, history_count, completed_at,
         source_start_at, source_cutoff_at, processing_at, email_at, valid_until, phase, coverage_json)
      VALUES (${rolloverAssessmentId}::uuid, 'credit', '2026-11-23'::date,
        3, 'ready', 'domain', 1, ${now}, ${since}, ${until},
        '2026-11-21T20:15:00Z'::timestamptz, '2026-11-23T05:00:00Z'::timestamptz,
        '2026-11-30T00:00:00Z'::timestamptz, 'finalize', '{"status":"complete"}'::jsonb)
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
    const delayedWeekendPicks = await service.getArticleAiDigestPicks(
      recipient,
      ["credit"],
      digestWindow,
      new Date("2026-11-22T18:00:00Z"),
    );
    expect(delayedWeekendPicks).toHaveLength(1);
    expect(delayedWeekendPicks[0]).toMatchObject({
      articleId: creditArticleIds[0],
      sharedSelectionId: sharedIds.credit,
      targetWeekKey,
      assessmentDate: targetWeekKey,
    });

    const picksBeforeLateCompletion = await service.getArticleAiDigestPicks(recipient, ["credit"], digestWindow, now);
    expect(picksBeforeLateCompletion).toHaveLength(1);
    await esg.$executeRaw`
      UPDATE article_ai_domain_assessments
      SET completed_at = '2026-11-16T06:00:00Z'::timestamptz
      WHERE id = ${assessmentIds.credit}::uuid
    `;
    try {
      // 06:00Z is 10:00 Asia/Dubai, after the immutable Monday 09:00 email boundary.
      expect(await service.getArticleAiDigestPicks(recipient, ["credit"], digestWindow, now)).toEqual([]);
      expect(await esg.$transaction((tx) => service.filterArticleAiDigestPicksForCommit(tx, recipient, picksBeforeLateCompletion))).toEqual([]);
    } finally {
      await esg.$executeRaw`
        UPDATE article_ai_domain_assessments
        SET completed_at = ${completedAt}
        WHERE id = ${assessmentIds.credit}::uuid
      `;
    }
    // The prior cohort remains the authoritative snapshot for its own
    // Monday delivery window even after the next cohort becomes ready.
    const priorCohortPicks = await service.getArticleAiDigestPicks(recipient, ["credit"], digestWindow, now);
    expect(priorCohortPicks.map((pick) => pick.targetWeekKey)).toEqual([targetWeekKey]);
    expect(await esg.$transaction((tx) => service.filterArticleAiDigestPicksForCommit(tx, recipient, priorCohortPicks))).toHaveLength(1);
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

  it("keeps full DATE-based hashes in parity for ESG and Credit and rejects tail changes", async () => {
    vi.stubEnv("ARTICLE_AI_EMAIL_ENABLED", "true");
    const hashUser = await esg.users.create({ data: {
      username: `shared-hash-${suffix}`, email: `shared-hash-${suffix}@example.test`, password_hash: "not-a-real-password",
      team: null, is_active_db: true,
    } });
    userIds.push(hashUser.id);
    await esg.$executeRaw`
      INSERT INTO alert_preferences
        (user_id, domain, domains, alert_type, is_active, email_enabled, alert_articles,
         digest_day, digest_hour, timezone)
      VALUES (${hashUser.id}, 'esg', ARRAY['esg','credit']::varchar[], 'weekly_digest', true, true, true,
        'monday', 9, 'Asia/Dubai')
    `;
    await service.setArticleAiPreference(hashUser.id, "esg", true);
    await service.setArticleAiPreference(hashUser.id, "credit", true);

    const baseline = await service.getArticleAiDigestPicks(hashUser.id, ["esg", "credit"], digestWindow, now);
    expect(baseline.map((pick) => `${pick.domain}:${pick.articleId}`).sort()).toEqual([
      `credit:${creditArticleIds[0]}`,
      `esg:${esgArticleIds[0]}`,
    ]);

    try {
      await esg.$executeRaw`
        UPDATE esg_articles
        SET summary = 'Transition risk evidence. Tail changed after the weekly model snapshot.'
        WHERE id = ${esgArticleIds[0]}
      `;
      await credit.$executeRaw`
        UPDATE credit_articles
        SET content = 'Rating methodology evidence. Tail changed after the weekly model snapshot.'
        WHERE id = ${creditArticleIds[0]}
      `;
      const afterTailChange = await service.getArticleAiDigestPicks(hashUser.id, ["esg", "credit"], digestWindow, now);
      expect(afterTailChange).toEqual([]);
    } finally {
      await esg.$executeRaw`
        UPDATE esg_articles SET summary = 'Transition risk evidence.' WHERE id = ${esgArticleIds[0]}
      `;
      await credit.$executeRaw`
        UPDATE credit_articles SET content = 'Rating methodology evidence.' WHERE id = ${creditArticleIds[0]}
      `;
    }
  });

  it("rechecks a private dismissal after waiting for the shared selection lock", async () => {
    vi.stubEnv("ARTICLE_AI_EMAIL_ENABLED", "true");
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
    const picks = await service.getArticleAiDigestPicks(user.id, ["esg"], digestWindow, now);
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
