import "server-only";

import { esgPrisma } from "@esgcredit/db-esg";

import { isMissingMonitoredTenderSchema } from "./queries";

export type TenderMonitorSummary = {
  total_tenders: number;
  active_tenders: number;
  esg_tenders: number;
  credit_tenders: number;
  latest_first_seen_at: Date | null;
  latest_last_seen_at: Date | null;
  total_sources: number;
  enabled_sources: number;
  email_recipients: number;
  emails_sent_7d: number;
  emails_failed_7d: number;
  candidates_24h: number;
  unmatched_candidates_24h: number;
  open_alerts: number;
  latest_run_at: Date | null;
  failed_runs_24h: number;
};

export type TenderMonitorSourceHealth = {
  name: string;
  display_name: string;
  country: string;
  enabled: boolean;
  schedule_minutes: number;
  last_run_at: Date | null;
  last_success_at: Date | null;
  consecutive_failures: number;
  last_error: string | null;
  total_tenders_seen: number;
};

export type TenderMonitorRun = {
  id: string;
  source_name: string;
  started_at: Date;
  finished_at: Date | null;
  status: string;
  fetched: number;
  normalized: number;
  matched_total: number;
  matched_esg: number;
  matched_credit: number;
  created_count: number;
  updated_count: number;
  unchanged_count: number;
  deleted_count: number;
  emails_sent: number;
  partial_errors_count: number;
  duration_ms: number | null;
  error_type: string | null;
  error: string | null;
};

export type TenderMonitorAlert = {
  id: string;
  alert_key: string;
  alert_type: string;
  severity: string;
  status: string;
  source_name: string | null;
  title: string;
  detail: string;
  opened_at: Date;
  last_seen_at: Date;
  resolved_at: Date | null;
  notifications_sent: number;
};

export type TenderMonitorCandidateCount = {
  source_name: string;
  match_status: string;
  count: number;
};

export type TenderMonitorHealth = {
  summary: TenderMonitorSummary;
  sources: TenderMonitorSourceHealth[];
  recentRuns: TenderMonitorRun[];
  alerts: TenderMonitorAlert[];
  candidateCounts: TenderMonitorCandidateCount[];
  setupRequired?: boolean;
};

const EMPTY_SUMMARY: TenderMonitorSummary = {
  total_tenders: 0,
  active_tenders: 0,
  esg_tenders: 0,
  credit_tenders: 0,
  latest_first_seen_at: null,
  latest_last_seen_at: null,
  total_sources: 0,
  enabled_sources: 0,
  email_recipients: 0,
  emails_sent_7d: 0,
  emails_failed_7d: 0,
  candidates_24h: 0,
  unmatched_candidates_24h: 0,
  open_alerts: 0,
  latest_run_at: null,
  failed_runs_24h: 0,
};

export async function getTenderMonitorHealth(): Promise<TenderMonitorHealth> {
  try {
    const [summaryRows, sources, recentRuns, alerts, candidateCounts] =
      await Promise.all([
        esgPrisma.$queryRaw<TenderMonitorSummary[]>`
          SELECT
            (SELECT count(*)::int FROM monitored_tenders) AS total_tenders,
            (SELECT count(*)::int FROM monitored_tenders WHERE is_active) AS active_tenders,
            (
              SELECT count(*)::int
              FROM monitored_tenders
              WHERE is_active AND array_position(matched_groups, 'esg') IS NOT NULL
            ) AS esg_tenders,
            (
              SELECT count(*)::int
              FROM monitored_tenders
              WHERE is_active AND array_position(matched_groups, 'credit_rating') IS NOT NULL
            ) AS credit_tenders,
            (SELECT max(first_seen_at) FROM monitored_tenders) AS latest_first_seen_at,
            (SELECT max(last_seen_at) FROM monitored_tenders) AS latest_last_seen_at,
            (SELECT count(*)::int FROM monitored_tender_sources) AS total_sources,
            (
              SELECT count(*)::int
              FROM monitored_tender_sources
              WHERE enabled
            ) AS enabled_sources,
            (
              SELECT count(*)::int
              FROM monitored_email_recipients
              WHERE enabled
            ) AS email_recipients,
            (
              SELECT count(*)::int
              FROM monitored_notification_logs
              WHERE channel = 'email'
                AND status = 'sent'
                AND sent_at >= now() - interval '7 days'
            ) AS emails_sent_7d,
            (
              SELECT count(*)::int
              FROM monitored_notification_logs
              WHERE channel = 'email'
                AND status = 'failed'
                AND sent_at >= now() - interval '7 days'
            ) AS emails_failed_7d,
            (
              SELECT count(*)::int
              FROM monitored_tender_candidates
              WHERE seen_at >= now() - interval '24 hours'
            ) AS candidates_24h,
            (
              SELECT count(*)::int
              FROM monitored_tender_candidates
              WHERE match_status = 'unmatched'
                AND seen_at >= now() - interval '24 hours'
            ) AS unmatched_candidates_24h,
            (
              SELECT count(*)::int
              FROM monitored_system_alerts
              WHERE status = 'open'
            ) AS open_alerts,
            (SELECT max(started_at) FROM monitored_ingest_runs) AS latest_run_at,
            (
              SELECT count(*)::int
              FROM monitored_ingest_runs
              WHERE status = 'failed'
                AND started_at >= now() - interval '24 hours'
            ) AS failed_runs_24h
        `,
        esgPrisma.$queryRaw<TenderMonitorSourceHealth[]>`
          SELECT
            name,
            display_name,
            country,
            enabled,
            schedule_minutes,
            last_run_at,
            last_success_at,
            consecutive_failures,
            last_error,
            total_tenders_seen
          FROM monitored_tender_sources
          ORDER BY country ASC, display_name ASC
        `,
        esgPrisma.$queryRaw<TenderMonitorRun[]>`
          SELECT
            id::text AS id,
            source_name,
            started_at,
            finished_at,
            status,
            fetched,
            normalized,
            matched_total,
            matched_esg,
            matched_credit,
            created_count,
            updated_count,
            unchanged_count,
            deleted_count,
            emails_sent,
            partial_errors_count,
            duration_ms::float8 AS duration_ms,
            error_type,
            error
          FROM monitored_ingest_runs
          ORDER BY started_at DESC
          LIMIT 24
        `,
        esgPrisma.$queryRaw<TenderMonitorAlert[]>`
          SELECT
            id::text AS id,
            alert_key,
            alert_type,
            severity,
            status,
            source_name,
            title,
            detail,
            opened_at,
            last_seen_at,
            resolved_at,
            notifications_sent
          FROM monitored_system_alerts
          ORDER BY
            CASE WHEN status = 'open' THEN 0 ELSE 1 END,
            last_seen_at DESC
          LIMIT 20
        `,
        esgPrisma.$queryRaw<TenderMonitorCandidateCount[]>`
          SELECT
            source_name,
            match_status,
            count(*)::int AS count
          FROM monitored_tender_candidates
          WHERE seen_at >= now() - interval '24 hours'
          GROUP BY source_name, match_status
          ORDER BY source_name ASC, match_status ASC
        `,
      ]);

    return {
      summary: summaryRows[0] ?? EMPTY_SUMMARY,
      sources,
      recentRuns,
      alerts,
      candidateCounts,
    };
  } catch (error) {
    if (!isMissingMonitoredTenderSchema(error)) throw error;
    return {
      summary: EMPTY_SUMMARY,
      sources: [],
      recentRuns: [],
      alerts: [],
      candidateCounts: [],
      setupRequired: true,
    };
  }
}
