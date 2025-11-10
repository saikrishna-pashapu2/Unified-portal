import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/nextauth-options";
import { getSchedulerStatus } from "@/lib/alert-scheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/scheduler/status
 * Get the current status of the email cron scheduler
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!(session as any)?.is_admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const status = getSchedulerStatus();

    return NextResponse.json({
      success: true,
      status,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("Error getting scheduler status:", error);
    return NextResponse.json(
      { 
        success: false,
        error: error.message || "Failed to get scheduler status" 
      },
      { status: 500 }
    );
  }
}
