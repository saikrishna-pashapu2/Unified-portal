import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/nextauth-options";
import { esgPrisma } from "@esgcredit/db-esg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/alerts/[id]
 * Get specific alert details
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!(session as any)?.is_admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const { id } = await params;
    const alertId = parseInt(id);

    const alert = await esgPrisma.alert_preferences.findUnique({
      where: { id: alertId },
      include: {
        users: {
          select: {
            id: true,
            email: true,
            first_name: true,
            last_name: true,
            team: true,
          },
        },
        _count: {
          select: {
            alert_content_sent: true,
          },
        },
      },
    });

    if (!alert) {
      return NextResponse.json({ error: "Alert not found" }, { status: 404 });
    }

    return NextResponse.json({ alert });
  } catch (error: any) {
    console.error("Error fetching alert:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch alert" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/admin/alerts/[id]
 * Update alert preferences
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!(session as any)?.is_admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const { id } = await params;
    const alertId = parseInt(id);
    const body = await req.json();

    // Extract update fields
    const updateData: any = {};
    
    if (body.alert_name !== undefined) updateData.alert_name = body.alert_name;
    if (body.is_active !== undefined) updateData.is_active = body.is_active;
    if (body.email_enabled !== undefined) updateData.email_enabled = body.email_enabled;
    if (body.sources !== undefined) updateData.sources = body.sources;
    if (body.keywords !== undefined) updateData.keywords = body.keywords;
    if (body.immediate_sources !== undefined) updateData.immediate_sources = body.immediate_sources;
    if (body.immediate_keywords !== undefined) updateData.immediate_keywords = body.immediate_keywords;
    if (body.digest_day !== undefined) updateData.digest_day = body.digest_day;
    if (body.digest_hour !== undefined) updateData.digest_hour = body.digest_hour;
    if (body.timezone !== undefined) updateData.timezone = body.timezone;
    if (body.domains !== undefined) updateData.domains = body.domains;
    if (body.alert_type !== undefined) updateData.alert_type = body.alert_type;

    updateData.updated_at = new Date();

    const updatedAlert = await esgPrisma.alert_preferences.update({
      where: { id: alertId },
      data: updateData,
    });

    return NextResponse.json({ alert: updatedAlert });
  } catch (error: any) {
    console.error("Error updating alert:", error);
    return NextResponse.json(
      { error: error.message || "Failed to update alert" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/alerts/[id]
 * Delete alert
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!(session as any)?.is_admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const { id } = await params;
    const alertId = parseInt(id);

    // Delete alert_content_sent records first (cascade should handle this, but being explicit)
    await esgPrisma.alert_content_sent.deleteMany({
      where: { alert_preference_id: alertId },
    });

    // Delete alert
    await esgPrisma.alert_preferences.delete({
      where: { id: alertId },
    });

    return NextResponse.json({ message: "Alert deleted successfully" });
  } catch (error: any) {
    console.error("Error deleting alert:", error);
    return NextResponse.json(
      { error: error.message || "Failed to delete alert" },
      { status: 500 }
    );
  }
}
