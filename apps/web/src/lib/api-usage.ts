import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { esgPrisma } from "@esgcredit/db-esg";
import {
  countActiveJobs,
  type BackgroundJobType,
} from "@/lib/jobs/queue";

export interface UsageLimit {
  feature: string;
  userId: number;
  perMinute: number;
  /** Omit to leave this feature unlimited across the day. */
  perDay?: number;
  dailyCostUnits?: number;
  costUnits?: number;
  maxConcurrentJobs?: number;
  jobType?: BackgroundJobType;
}

export interface PublicUsageLimit {
  feature: string;
  perMinute: number;
  perDay: number;
}

export async function enforcePublicApiUsage(
  request: Request,
  limit: PublicUsageLimit,
): Promise<NextResponse | null> {
  const ip = clientIp(request);
  if (!ip) {
    return NextResponse.json(
      { error: "Unable to validate request origin" },
      { status: 400 },
    );
  }

  const scope = `public-ip:${hashIp(ip)}`;
  const minuteAllowed = await consumeBucket(
    scope,
    limit.feature,
    "minute",
    limit.perMinute,
    Number.MAX_SAFE_INTEGER,
    1,
  );
  if (!minuteAllowed) return rateLimited("Rate limit exceeded", 60);

  const dailyAllowed = await consumeBucket(
    scope,
    limit.feature,
    "day",
    limit.perDay,
    Number.MAX_SAFE_INTEGER,
    1,
  );
  if (!dailyAllowed) {
    return rateLimited("Daily limit exceeded", secondsUntilTomorrow());
  }
  return null;
}

export async function enforceApiUsage(
  request: Request,
  limit: UsageLimit,
): Promise<NextResponse | null> {
  if (limit.maxConcurrentJobs !== undefined) {
    const active = await countActiveJobs(limit.userId, limit.jobType);
    if (active >= limit.maxConcurrentJobs) {
      return rateLimited("Too many active jobs", 30);
    }
  }

  const ipScope = `ip:${hashIp(clientIp(request) ?? `authenticated-user-${limit.userId}`)}`;
  const userScope = `user:${limit.userId}`;
  const cost = Math.max(1, Math.floor(limit.costUnits ?? 1));

  const userMinute = await consumeBucket(
    userScope,
    limit.feature,
    "minute",
    limit.perMinute,
    Number.MAX_SAFE_INTEGER,
    cost,
  );
  if (!userMinute) return rateLimited("Per-user rate limit exceeded", 60);

  const ipMinute = await consumeBucket(
    ipScope,
    limit.feature,
    "minute",
    Math.max(limit.perMinute * 3, limit.perMinute + 5),
    Number.MAX_SAFE_INTEGER,
    cost,
  );
  if (!ipMinute) return rateLimited("Per-IP rate limit exceeded", 60);

  if (limit.perDay !== undefined) {
    const dailyCost = Math.max(
      limit.perDay,
      limit.dailyCostUnits ?? limit.perDay,
    );
    const userDaily = await consumeBucket(
      userScope,
      limit.feature,
      "day",
      limit.perDay,
      dailyCost,
      cost,
    );
    if (!userDaily) {
      return rateLimited(
        "Daily feature budget exceeded",
        secondsUntilTomorrow(),
      );
    }
  }
  return null;
}

export async function cleanupUsageBuckets(retentionDays = 35): Promise<number> {
  const safeDays = Math.max(2, Math.min(retentionDays, 365));
  return esgPrisma.$executeRaw`
    DELETE FROM api_usage_buckets
    WHERE window_start < now() - (${safeDays} * INTERVAL '1 day')
  `;
}

async function consumeBucket(
  scopeKey: string,
  feature: string,
  window: "minute" | "day",
  requestLimit: number,
  costLimit: number,
  costUnits: number,
): Promise<boolean> {
  const rows = await esgPrisma.$queryRaw<Array<{ request_count: number }>>`
    INSERT INTO api_usage_buckets (
      scope_key, feature, window_kind, window_start, request_count, cost_units, updated_at
    ) VALUES (
      ${scopeKey}, ${feature}, ${window}, date_trunc(${window}, now()), 1, ${costUnits}, now()
    )
    ON CONFLICT (scope_key, feature, window_kind, window_start)
    DO UPDATE SET
      request_count = api_usage_buckets.request_count + 1,
      cost_units = api_usage_buckets.cost_units + ${costUnits},
      updated_at = now()
    WHERE api_usage_buckets.request_count + 1 <= ${Math.max(1, requestLimit)}
      AND api_usage_buckets.cost_units + ${costUnits} <= ${Math.max(1, costLimit)}
    RETURNING request_count
  `;
  return rows.length > 0;
}

function clientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || null;
}

function hashIp(ip: string): string {
  return createHash("sha256").update(ip).digest("hex").slice(0, 32);
}

function rateLimited(message: string, retryAfter: number) {
  return NextResponse.json(
    { error: message },
    {
      status: 429,
      headers: { "Retry-After": String(Math.max(1, retryAfter)) },
    },
  );
}

function secondsUntilTomorrow(): number {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setUTCHours(24, 0, 0, 0);
  return Math.ceil((tomorrow.getTime() - now.getTime()) / 1000);
}
