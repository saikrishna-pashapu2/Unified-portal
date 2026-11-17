import "server-only";

const ARTICLE_SEARCH_RATE_LIMIT = 60;
const ARTICLE_SEARCH_RATE_WINDOW_MS = 60_000;
const MAX_TRACKED_USERS = 4_096;

type RateState = {
  startedAt: number;
  count: number;
};

const requestRate = new Map<number, RateState>();

export function consumeEsgArticleSearchRate(userId: number): number | null {
  const now = Date.now();

  Array.from(requestRate.entries()).forEach(([trackedUserId, state]) => {
    if (now - state.startedAt >= ARTICLE_SEARCH_RATE_WINDOW_MS) requestRate.delete(trackedUserId);
  });

  if (!requestRate.has(userId) && requestRate.size >= MAX_TRACKED_USERS) {
    const oldest = requestRate.keys().next().value;
    if (oldest !== undefined) requestRate.delete(oldest);
  }

  const existing = requestRate.get(userId);
  if (!existing || now - existing.startedAt >= ARTICLE_SEARCH_RATE_WINDOW_MS) {
    requestRate.set(userId, { startedAt: now, count: 1 });
    return null;
  }

  if (existing.count >= ARTICLE_SEARCH_RATE_LIMIT) {
    return Math.max(1, Math.ceil((existing.startedAt + ARTICLE_SEARCH_RATE_WINDOW_MS - now) / 1_000));
  }

  existing.count += 1;
  return null;
}

/** Test-only reset; route modules must not export non-HTTP symbols. */
export function resetEsgArticleSearchRateForTests(): void {
  requestRate.clear();
}
