import type { AdminTranslatorJobsQuery } from "@/lib/document-translator/admin-jobs";

export type AdminTranslatorJobsSqlQuery = {
  /** Static PostgreSQL text; caller-provided values only appear as $n binds. */
  text: string;
  parameters: readonly unknown[];
};

/**
 * Build one read-only statement so the filtered count and requested page share
 * one PostgreSQL statement snapshot. The returned SQL is static and all URL
 * values are parameterized, which also makes it safe to inspect/execute in a
 * read-only compatibility check.
 */
export function buildAdminTranslatorJobsQuery(
  query: AdminTranslatorJobsQuery,
): AdminTranslatorJobsSqlQuery {
  return {
    text: `
      WITH jobs AS (
        SELECT
          'pdf'::text AS kind,
          j.id,
          j.filename,
          j.target_lang AS target_language,
          j.status,
          COALESCE(NULLIF(j.stage, ''), j.status, 'unknown') AS stage,
          j.progress,
          j.total_pages,
          NULL::integer AS changed_cells,
          j.created_at,
          j.completed_at,
          COALESCE(
            NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), ''),
            u.email,
            u.username,
            'Unknown'
          ) AS user_name,
          u.email AS user_email,
          j.metrics AS pdf_metrics,
          NULL::jsonb AS xlsx_result,
          CASE
            WHEN j.status = 'error'
              AND lower(COALESCE(NULLIF(BTRIM(pdf_queue.last_error), ''), NULLIF(BTRIM(j.message), ''), ''))
                  <> 'worker failed'
              THEN COALESCE(
                NULLIF(BTRIM(pdf_queue.last_error), ''),
                NULLIF(BTRIM(j.message), '')
              )
            ELSE NULL
          END AS error,
          CASE
            WHEN j.status = 'error' THEN NULL
            ELSE NULLIF(BTRIM(j.message), '')
          END AS message
        FROM pdf_translation_v2_jobs AS j
        JOIN users AS u ON u.id = j.user_id
        LEFT JOIN background_jobs AS pdf_queue
          ON pdf_queue.id = j.id
          AND pdf_queue.user_id = j.user_id
          AND pdf_queue.job_type IN (
            'pdf_translation_v2',
            'pdf_translation_v3',
            'pdf_translation_v4',
            'pdf_translation_v5',
            'pdf_translation_v5_native',
            'pdf_translation_v6'
          )
        WHERE ($1::timestamptz IS NULL OR j.created_at >= $1::timestamptz)

        UNION ALL

        SELECT
          'xlsx'::text AS kind,
          x.id,
          COALESCE(NULLIF(x.payload_json->>'filename', ''), 'Unknown file') AS filename,
          COALESCE(NULLIF(x.payload_json->>'targetLang', ''), 'Unknown') AS target_language,
          CASE WHEN x.status = 'done' THEN 'completed' ELSE x.status END AS status,
          COALESCE(NULLIF(x.progress_json->>'stage', ''), x.status, 'unknown') AS stage,
          x.progress AS progress,
          NULL::integer AS total_pages,
          CASE
            WHEN COALESCE(x.result_json->>'translatedCells', '') ~ '^[0-9]{1,18}$'
              THEN (x.result_json->>'translatedCells')::bigint
            ELSE NULL
          END AS changed_cells,
          x.created_at,
          x.completed_at,
          COALESCE(
            NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), ''),
            u.email,
            u.username,
            'Unknown'
          ) AS user_name,
          u.email AS user_email,
          NULL::jsonb AS pdf_metrics,
          x.result_json AS xlsx_result,
          CASE WHEN x.status = 'error' THEN NULLIF(BTRIM(x.last_error), '') ELSE NULL END AS error,
          NULLIF(x.progress_json->>'message', '') AS message
        FROM background_jobs AS x
        JOIN users AS u ON u.id = x.user_id
        WHERE x.job_type = 'xlsx_translation_v1'
          AND ($1::timestamptz IS NULL OR x.created_at >= $1::timestamptz)
      ),
      filtered AS (
        SELECT * FROM jobs
        WHERE ($2::text = 'all' OR kind = $2::text)
          AND strpos(lower(COALESCE(filename, '')), lower($4::text)) > 0
          AND CASE $3::text
            WHEN 'active' THEN status IN ('queued', 'processing', 'cancelling')
            WHEN 'completed' THEN status = 'completed'
            WHEN 'attention' THEN status IN ('error', 'cancelled')
            WHEN 'draft' THEN status = 'draft'
            ELSE TRUE
          END
      ),
      totals AS (
        SELECT count(*)::bigint AS total FROM filtered
      ),
      page_jobs AS (
        SELECT * FROM filtered
        ORDER BY created_at DESC, kind DESC, id DESC
        LIMIT $5::integer OFFSET $6::integer
      )
      SELECT
        totals.total,
        COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'kind', page_jobs.kind,
              'id', page_jobs.id::text,
              'filename', page_jobs.filename,
              'targetLanguage', page_jobs.target_language,
              'status', page_jobs.status,
              'stage', page_jobs.stage,
              'progress', page_jobs.progress,
              'totalPages', page_jobs.total_pages,
              'changedCells', page_jobs.changed_cells,
              'createdAt', page_jobs.created_at,
              'completedAt', page_jobs.completed_at,
              'userName', page_jobs.user_name,
              'userEmail', page_jobs.user_email,
              'inputTokens', CASE
                WHEN page_jobs.kind = 'pdf' THEN
                  CASE
                    WHEN COALESCE(page_jobs.pdf_metrics #>> '{requestLedger,inputTokens}', '') ~ '^[0-9]{1,18}$'
                      THEN (page_jobs.pdf_metrics #>> '{requestLedger,inputTokens}')::bigint
                    ELSE COALESCE(page_usage.page_input_tokens, 0) +
                      CASE
                        WHEN COALESCE(page_jobs.pdf_metrics->>'contextInputTokens', '') ~ '^[0-9]{1,18}$'
                          THEN (page_jobs.pdf_metrics->>'contextInputTokens')::bigint
                        ELSE 0
                      END
                  END
                ELSE COALESCE(
                  CASE
                    WHEN COALESCE(page_jobs.xlsx_result->>'inputTokens', '') ~ '^[0-9]{1,18}$'
                      THEN (page_jobs.xlsx_result->>'inputTokens')::bigint
                    ELSE NULL
                  END,
                  0
                )
              END,
              'outputTokens', CASE
                WHEN page_jobs.kind = 'pdf' THEN
                  CASE
                    WHEN COALESCE(page_jobs.pdf_metrics #>> '{requestLedger,outputTokens}', '') ~ '^[0-9]{1,18}$'
                      THEN (page_jobs.pdf_metrics #>> '{requestLedger,outputTokens}')::bigint
                    ELSE COALESCE(page_usage.page_output_tokens, 0) +
                      CASE
                        WHEN COALESCE(page_jobs.pdf_metrics->>'contextOutputTokens', '') ~ '^[0-9]{1,18}$'
                          THEN (page_jobs.pdf_metrics->>'contextOutputTokens')::bigint
                        ELSE 0
                      END
                  END
                ELSE COALESCE(
                  CASE
                    WHEN COALESCE(page_jobs.xlsx_result->>'outputTokens', '') ~ '^[0-9]{1,18}$'
                      THEN (page_jobs.xlsx_result->>'outputTokens')::bigint
                    ELSE NULL
                  END,
                  0
                )
              END,
              'requests', CASE
                WHEN page_jobs.kind = 'pdf' THEN
                  CASE
                    WHEN jsonb_typeof(page_jobs.pdf_metrics #> '{requestLedger,counts}') = 'object'
                      THEN COALESCE((
                        SELECT SUM(CASE WHEN entry.value ~ '^[0-9]{1,9}$' THEN entry.value::bigint ELSE 0 END)
                        FROM jsonb_each_text(page_jobs.pdf_metrics #> '{requestLedger,counts}') AS entry
                      ), 0)
                    ELSE NULL
                  END
                ELSE CASE
                  WHEN COALESCE(page_jobs.xlsx_result->>'requests', '') ~ '^[0-9]{1,9}$'
                    THEN (page_jobs.xlsx_result->>'requests')::bigint
                  ELSE NULL
                END
              END,
              'message', page_jobs.message,
              'error', page_jobs.error,
              'errorTruncated', COALESCE(char_length(page_jobs.error) > 12000, FALSE)
            )
            ORDER BY page_jobs.created_at DESC, page_jobs.kind DESC, page_jobs.id DESC
          ) FILTER (WHERE page_jobs.id IS NOT NULL),
          '[]'::jsonb
        ) AS items
      FROM totals
      LEFT JOIN page_jobs ON TRUE
      LEFT JOIN LATERAL (
        SELECT
          COALESCE(SUM(p.input_tokens), 0)::bigint AS page_input_tokens,
          COALESCE(SUM(p.output_tokens), 0)::bigint AS page_output_tokens
        FROM pdf_translation_v2_pages AS p
        WHERE page_jobs.kind = 'pdf' AND p.job_id = page_jobs.id
      ) AS page_usage ON TRUE
      GROUP BY totals.total
    `,
    parameters: [
      query.createdSince,
      query.kind,
      query.status,
      query.q,
      query.pageSize,
      query.skip,
    ],
  };
}
