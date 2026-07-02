import { NextResponse } from "next/server";
import { queueDailyDigests } from "@/lib/alerts/digest";
import { requireCronSecret } from "@/lib/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cron endpoint to queue daily digests
 * Triggered: Every hour (checks which users need digests at current hour)
 * Security: Requires CRON_SECRET in Authorization header
 */
export async function GET(request: Request) {
  try {
    const authError = requireCronSecret(request);
    if (authError) return authError;

    // Run the daily digest job
    const currentHour = new Date().getHours();
    console.log(`[CRON] 🔔 Checking for daily digests at hour ${currentHour}...`);
    const startTime = Date.now();

    await queueDailyDigests();

    const duration = Date.now() - startTime;
    console.log(`[CRON] ✅ Daily digest check completed in ${duration}ms`);

    return NextResponse.json({
      success: true,
      message: "Daily digests queued successfully",
      currentHour,
      duration,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("[CRON] ❌ Daily digest job failed:", error);
    return NextResponse.json(
      {
        error: "Failed to queue daily digests",
        message: error.message,
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
