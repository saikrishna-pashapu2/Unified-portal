import { esgPrisma } from "@esgcredit/db-esg";
import { creditPrisma } from "@esgcredit/db-credit";
import type { ArticleAiDomain } from "@/lib/article-ai/types";
import type { WeeklyArticleItem } from "./article-weekly-policy";

export interface WeeklyArticleAlert {
  id: number;
  user_id: number;
  domain: string;
  domains: string[];
  email: string | null;
  email_address: string | null;
  first_name: string | null;
  last_name: string | null;
  team: string | null;
  alert_name: string | null;
  digest_day: string | null;
  digest_hour: number | null;
  timezone: string | null;
  last_sent_at: Date | null;
  created_at: Date | null;
  alert_articles: boolean | null;
  alert_events: boolean | null;
  alert_publications: boolean | null;
  sources: string[];
  keywords: string[];
}

export function listWeeklyArticleAlerts(): Promise<WeeklyArticleAlert[]> {
  return esgPrisma.$queryRaw<WeeklyArticleAlert[]>`
    SELECT ap.*, u.email, u.first_name, u.last_name, u.team
    FROM alert_preferences ap JOIN users u ON u.id = ap.user_id
    WHERE ap.alert_type = 'weekly_digest' AND ap.is_active = true
      AND ap.email_enabled = true AND u.is_active_db = true
      AND COALESCE(u.email_notifications, true) = true
    ORDER BY ap.id
  `;
}

// Identifiers are fixed application constants; all input values remain parameters.
const SOURCES = {
  esg: {
    article: { table: 'esg_articles', title: 'title', url: 'link', date: 'COALESCE(a.published, a.save_time)' },
    event: { table: 'events', title: 'event_name', url: 'event_url', date: 'a.start_date' },
    publication: { table: 'publications', title: 'title', url: 'link', date: 'a.published' },
  },
  credit: {
    article: { table: 'credit_articles', title: 'title', url: 'COALESCE(a.link, a.url)', date: 'a.date' },
    event: { table: 'events', title: 'title', url: 'link', date: 'a.date' },
    publication: { table: 'publications', title: 'title', url: 'link', date: 'a.date' },
  },
} as const;

export async function getHumanWeeklyItems(
  alert: WeeklyArticleAlert,
  domains: ArticleAiDomain[],
  window: { since: Date; until: Date },
): Promise<{ items: WeeklyArticleItem[]; unavailableDomains: ArticleAiDomain[] }> {
  // No inferred all-users team: unassigned users retain access to their own likes.
  const team = await esgPrisma.$queryRaw<Array<{ id: number }>>`
    SELECT id FROM users WHERE is_active_db = true
      AND (id = ${alert.user_id} OR (${alert.team}::text IS NOT NULL AND team = ${alert.team}))
  `;
  const userIds = team.map(user => user.id);
  if (!userIds.length) return { items: [], unavailableDomains: [] };
  const result: WeeklyArticleItem[] = [];
  const unavailableDomains: ArticleAiDomain[] = [];
  const kinds = (['article', 'event', 'publication'] as const).filter(kind =>
    (kind === 'article' ? alert.alert_articles : kind === 'event' ? alert.alert_events : alert.alert_publications) !== false,
  );
  for (const domain of domains) {
    const database = domain === 'esg' ? esgPrisma : creditPrisma;
    const domainItems: WeeklyArticleItem[] = [];
    try {
    for (const kind of kinds) {
      const spec = SOURCES[domain][kind];
      const url = spec.url.startsWith('COALESCE') ? spec.url : `a.${spec.url}`;
      const rows = await database.$queryRawUnsafe<Array<{
        id: number; title: string | null; url: string | null; source: string | null; published_at: Date | null;
      }>>(`
        SELECT a.id, a.${spec.title} AS title, ${url} AS url, a.source, ${spec.date} AS published_at
        FROM ${spec.table} a
        JOIN likes l ON l.content_id = a.id AND COALESCE(l.content_type, 'article') = $1
        WHERE l.user_id = ANY($2::integer[]) AND l.created_at >= $3 AND l.created_at < $4
        GROUP BY a.id
        ORDER BY MAX(l.created_at) DESC, a.id DESC LIMIT 50
      `, kind, userIds, window.since, window.until);
      domainItems.push(...rows.map(row => ({
        id: row.id, domain, kind, origin: 'human' as const,
        title: row.title || 'Untitled', url: row.url || '', source: row.source || 'Unknown source',
        publishedAt: row.published_at?.toISOString() ?? null,
      })));
    }
      result.push(...domainItems);
    } catch {
      unavailableDomains.push(domain);
      console.warn(`[article-weekly] ${domain} content temporarily unavailable`);
    }
  }
  return { items: result, unavailableDomains };
}
