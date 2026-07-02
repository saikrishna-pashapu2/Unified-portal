import "server-only";

import { NextResponse } from "next/server";
import { getServerSession, type Session } from "next-auth";
import { esgPrisma } from "@esgcredit/db-esg";
import { authOptions } from "@/lib/nextauth-options";

type SessionWithRole = Session & {
  role?: string;
  is_admin?: boolean;
  user: NonNullable<Session["user"]> & {
    id?: string;
    role?: string;
    is_admin?: boolean;
    team?: string;
  };
};

type AuthResult =
  | { session: SessionWithRole; response?: never }
  | { session?: never; response: NextResponse };

export function unauthorized(message = "Unauthorized") {
  return NextResponse.json({ error: message }, { status: 401 });
}

export function forbidden(message = "Forbidden") {
  return NextResponse.json({ error: message }, { status: 403 });
}

export async function requireSession(): Promise<AuthResult> {
  const session = (await getServerSession(authOptions)) as SessionWithRole | null;

  if (!session?.user) {
    return { response: unauthorized() };
  }

  return { session };
}

export async function requireAdminSession(): Promise<AuthResult> {
  const auth = await requireSession();
  if (auth.response) return auth;

  const session = auth.session;
  const sessionIsAdmin =
    session.is_admin === true ||
    session.role === "admin" ||
    session.user.is_admin === true ||
    session.user.role === "admin";

  if (sessionIsAdmin) {
    return { session };
  }

  if (session.user.email) {
    const user = await esgPrisma.users.findUnique({
      where: { email: session.user.email },
      select: { is_admin: true },
    });

    if (user?.is_admin) {
      return { session };
    }
  }

  return { response: forbidden("Admin access required") };
}

export function requireCronSecret(request: Request): NextResponse | null {
  const cronSecret = process.env.CRON_SECRET?.trim();

  if (!cronSecret) {
    return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return unauthorized();
  }

  return null;
}

