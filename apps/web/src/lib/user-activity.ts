import "server-only";

import { esgPrisma } from "@esgcredit/db-esg";

type ActivityId = string | number | null | undefined;

export type UserActivityInput = {
  userId: ActivityId;
  action: string;
  resourceType?: string | null;
  resourceId?: ActivityId;
  details?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  occurredAt?: Date;
};

export function normalizeActivityId(value: ActivityId): number | null {
  if (typeof value === "number") {
    return Number.isInteger(value) && value > 0 ? value : null;
  }

  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const parsedValue = Number(value.trim());
    return Number.isSafeInteger(parsedValue) && parsedValue > 0 ? parsedValue : null;
  }

  return null;
}

export async function recordUserActivity({
  userId,
  action,
  resourceType,
  resourceId,
  details,
  ipAddress,
  userAgent,
  occurredAt,
}: UserActivityInput): Promise<boolean> {
  const normalizedUserId = normalizeActivityId(userId);
  if (!normalizedUserId) {
    return false;
  }

  const normalizedResourceId = normalizeActivityId(resourceId);
  const activityTimestamp = occurredAt ?? new Date();

  try {
    await (esgPrisma as any).user_activity.create({
      data: {
        user_id: normalizedUserId,
        action,
        resource_type: resourceType ?? null,
        resource_id: normalizedResourceId,
        details: details ?? null,
        ip_address: ipAddress ?? null,
        user_agent: userAgent ?? null,
        timestamp: activityTimestamp,
        created_at: activityTimestamp,
      },
    });

    return true;
  } catch (error) {
    console.error("[Activity] Failed to record user activity:", error);
    return false;
  }
}

export async function updateUserLastLogin(userId: ActivityId, lastLogin = new Date()): Promise<boolean> {
  const normalizedUserId = normalizeActivityId(userId);
  if (!normalizedUserId) {
    return false;
  }

  try {
    await esgPrisma.users.update({
      where: { id: normalizedUserId },
      data: { last_login: lastLogin },
    });

    return true;
  } catch (error) {
    console.error("[Auth] Failed to update last_login:", error);
    return false;
  }
}

export function extractActivityPath(details?: string | null): string | null {
  if (!details) {
    return null;
  }

  const matchedPath = details.match(/\/(?:esg|credit)\/[^\s)•]+/i);
  return matchedPath ? matchedPath[0] : null;
}

export function inferActivityDomain(details?: string | null): "esg" | "credit" | null {
  const activityPath = extractActivityPath(details);

  if (activityPath?.startsWith("/credit/")) {
    return "credit";
  }

  if (activityPath?.startsWith("/esg/")) {
    return "esg";
  }

  return null;
}