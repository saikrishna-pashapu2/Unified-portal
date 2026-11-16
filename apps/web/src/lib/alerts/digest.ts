/**
 * Digest Generation Library
 * Handles weekly and daily digest creation
 */

import { esgPrisma } from "@esgcredit/db-esg";
import { getPrisma } from "@/lib/db";

export type DigestArticle = {
  id: number;
  title: string | null;
  source: string | null;
  link: string | null;
  date: Date | null;
  likes?: number;
  matched_keywords?: any;
};

export type DigestData = {
  articles: DigestArticle[];
  events: any[];
  publications: any[];
  totalItems: number;
};

/**
 * Get team members for a user
 * Note: Since 'team' column doesn't exist in users table,
 * this returns all users as potential team members
 * You can add a 'team' column later if needed
 */
export async function getTeamMembers(userId: number): Promise<number[]> {
  // Since team column doesn't exist, return all active users except current user
  const members = await esgPrisma.$queryRaw<{ id: number }[]>`
    SELECT id FROM users
    WHERE id != ${userId}
      AND is_active_db = true
    LIMIT 100
  `;

  return members.map((m) => m.id);
}

/**
 * Generate weekly digest content
 * Gets articles/events/publications liked by team members in the last 7 days
 */
export async function generateWeeklyDigest(
  userId: number,
  domain: "esg" | "credit",
  preferences: any
): Promise<DigestData> {
  const prisma = getPrisma(domain);
  const teamIds = await getTeamMembers(userId);

  if (teamIds.length === 0) {
    return { articles: [], events: [], publications: [], totalItems: 0 };
  }

  const from = new Date();
  from.setDate(from.getDate() - 7);

  const digest: DigestData = {
    articles: [],
    events: [],
    publications: [],
    totalItems: 0,
  };

  // Get liked articles
  if (preferences?.alert_articles !== false) {
    if (domain === "esg") {
      digest.articles = await prisma.$queryRaw<DigestArticle[]>`
        SELECT a.id, a.title, a.source, a.link,
               COALESCE(a.published, a.save_time) AS date,
               a.matched_keywords,
               COUNT(l.*)::int AS likes
        FROM likes l
        JOIN esg_articles a ON a.id = l.content_id
        WHERE l.user_id = ANY(${teamIds})
          AND l.created_at >= ${from}
          AND COALESCE(l.content_type, 'article') = 'article'
        GROUP BY a.id
        ORDER BY likes DESC, date DESC
        LIMIT 20
      `;
    } else {
      digest.articles = await prisma.$queryRaw<DigestArticle[]>`
        SELECT a.id, a.title, a.source, a.link, a.date,
               a.matched_keywords,
               COUNT(l.*)::int AS likes
        FROM likes l
        JOIN credit_articles a ON a.id = l.content_id
        WHERE l.user_id = ANY(${teamIds})
          AND l.created_at >= ${from}
          AND COALESCE(l.content_type, 'article') = 'article'
        GROUP BY a.id
        ORDER BY likes DESC, a.date DESC
        LIMIT 20
      `;
    }
  }

  // Get liked events
  if (preferences?.alert_events !== false) {
    const eventRows = await prisma.$queryRaw<any[]>`
      SELECT e.*, COUNT(l.*)::int AS likes
      FROM likes l
      JOIN events e ON e.id = l.content_id
      WHERE l.user_id = ANY(${teamIds})
        AND l.created_at >= ${from}
        AND l.content_type = 'event'
      GROUP BY e.id
      ORDER BY likes DESC
      LIMIT 10
    `;
    digest.events = eventRows;
  }

  // Get liked publications
  if (preferences?.alert_publications !== false) {
    const pubRows = await prisma.$queryRaw<any[]>`
      SELECT p.*, COUNT(l.*)::int AS likes
      FROM likes l
      JOIN publications p ON p.id = l.content_id
      WHERE l.user_id = ANY(${teamIds})
        AND l.created_at >= ${from}
        AND l.content_type = 'publication'
      GROUP BY p.id
      ORDER BY likes DESC
      LIMIT 10
    `;
    digest.publications = pubRows;
  }

  digest.totalItems =
    digest.articles.length + digest.events.length + digest.publications.length;

  return digest;
}

/**
 * Generate daily digest content
 * Gets new articles/events/publications from the last 24 hours
 */
