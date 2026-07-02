import { NextResponse } from "next/server";
import { generateWeeklyDigest } from "@/lib/digest-agent";
import { requireCronSecret } from "@/lib/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cron job to generate weekly digest for all domains
 * Scheduled to run every Monday at 9am GST
 * 
 * This endpoint:
 * 1. Generates a digest for ESG domain
 * 2. Generates a digest for Credit domain
 * 3. Saves both to their respective databases
 */
export async function GET(req: Request) {
  try {
    const authError = requireCronSecret(req);
    if (authError) return authError;

    const now = new Date();
    console.log(`[${now.toISOString()}] Starting Weekly Digest Generation...`);

    const results = {
      esg: { success: false, message: "" },
      credit: { success: false, message: "" },
    };

    // Generate ESG digest
    try {
      await generateWeeklyDigest("esg");
      results.esg = { success: true, message: "ESG digest generated successfully" };
      console.log("✅ ESG digest generated successfully");
    } catch (error: any) {
      results.esg = { success: false, message: error.message || "Unknown error" };
      console.error("❌ Error generating ESG digest:", error);
    }

    // Generate Credit digest
    try {
      await generateWeeklyDigest("credit");
      results.credit = { success: true, message: "Credit digest generated successfully" };
      console.log("✅ Credit digest generated successfully");
    } catch (error: any) {
      results.credit = { success: false, message: error.message || "Unknown error" };
      console.error("❌ Error generating Credit digest:", error);
    }

    const allSuccessful = results.esg.success && results.credit.success;

    return NextResponse.json({
      ok: allSuccessful,
      timestamp: now.toISOString(),
      results,
    });
  } catch (error: any) {
    console.error("Fatal error in Weekly Digest Generation:", error);
    return NextResponse.json(
      {
        ok: false,
        error: "Internal server error",
        message: error.message || "Unknown error",
      },
      { status: 500 }
    );
  }
}
