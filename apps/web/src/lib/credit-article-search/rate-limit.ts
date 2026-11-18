import "server-only";

type RateState = { startedAt: number; count: number };

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 60;
const MAX_TRACKED_USERS = 4096;
const states = new Map<number, RateState>();

export function consumeCreditArticleSearchRate(userId: number): number | null {
  const now = Date.now();
  const existing = states.get(userId);
  if (!existing || now - existing.startedAt >= WINDOW_MS) {
    if (!existing && states.size >= MAX_TRACKED_USERS) {
      states.forEach((state, key) => {
        if (now - state.startedAt >= WINDOW_MS) states.delete(key);
      });
      if (states.size >= MAX_TRACKED_USERS) return Math.ceil(WINDOW_MS / 1000);
    }
    states.set(userId, { startedAt: now, count: 1 });
    return null;
  }
  if (existing.count >= MAX_REQUESTS) {
    return Math.max(1, Math.ceil((existing.startedAt + WINDOW_MS - now) / 1000));
  }
  existing.count += 1;
  return null;
}

export function resetCreditArticleSearchRateForTests(): void {
  states.clear();
}
