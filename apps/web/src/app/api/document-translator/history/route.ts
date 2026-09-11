import { NextResponse } from "next/server";
import { esgPrisma } from "@esgcredit/db-esg";
import { requirePdfxUser } from "@/lib/pdfx-v2/auth";
import {
  parseHistoryQuery,
  type HistoryResponse,
} from "@/lib/document-translator/history";
import { XLSX_JOB_TYPE } from "@/lib/xlsx-translator/types";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  const auth = await requirePdfxUser();
  if (auth.response) return auth.response;
  const p = parseHistoryQuery(new URL(request.url).searchParams);
  if (!p)
    return NextResponse.json(
      { error: "Invalid history filters or pagination" },
      { status: 400, headers },
    );
  try {
    // One statement keeps the filtered count and page in the same snapshot.
    // Never select source/output binaries, checkpoints or raw provider errors.
    // Search is a literal substring, not an SQL wildcard expression.
    const [result] = await esgPrisma.$queryRaw<
      Array<Omit<HistoryResponse, "page" | "size">>
    >`
      WITH jobs AS (
        SELECT id, filename, target_lang, status, stage, progress, total_pages, created_at, 'pdf' AS kind
        FROM pdf_translation_v2_jobs WHERE user_id=${auth.userId}
        UNION ALL
        SELECT id, payload_json->>'filename' AS filename, payload_json->>'targetLang' AS target_lang,
          CASE WHEN status='done' THEN 'completed' ELSE status END AS status,
          status AS stage, progress, 0 AS total_pages, created_at, 'xlsx' AS kind
        FROM background_jobs WHERE user_id=${auth.userId} AND job_type=${XLSX_JOB_TYPE}
      ), searched AS (
        SELECT * FROM jobs
        WHERE (${p.kind} = 'all' OR kind = ${p.kind})
          AND strpos(lower(COALESCE(filename, '')), lower(${p.search})) > 0
      ), filtered AS (
        SELECT * FROM searched WHERE CASE ${p.status}
          WHEN 'active' THEN status IN ('queued', 'processing', 'cancelling')
          WHEN 'completed' THEN status = 'completed'
          WHEN 'attention' THEN status IN ('error', 'cancelled')
          WHEN 'draft' THEN status = 'draft'
          ELSE TRUE END
      )
      SELECT
        (SELECT count(*)::int FROM filtered) AS total,
        (SELECT count(*)::int FROM jobs) AS "allTotal",
        (SELECT jsonb_build_object(
          'all', count(*)::int,
          'active', (count(*) FILTER (WHERE status IN ('queued', 'processing', 'cancelling')))::int,
          'completed', (count(*) FILTER (WHERE status='completed'))::int,
          'attention', (count(*) FILTER (WHERE status IN ('error', 'cancelled')))::int,
          'draft', (count(*) FILTER (WHERE status='draft'))::int
        ) FROM searched) AS counts,
        COALESCE((SELECT jsonb_agg(to_jsonb(paged) ORDER BY created_at DESC, id DESC, kind DESC)
          FROM (SELECT * FROM filtered ORDER BY created_at DESC, id DESC, kind DESC
            LIMIT ${p.pageSize} OFFSET ${p.skip}) AS paged), '[]'::jsonb) AS items
    `;
    return NextResponse.json(
      {
        ...result,
        items: result.items.map((item) => ({
          ...item,
          canDownload: item.status === "completed",
          message:
            item.status === "error"
              ? "Open this job to review saved results and recovery options."
              : null,
        })),
        page: p.page,
        size: p.pageSize,
      },
      { headers },
    );
  } catch {
    console.error("[document-translator] History read failed");
    return NextResponse.json(
      {
        error:
          "Translation history is temporarily unavailable. Please try again.",
      },
      { status: 503, headers },
    );
  }
}
