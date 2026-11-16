import { esgPrisma } from "@esgcredit/db-esg";
import { filterArticleAiDigestPicksForCommit, getArticleAiDigestPicks } from "@/lib/article-ai/service";
import type { ArticleAiDigestPick } from "@/lib/article-ai/types";
import { enqueueEmailWithHistory } from "./email-queue";
import { articleWeeklyDeliveryKey, getArticleWeeklyWindow } from "./article-weekly-dates";
import { getHumanWeeklyItems, listWeeklyArticleAlerts, type WeeklyArticleAlert } from "./article-weekly-repository";
import { deduplicateWeeklyItems, isPersonalDigestRecipient, matchesWeeklyFilters, normalizeWeeklyDomains, type WeeklyArticleItem } from "./article-weekly-policy";
import { renderArticleWeeklyEmail } from "./article-weekly-template";

export function articleWeeklyDigestEnabled(): boolean {
  return process.env.ARTICLE_WEEKLY_DIGEST_ENABLED === 'true';
}

function asEmailItem(pick: ArticleAiDigestPick): WeeklyArticleItem {
  return { id: pick.articleId, domain: pick.domain, kind: 'article', origin: 'ai', title: pick.title,
    url: pick.url, source: pick.source, publishedAt: pick.publishedAt, reason: pick.reason, contentHash: pick.contentHash };
}

export interface ArticleWeeklyResult { queued: number; deduplicated: number; skipped: number; failed: number }

/** All scheduling entrypoints use this service and its permanent logical delivery key. */
export async function queueDueArticleWeeklyDigests(now = new Date()): Promise<ArticleWeeklyResult> {
  const result: ArticleWeeklyResult = { queued: 0, deduplicated: 0, skipped: 0, failed: 0 };
  if (!articleWeeklyDigestEnabled()) return result;
  const alerts = await listWeeklyArticleAlerts();
  for (const alert of alerts) {
    try {
      const outcome = await queueOneWeeklyDigest(alert, now);
      result[outcome]++;
    } catch {
      // IDs diagnose bad schedules/outages without logging recipient or article contents.
      console.error(`[article-weekly] could not assemble alert ${alert.id}; it remains due for retry`);
      result.failed++;
    }
  }
  return result;
}

async function queueOneWeeklyDigest(
  alert: WeeklyArticleAlert,
  now: Date,
): Promise<'queued' | 'deduplicated' | 'skipped'> {
  const window = getArticleWeeklyWindow(now, alert);
  if (!window.due || (alert.created_at && alert.created_at > window.until)
    || (alert.last_sent_at && alert.last_sent_at >= window.until)) return 'skipped';
  const domains = normalizeWeeklyDomains(alert.domains, alert.domain);
  const destination = (alert.email_address || alert.email || '').trim();
  if (!destination) return 'skipped';
  const { items: humanItems, unavailableDomains } = await getHumanWeeklyItems(alert, domains, window);
  const availableDomains = domains.filter(domain => !unavailableDomains.includes(domain));
  if (!availableDomains.length) throw new Error('Requested content databases are unavailable');
  let aiPicks: ArticleAiDigestPick[] = [];
  if (alert.alert_articles !== false && isPersonalDigestRecipient(destination, alert.email)) {
    try {
      aiPicks = await getArticleAiDigestPicks(alert.user_id, availableDomains, window, now);
    } catch {
      // Selection/model failures never hold the existing human digest hostage.
      console.warn(`[article-weekly] AI picks unavailable for alert ${alert.id}; using human selections`);
    }
  }

  return esgPrisma.$transaction(async tx => {
    // Serialize a schedule's assembly; re-read permission and recipient changes.
    const [current] = await tx.$queryRaw<WeeklyArticleAlert[]>`
      SELECT ap.*, u.email, u.first_name, u.last_name, u.team
      FROM alert_preferences ap JOIN users u ON u.id = ap.user_id
      WHERE ap.id = ${alert.id} AND ap.user_id = ${alert.user_id}
        AND ap.alert_type = 'weekly_digest' AND ap.is_active = true
        AND ap.email_enabled = true AND u.is_active_db = true
        AND COALESCE(u.email_notifications, true) = true
      FOR UPDATE OF ap FOR SHARE OF u
    `;
    if (!current || JSON.stringify(current) !== JSON.stringify(alert)) return 'skipped';
    // The helper takes preference/feedback locks until this snapshot is committed.
    const eligiblePicks = aiPicks.length
      ? await filterArticleAiDigestPicksForCommit(tx, alert.user_id, aiPicks) : [];
    const items = deduplicateWeeklyItems([...humanItems, ...eligiblePicks.map(asEmailItem)])
      .filter(item => matchesWeeklyFilters(item, alert));
    // No subscription should receive an empty email when the feature is enabled.
    // Leave the schedule eligible so a transient content/AI failure can recover.
    if (!items.length) return 'skipped';
    const email = renderArticleWeeklyEmail({
      name: [alert.first_name, alert.last_name].filter(Boolean).join(' ') || 'User',
      alertName: alert.alert_name || 'Weekly articles', items, unavailableDomains,
    });
    const queued = await enqueueEmailWithHistory({
      userId: alert.user_id, to: destination, ...email, domain: domains[0], alertType: 'weekly_digest',
      contentType: 'digest', contentIds: items.map(item => item.id), totalItems: items.length,
      deliveryKey: articleWeeklyDeliveryKey(alert.id, window), templateVersion: 'article-v1',
      metadata: {
        kind: 'article-weekly', alertId: alert.id, recipientUserId: alert.user_id,
        domains, unavailableDomains, periodStart: window.since.toISOString(), periodEnd: window.until.toISOString(),
        aiPicksPrivate: true, items: items.map(item => ({ domain: item.domain, contentType: item.kind,
          id: item.id, origin: item.origin, contentHash: item.contentHash ?? null })),
      },
    }, tx);
    await tx.$executeRaw`
      UPDATE alert_preferences SET last_sent_at = ${now}, next_send_at = ${window.nextScheduledAt}
      WHERE id = ${alert.id}
    `;
    return queued.deduplicated ? 'deduplicated' : 'queued';
  }, { timeout: 15_000 });
}
