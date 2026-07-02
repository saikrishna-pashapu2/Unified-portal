import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/nextauth-options";
import { esgPrisma } from "@esgcredit/db-esg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PUT - Update specific alert
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

    const emailAddr = body.email_address || (session.user as any).email;

    // Update alert
    const [updated] = await esgPrisma.$queryRaw<any[]>`
      UPDATE alert_preferences SET
        alert_name = ${body.alert_name},
        alert_type = ${body.alert_type},
        is_active = ${body.is_active !== false},
        domains = ${body.domains || []}::varchar[],
        domain = ${body.domains?.[0] || body.domain || "esg"},
        weekly_digest = ${body.alert_type === "weekly_digest"},
        daily_digest = ${body.alert_type === "daily_digest"},
        immediate_alerts = ${body.alert_type === "immediate_alerts"},
        immediate_sources = ${body.immediate_sources || []}::text[],
        immediate_keywords = ${body.immediate_keywords || []}::text[],
        immediate_content_types = ${body.immediate_content_types || []}::text[],
        email_enabled = ${body.email_enabled !== false},
        email_address = ${emailAddr},
        digest_day = ${body.digest_day || "monday"},
        digest_hour = ${body.digest_hour || 9},
        timezone = ${body.timezone || "Asia/Dubai"},
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
      message: "Alert updated successfully",
      alert: updated,
    });
  } catch (error: any) {
    console.error("Error updating alert:", error);
    return NextResponse.json(
      { ok: false, error: error.message || "Failed to update alert" },
      { status: 500 }
    );
  }
}

// DELETE - Delete specific alert
export async function DELETE(
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

    await esgPrisma.$queryRaw`
      DELETE FROM alert_preferences
      WHERE id = ${alertId} AND user_id = ${userId}
    `;

    return NextResponse.json({
      ok: true,
      success: true,
      message: "Alert deleted successfully",
    });
  } catch (error: any) {
    console.error("Error deleting alert:", error);
    return NextResponse.json(
      { ok: false, error: error.message || "Failed to delete alert" },
      { status: 500 }
    );
  }
}
