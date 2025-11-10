import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/nextauth-options";
import { startAlertScheduler } from "@/lib/alert-scheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/scheduler/start
 * Start the email cron scheduler
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!(session as any)?.is_admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const result = startAlertScheduler();

    return NextResponse.json({
      success: result.success,
      message: result.message,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("Error starting scheduler:", error);
    return NextResponse.json(
      { 
        success: false,
        error: error.message || "Failed to start scheduler" 
      },
      { status: 500 }
    );
  }
}
