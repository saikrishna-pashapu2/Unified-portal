import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { getArticleAiDailyCalendar } from "./daily-calendar";

vi.mock("server-only", () => ({}));

it.runIf(process.env.RUN_DB_INTEGRATION_TESTS === "1")("reads late arrivals and excludes pre-rollout articles from both real source databases", async () => {
  for (const key of ["ESG_DATABASE_URL", "CREDIT_DATABASE_URL"]) {
    if (!["localhost", "127.0.0.1"].includes(new URL(process.env[key] ?? "").hostname)) {
      throw new Error("Requires disposable loopback databases");
    }
  }
  const { esgPrisma } = await import("@esgcredit/db-esg");
  const { creditPrisma } = await import("@esgcredit/db-credit");
  const { loadDailyManifestInputs } = await import("./daily-inputs");
  const calendar = getArticleAiDailyCalendar("2097-08-09");
  const title = "Late article " + randomUUID();
  const url = "https://example.test/" + randomUUID();
  const learningTitle = "Recovered ESG learning example " + randomUUID();
  const learningUrl = "https://example.test/" + randomUUID();
  let learningArticleId: number | null = null;
  try {
    await esgPrisma.$executeRaw`INSERT INTO esg_articles (title,link,published,save_time)
      VALUES (${title},${url},'2097-06-01','2097-08-09 00:30:00'),(${title},${url + "/old"},'2097-08-08','2097-08-08 00:30:00')`;
    const learningRows = await esgPrisma.$queryRaw<Array<{ id: number }>>`
      INSERT INTO esg_articles (title,link,published,save_time)
      VALUES (${learningTitle},${learningUrl},'2097-08-09','2097-08-01 00:30:00')
      RETURNING id
    `;
    learningArticleId = Number(learningRows[0]?.id);
    await esgPrisma.$executeRaw`
      INSERT INTO article_ai_esg_learning_examples (article_id)
      VALUES (${learningArticleId})
    `;
    await creditPrisma.$executeRaw`INSERT INTO credit_articles (title,link,date,created_at)
      VALUES (${title},${url},'2097-06-01','2097-08-09 00:30:00'),(${title},${url + "/old"},'2097-08-08','2097-08-08 00:30:00')`;
    for (const domain of ["esg", "credit"] as const) {
      const manifest = await loadDailyManifestInputs(domain, calendar, calendar.processingAt);
      expect(manifest.candidates.filter(row => row.title === title)).toEqual([
        expect.objectContaining({ domain, url, exclusionReason: null, firstSeenKnown: true }),
      ]);
      if (domain === "esg") {
        expect(manifest.history).toContainEqual(expect.objectContaining({
          domain: "esg",
          articleId: learningArticleId,
          title: learningTitle,
          url: learningUrl,
          exclusionReason: null,
        }));
        expect(manifest.candidates.some(row => row.title === learningTitle)).toBe(false);
      }
    }
  } finally {
    if (learningArticleId) {
      await esgPrisma.$executeRaw`DELETE FROM article_ai_esg_learning_examples WHERE article_id=${learningArticleId}`;
    }
    await esgPrisma.$executeRaw`DELETE FROM esg_articles WHERE title=${learningTitle}`;
    await esgPrisma.$executeRaw`DELETE FROM esg_articles WHERE title=${title}`;
    await creditPrisma.$executeRaw`DELETE FROM credit_articles WHERE title=${title}`;
  }
});
