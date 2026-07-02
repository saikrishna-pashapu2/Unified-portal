import { NextResponse } from "next/server";
import { queueWeeklyDigests } from "@/lib/alerts/digest";
import { requireCronSecret } from "@/lib/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cron endpoint to queue weekly digests
 * Triggered: Every Monday at 9:00 AM Dubai time
 * Security: Requires CRON_SECRET in Authorization header
 */
export async function GET(request: Request) {
  try {
    const authError = requireCronSecret(request);
    if (authError) return authError;

    // Run the weekly digest job
    console.log("[CRON] 🔔 Starting weekly digest job...");
    const startTime = Date.now();

    await queueWeeklyDigests();

    const duration = Date.now() - startTime;
    console.log(`[CRON] ✅ Weekly digest job completed in ${duration}ms`);

    return NextResponse.json({
      success: true,
      message: "Weekly digests queued successfully",
      duration,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("[CRON] ❌ Weekly digest job failed:", error);
    return NextResponse.json(
      {
        error: "Failed to queue weekly digests",
        message: error.message,
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
