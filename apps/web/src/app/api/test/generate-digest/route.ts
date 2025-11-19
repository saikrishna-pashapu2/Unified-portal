import { NextResponse } from "next/server";
import { generateTestDigest } from "@/lib/digest-agent-test";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Test endpoint to generate a digest using all available liked articles
 * (no date filter - useful for testing when there are no recent likes)
 * 
 * Usage: GET /api/test/generate-digest?domain=esg
 *        GET /api/test/generate-digest?domain=credit
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const domain = url.searchParams.get("domain") as "esg" | "credit" | null;

    if (!domain || (domain !== "esg" && domain !== "credit")) {
      return NextResponse.json(
        { ok: false, error: "Invalid or missing domain parameter. Use ?domain=esg or ?domain=credit" },
        { status: 400 }
      );
    }

    const now = new Date();
    console.log(`[${now.toISOString()}] Starting TEST Digest Generation for ${domain}...`);

    try {
      const content = await generateTestDigest(domain);
      console.log(`✅ ${domain} test digest generated successfully`);
      
      return NextResponse.json({
        ok: true,
        domain,
        timestamp: now.toISOString(),
        message: "Test digest generated successfully",
        contentPreview: content?.substring(0, 200) + "...",
      });
    } catch (error: any) {
      console.error(`❌ Error generating ${domain} test digest:`, error);
      return NextResponse.json(
        {
          ok: false,
          domain,
          error: error.message || "Unknown error",
        },
        { status: 500 }
      );
    }
  } catch (error: any) {
    console.error("Fatal error in Test Digest Generation:", error);
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
