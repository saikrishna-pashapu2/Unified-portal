/**
 * Company Research API Route
 * 
 * POST /api/research/company
 * Conducts comprehensive AI-powered company research
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/nextauth-options";
import { conductCompanyResearch } from "@/lib/company-research-agent";
import { saveResearchSession, updateResearchSession } from "@/lib/company-research-db";
import { v4 as uuidv4 } from "uuid";

export const runtime = "nodejs";
export const maxDuration = 120; // 2 minutes max for comprehensive research

export async function POST(request: NextRequest) {
  try {
    // Check authentication
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    // Parse request body
    const body = await request.json();
    const { companyName, options } = body;

    if (!companyName || typeof companyName !== "string") {
      return NextResponse.json(
        { error: "Company name is required" },
        { status: 400 }
      );
    }

    const trimmedCompanyName = companyName.trim();
    if (trimmedCompanyName.length < 2) {
      return NextResponse.json(
        { error: "Company name must be at least 2 characters" },
        { status: 400 }
      );
    }

    if (trimmedCompanyName.length > 200) {
      return NextResponse.json(
        { error: "Company name is too long" },
        { status: 400 }
      );
    }

    // Generate session ID
    const sessionId = uuidv4();

    // Create research session in database
    try {
      await saveResearchSession({
        sessionId,
        userId: (session.user as any).id || 1, // Fallback to 1 if no ID
        companyName: trimmedCompanyName,
        status: "in_progress",
      });
    } catch (dbError) {
      console.error("Failed to create research session:", dbError);
      // Continue without DB - don't block research
    }

    // Conduct the research
    console.log(`Starting research for company: ${trimmedCompanyName} (session: ${sessionId})`);

    const report = await conductCompanyResearch(trimmedCompanyName, {
      includeFinancials: options?.includeFinancials ?? true,
      includeESG: options?.includeESG ?? true,
      includeContacts: options?.includeContacts ?? true,
      maxSearches: options?.maxSearches ?? 15,
    });

    // Update session with results
    try {
      await updateResearchSession(sessionId, {
        status: "completed",
        finalReport: report,
        tokensUsed: report.research_metadata.tokens_used,
        researchSummary: report.executive_summary,
        completedAt: new Date(),
        findings: report.findings,
        contacts: report.contacts,
      });
    } catch (dbError) {
      console.error("Failed to update research session:", dbError);
      // Continue - don't block response
    }

    console.log(`Research completed for ${trimmedCompanyName}: ${report.findings.length} findings, ${report.contacts.length} contacts`);

    return NextResponse.json(report);

  } catch (error: any) {
    console.error("Company research error:", error);

    // Return user-friendly error
    const errorMessage = error.message || "Research failed";
    const isRateLimit = errorMessage.toLowerCase().includes("rate limit");
    const isTimeout = errorMessage.toLowerCase().includes("timeout");

    return NextResponse.json(
      {
        error: isRateLimit
          ? "Too many requests. Please wait a moment and try again."
          : isTimeout
          ? "Research took too long. Try a simpler company name."
          : "Failed to conduct research. Please try again.",
        details: process.env.NODE_ENV === "development" ? errorMessage : undefined,
      },
      { status: isRateLimit ? 429 : isTimeout ? 504 : 500 }
    );
  }
}

// GET - Retrieve research history
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get("sessionId");
    const limit = parseInt(searchParams.get("limit") || "10", 10);

    // Import dynamically to avoid server-only issues
    const { getResearchHistory, getResearchSession } = await import("@/lib/company-research-db");

    if (sessionId) {
      // Get specific session
      const researchSession = await getResearchSession(sessionId);
      if (!researchSession) {
        return NextResponse.json(
          { error: "Research session not found" },
          { status: 404 }
        );
      }
      return NextResponse.json(researchSession);
    }

    // Get history - ensure user ID is an integer
    const userId = parseInt(String((session.user as any).id || 1), 10);
    const history = await getResearchHistory(
      userId,
      limit
    );

    return NextResponse.json({ history });

  } catch (error: any) {
    console.error("Failed to retrieve research history:", error);
    return NextResponse.json(
      { error: "Failed to retrieve research history" },
      { status: 500 }
    );
  }
}
