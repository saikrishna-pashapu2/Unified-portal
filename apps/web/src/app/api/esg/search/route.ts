import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import {
  fetchIssEsgSource,
  fetchLsegEsgSource,
  fetchSnpEsgSource,
} from "@/lib/esg-sources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Main ESG search API that aggregates results from all three sources
// For now, these are placeholder implementations. You can replace with your actual Python logic
// or implement the scrapers directly in Node.js with fetch calls.

export async function GET(req: Request) {
  const auth = await requireSession();
  if (auth.response) return auth.response;

  const name = new URL(req.url).searchParams.get("name") || "";
  if (!name) return NextResponse.json({ error: "Missing name" }, { status: 400 });
  
  const [snp, iss, lseg] = await Promise.allSettled([
    fetchSnpEsgSource(name),
    fetchIssEsgSource(name),
    fetchLsegEsgSource(name),
  ]);

  // Helper function to safely extract results from Promise.allSettled
  const safe = (r: any, key: string) => r.status === "fulfilled" ? r.value : { source: key, error: "unavailable" };

  const sources = {
    "S&P": safe(snp, "S&P"),
    "ISS": safe(iss, "ISS"),
    "LSEG": safe(lseg, "LSEG"),
  };

  // Extract summary scores for the All tab display
  const summary = {
    "S&P": sources["S&P"]?.esg_score ?? "-",
    "ISS": sources["ISS"]?.oekomRating ?? "-",
    "LSEG": sources["LSEG"]?.["TR.TRESG"] ?? sources["LSEG"]?.["TR.TRESG.Score"] ?? "-",
  };

  return NextResponse.json({
    name,
    sources,
    summary
  });
}
