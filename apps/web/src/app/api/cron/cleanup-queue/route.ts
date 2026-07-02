import { NextResponse } from "next/server";
import { cleanupEmailQueue } from "@/lib/alerts/email-queue";
import { requireCronSecret } from "@/lib/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cron endpoint to cleanup old emails from queue
 * Triggered: Daily at 2:00 AM Dubai time
 * Security: Requires CRON_SECRET in Authorization header
 */
export async function GET(request: Request) {
  try {
    const authError = requireCronSecret(request);
    if (authError) return authError;

    // Cleanup old emails (keep last 30 days)
    console.log("[CRON] 🧹 Starting email queue cleanup...");
    const startTime = Date.now();

    const deleted = await cleanupEmailQueue(30); // Keep last 30 days

    const duration = Date.now() - startTime;
    console.log(`[CRON] ✅ Cleaned up ${deleted} old emails in ${duration}ms`);

    return NextResponse.json({
      success: true,
      message: `Cleaned up ${deleted} old emails`,
      deleted,
      daysKept: 30,
      duration,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("[CRON] ❌ Cleanup job failed:", error);
    return NextResponse.json(
      {
        error: "Failed to cleanup email queue",
        message: error.message,
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
