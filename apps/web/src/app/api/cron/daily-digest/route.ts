import { NextResponse } from "next/server";
import { queueDailyDigests } from "@/lib/alerts/digest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cron endpoint to queue daily digests
 * Triggered: Every hour (checks which users need digests at current hour)
 * Security: Requires CRON_SECRET in Authorization header
 */
export async function GET(request: Request) {
  try {
    // Verify cron secret for security
    const authHeader = request.headers.get("authorization");
    const expectedAuth = `Bearer ${process.env.CRON_SECRET}`;

    if (!process.env.CRON_SECRET) {
      console.error("⚠️  CRON_SECRET not set in environment variables");
      return NextResponse.json(
        { error: "Server misconfiguration" },
        { status: 500 }
      );
    }

    if (authHeader !== expectedAuth) {
      console.warn("🚫 Unauthorized cron attempt:", authHeader);
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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
