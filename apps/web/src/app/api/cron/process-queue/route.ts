import { NextResponse } from "next/server";
import { processEmailQueue } from "@/lib/alerts/email-queue";
import { requireCronSecret } from "@/lib/api-auth";

/**
 * Cron endpoint to process email queue
 * Triggered: Every 5 minutes
 * Security: Requires CRON_SECRET in Authorization header
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const authError = requireCronSecret(request);
    if (authError) return authError;

    // Process the email queue
    console.log("[CRON] 📧 Processing email queue...");
    const startTime = Date.now();

    const processed = await processEmailQueue("cron-worker", 20); // Process up to 20 emails

    const duration = Date.now() - startTime;
    console.log(`[CRON] ✅ Processed ${processed} emails in ${duration}ms`);

    return NextResponse.json({
      success: true,
      message: `Processed ${processed} emails`,
      processed,
      batchSize: 20,
      duration,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("[CRON] ❌ Queue processing failed:", error);
    return NextResponse.json(
      {
        error: "Failed to process email queue",
        message: error.message,
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
