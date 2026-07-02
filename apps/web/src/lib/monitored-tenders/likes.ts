import "server-only";

import type { Session } from "next-auth";

export type TenderLikeViewer = {
  memberKey: string;
  displayName: string;
};

type SessionUser = NonNullable<Session["user"]> & {
  id?: string | number | null;
  username?: string | null;
};

function cleanText(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim().replace(/\s+/g, " ");
  return text ? text : null;
}

function nameFromEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const localPart = value.split("@")[0]?.replace(/[._-]+/g, " ").trim();
  return cleanText(localPart);
}

export function tenderLikeViewerFromSession(session: Session | null | undefined): TenderLikeViewer | null {
  const user = session?.user as SessionUser | undefined;
  const userId = cleanText(user?.id);

  if (!userId) return null;

  return {
    memberKey: `portal-user:${userId}`,
    displayName:
      cleanText(user?.name) ??
      cleanText(user?.username) ??
      nameFromEmail(user?.email) ??
      `User ${userId}`,
  };
}
