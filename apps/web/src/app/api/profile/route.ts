import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/nextauth-options";
import { esgPrisma } from "@esgcredit/db-esg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    // Check authentication
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
    }

    const userId = parseInt((session.user as any).id, 10);
    if (isNaN(userId)) {
      return NextResponse.json({ ok: false, reason: "invalid_user_id" }, { status: 400 });
    }

    // Fetch user from database
    const user = await esgPrisma.users.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        email: true,
        first_name: true,
        last_name: true,
        team: true,
        is_admin: true,
        preferred_categories: true,
        email_notifications: true,
        created_at: true,
        last_login: true,
      },
    });

    if (!user) {
      return NextResponse.json({ ok: false, reason: "user_not_found" }, { status: 404 });
    }

    return NextResponse.json({ 
      ok: true, 
      user: {
        id: user.id,
        name: user.username,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        team: user.team || "esg",
        role: user.is_admin ? "admin" : "user",
        preferred_categories: user.preferred_categories,
        email_notifications: user.email_notifications,
        created_at: user.created_at,
        last_login: user.last_login,
      }
    });
  } catch (error: any) {
    console.error("Profile fetch error:", error);
    return NextResponse.json(
      { ok: false, reason: "fetch_failed", detail: error.message },
      { status: 500 }
    );
  }
}
