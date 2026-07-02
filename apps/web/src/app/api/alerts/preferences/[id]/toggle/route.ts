import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/nextauth-options";
import { esgPrisma } from "@esgcredit/db-esg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PUT - Toggle alert active status
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const userId = Number((session.user as any).id);
    const { id } = await params;
    const alertId = parseInt(id);
    const body = await req.json();

    const [updated] = await esgPrisma.$queryRaw<any[]>`
      UPDATE alert_preferences SET
        is_active = ${body.is_active},
        updated_at = NOW()
      WHERE id = ${alertId} AND user_id = ${userId}
      RETURNING *
    `;

    if (!updated) {
      return NextResponse.json(
        { ok: false, error: "Alert not found or unauthorized" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ok: true,
      success: true,
      message: `Alert ${body.is_active ? "enabled" : "disabled"} successfully`,
      alert: updated,
    });
  } catch (error: any) {
    console.error("Error toggling alert:", error);
    return NextResponse.json(
      { ok: false, error: error.message || "Failed to toggle alert" },
      { status: 500 }
    );
  }
}
