import { NextResponse } from "next/server";
import { esgPrisma } from "@esgcredit/db-esg";
import { requireAdminSession } from "@/lib/api-auth";
import { XLSX_JOB_TYPE } from "@/lib/xlsx-translator/types";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const auth = await requireAdminSession();
  if (auth.response) return auth.response;
  const period = new URL(request.url).searchParams.get("period") || "30";
  if (!["7", "30", "90", "365", "all"].includes(period))
    return NextResponse.json({ error: "Invalid period" }, { status: 400 });
  const start =
    period === "all"
      ? new Date(0)
      : new Date(Date.now() - Number(period) * 86400000);
  try {
    const [row] = await esgPrisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT COUNT(*)::bigint AS jobs,
        COUNT(*) FILTER(WHERE status='draft')::bigint AS drafts,
        COUNT(*) FILTER(WHERE status='done')::bigint AS completed,
        COUNT(*) FILTER(WHERE status='error')::bigint AS failed,
        COUNT(*) FILTER(WHERE status='cancelled')::bigint AS cancelled,
        COUNT(*) FILTER(WHERE status IN ('queued','processing'))::bigint AS active,
        COUNT(DISTINCT user_id)::bigint AS users,
        COALESCE(SUM((result_json->>'requests')::bigint),0)::bigint AS requests,
        COALESCE(SUM((result_json->>'inputTokens')::bigint),0)::bigint AS input_tokens,
        COALESCE(SUM((result_json->>'cachedInputTokens')::bigint),0)::bigint AS cached_input_tokens,
        COALESCE(SUM((result_json->>'outputTokens')::bigint),0)::bigint AS output_tokens,
        COALESCE(SUM((result_json->>'translatedCells')::bigint),0)::bigint AS changed_cells
      FROM background_jobs WHERE job_type=${XLSX_JOB_TYPE} AND created_at>=${start}
    `;
    return NextResponse.json(
      Object.fromEntries(
        Object.entries(row || {}).map(([k, v]) => [k, Number(v || 0)]),
      ),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Excel usage is temporarily unavailable." },
      { status: 500 },
    );
  }
}