export async function generateDailyDigest(
  userId: number,
  domain: "esg" | "credit",
  preferences: any
): Promise<DigestData> {
  const prisma = getPrisma(domain);
  const from = new Date();
  from.setHours(from.getHours() - 24);

  const digest: DigestData = {
    articles: [],
    events: [],
    publications: [],
    totalItems: 0,
  };

  // Get new articles
  if (preferences?.alert_articles !== false) {
    if (domain === "esg") {
      let query = `
        SELECT id, title, source, link,
               COALESCE(published, save_time) AS date,
               matched_keywords
        FROM esg_articles
        WHERE COALESCE(published, save_time) >= $1
      `;

      // Apply source filter
      if (preferences?.sources && preferences.sources.length > 0) {
        query += ` AND source = ANY($2)`;
      }

      query += ` ORDER BY COALESCE(published, save_time) DESC LIMIT 20`;

      if (preferences?.sources && preferences.sources.length > 0) {
        digest.articles = await prisma.$queryRawUnsafe<DigestArticle[]>(
          query,
          from,
          preferences.sources
        );
      } else {
        digest.articles = await prisma.$queryRawUnsafe<DigestArticle[]>(
          query,
          from
        );
      }
    } else {
      let query = `
        SELECT id, title, source, link, date, matched_keywords
        FROM credit_articles
        WHERE date >= $1
      `;

      if (preferences?.sources && preferences.sources.length > 0) {
        query += ` AND source = ANY($2)`;
      }

      query += ` ORDER BY date DESC LIMIT 20`;

      if (preferences?.sources && preferences.sources.length > 0) {
        digest.articles = await prisma.$queryRawUnsafe<DigestArticle[]>(
          query,
          from,
          preferences.sources
        );
      } else {
        digest.articles = await prisma.$queryRawUnsafe<DigestArticle[]>(
          query,
          from
        );
      }
    }
  }

  // Filter by keywords if specified
  if (preferences?.keywords && preferences.keywords.length > 0) {
    const keywords = preferences.keywords.map((k: string) => k.toLowerCase());
    digest.articles = digest.articles.filter((article) => {
      const title = (article.title || "").toLowerCase();
      return keywords.some((kw: string) => title.includes(kw));
    });
  }

  // Get new events
  if (preferences?.alert_events !== false) {
    if (domain === "esg") {
      digest.events = await prisma.$queryRaw<any[]>`
        SELECT * FROM events
        WHERE COALESCE(start_date, created_at) >= ${from}
        ORDER BY start_date ASC
        LIMIT 10
      `;
    } else {
      digest.events = await prisma.$queryRaw<any[]>`
        SELECT * FROM events
        WHERE COALESCE(date, created_at) >= ${from}
        ORDER BY date ASC
        LIMIT 10
      `;
    }
  }

  // Get new publications
  if (preferences?.alert_publications !== false) {
    if (domain === "esg") {
      digest.publications = await prisma.$queryRaw<any[]>`
        SELECT * FROM publications
        WHERE COALESCE(published, save_time) >= ${from}
        ORDER BY COALESCE(published, save_time) DESC
        LIMIT 10
      `;
    } else {
      digest.publications = await prisma.$queryRaw<any[]>`
        SELECT * FROM publications
        WHERE COALESCE(date, created_at) >= ${from}
        ORDER BY COALESCE(date, created_at) DESC
        LIMIT 10
      `;
    }
  }

  digest.totalItems =
    digest.articles.length + digest.events.length + digest.publications.length;

  return digest;
}

/**
 * Queue digest emails for all users with enabled digests
 */
export async function queueWeeklyDigests(): Promise<number> {
  // Compatibility entrypoint: use the same due window and permanent delivery key.
  const { queueDueArticleWeeklyDigests } = await import("./article-weekly");
  return (await queueDueArticleWeeklyDigests()).queued;
}

/**
 * Queue daily digests for users (called hourly, checks digest_hour)
 */
export async function queueDailyDigests(): Promise<number> {
  const currentHour = new Date().getHours();

  // Get users whose digest_hour matches current hour
  const users = await esgPrisma.$queryRaw<any[]>`
    SELECT ap.*, u.email, u.username, u.first_name, u.last_name
    FROM alert_preferences ap
    JOIN users u ON u.id = ap.user_id
    WHERE ap.daily_digest = true
      AND ap.email_enabled = true
      AND ap.digest_hour = ${currentHour}
  `;

  let queued = 0;

  for (const user of users) {
    try {
      const digest = await generateDailyDigest(
        user.user_id,
        user.domain,
        user
      );

      if (digest.totalItems === 0) {
        console.log(`Skipping user ${user.user_id} - no new content`);
        continue;
      }

      const emailHtml = generateDailyDigestHTML(user, digest, user.domain);
      const emailTo = user.email_address || user.email;

      await esgPrisma.$queryRaw`
        INSERT INTO email_queue (
          user_id, email_to, email_subject, email_body, email_html,
          priority, scheduled_for, status, alert_type, domain
        ) VALUES (
          ${user.user_id},
          ${emailTo},
          ${"Daily Digest - " + user.domain.toUpperCase() + " Portal"},
          ${"Your daily digest of new content"},
          ${emailHtml},
          5,
          NOW(),
          'queued',
          'daily_digest',
          ${user.domain}
        )
      `;

      queued++;
    } catch (error) {
      console.error(`Error queuing digest for user ${user.user_id}:`, error);
    }
  }

  console.log(`📧 Queued ${queued} daily digest emails`);
  return queued;
}

// Import email templates
import {
  generateDailyDigestHTML,
} from "./email-templates";
