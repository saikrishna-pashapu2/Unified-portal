const DAY_MS = 86_400_000;
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function localParts(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(part => part.type === type)?.value);
  return { year: read('year'), month: read('month'), day: read('day'), hour: read('hour'), minute: read('minute'), second: read('second') };
}

function wallTime(now: Date, zone: string): number {
  const p = localParts(now, zone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}

/** Earlier occurrence for repeated clocks; first valid minute after a DST gap. */
function toInstant(wall: number, zone: string): Date {
  const offsets = new Set<number>();
  for (let hours = -36; hours <= 36; hours += 6) {
    const probe = wall + hours * 3_600_000;
    offsets.add(wallTime(new Date(probe), zone) - probe);
  }
  for (let minute = 0; minute <= 180; minute++) {
    const desired = wall + minute * 60_000;
    const candidates = Array.from(offsets).map(offset => desired - offset)
      .filter(instant => wallTime(new Date(instant), zone) === desired);
    if (candidates.length) return new Date(Math.min(...candidates));
  }
  throw new RangeError("Weekly alert schedule cannot be resolved in its timezone");
}

export interface ArticleWeeklyWindow {
  /** Calendar week identity, independent of model, template, or preference edits. */
  weekKey: string;
  since: Date;
  until: Date;
  nextScheduledAt: Date;
  due: boolean;
}

/** Only the current local calendar week is considered: no historical catch-up flood. */
export function getArticleWeeklyWindow(
  now: Date,
  schedule: { digest_day?: string | null; digest_hour?: number | null; timezone?: string | null },
): ArticleWeeklyWindow {
  if (!Number.isFinite(now.getTime())) throw new RangeError("Invalid weekly digest clock");
  const zone = schedule.timezone || 'Asia/Dubai';
  const day = WEEKDAYS.indexOf((schedule.digest_day || 'monday').toLowerCase());
  const hour = schedule.digest_hour ?? 9;
  if (day < 0 || !Number.isInteger(hour) || hour < 0 || hour > 23) throw new RangeError("Invalid weekly digest schedule");
  // Intl validates the IANA timezone and never uses the host's timezone.
  const p = localParts(now, zone);
  const today = Date.UTC(p.year, p.month - 1, p.day);
  const monday = today - ((new Date(today).getUTCDay() + 6) % 7) * DAY_MS;
  const scheduledWall = monday + ((day + 6) % 7) * DAY_MS + hour * 3_600_000;
  const until = toInstant(scheduledWall, zone);
  return {
    weekKey: new Date(monday).toISOString().slice(0, 10),
    since: toInstant(scheduledWall - 7 * DAY_MS, zone),
    until,
    nextScheduledAt: toInstant(scheduledWall + 7 * DAY_MS, zone),
    due: now >= until,
  };
}

export function articleWeeklyDeliveryKey(alertId: number, window: ArticleWeeklyWindow): string {
  return `article-weekly:${alertId}:${window.weekKey}`;
}
