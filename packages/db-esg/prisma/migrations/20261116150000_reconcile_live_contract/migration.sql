-- Reconcile the checked-in ESG Prisma schema with the legacy scraper-managed
-- contract that is already present in production.  Every operation is safe to
-- rerun so production databases that already have the live shape are no-ops.
BEGIN;

DO $$
BEGIN
  -- The scraper permits missing article titles and links.
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'esg_articles'
               AND column_name IN ('title', 'link') AND is_nullable = 'NO') THEN
    ALTER TABLE "esg_articles"
      ALTER COLUMN "title" DROP NOT NULL,
      ALTER COLUMN "link" DROP NOT NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'esg_articles'
               AND column_name = 'save_time'
               AND COALESCE(column_default, '') NOT IN
                   ('CURRENT_TIMESTAMP', 'now()', 'transaction_timestamp()')) THEN
    ALTER TABLE "esg_articles"
      ALTER COLUMN "save_time" SET DEFAULT CURRENT_TIMESTAMP;
  END IF;

  IF (SELECT data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'esg_articles'
        AND column_name = 'published') <> 'date' THEN
    IF EXISTS (SELECT 1 FROM "esg_articles" LIMIT 1) THEN
      RAISE EXCEPTION 'Refusing to convert populated esg_articles.published to DATE; reconcile data first';
    END IF;
    ALTER TABLE "esg_articles"
      ALTER COLUMN "published" TYPE DATE USING "published"::date;
  END IF;

  IF (SELECT data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'esg_articles'
        AND column_name = 'save_time') <> 'timestamp without time zone' THEN
    IF EXISTS (SELECT 1 FROM "esg_articles" LIMIT 1) THEN
      RAISE EXCEPTION 'Refusing to convert populated esg_articles.save_time to TIMESTAMP; reconcile data first';
    END IF;
    ALTER TABLE "esg_articles"
      ALTER COLUMN "save_time" TYPE TIMESTAMP(6) USING "save_time"::timestamp(6);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'events'
                   AND column_name = 'detail_scrape_status') THEN
    ALTER TABLE "events" ADD COLUMN "detail_scrape_status" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'events'
                   AND column_name = 'event_data') THEN
    ALTER TABLE "events" ADD COLUMN "event_data" JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'events'
                   AND column_name = 'original_language') THEN
    ALTER TABLE "events" ADD COLUMN "original_language" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'events'
                   AND column_name = 'translation_model') THEN
    ALTER TABLE "events" ADD COLUMN "translation_model" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'events'
                   AND column_name = 'translation_status') THEN
    ALTER TABLE "events" ADD COLUMN "translation_status" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'events'
                   AND column_name = 'updated_at') THEN
    ALTER TABLE "events" ADD COLUMN "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP;
  ELSIF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'events'
                  AND column_name = 'updated_at'
                  AND COALESCE(column_default, '') NOT IN
                      ('CURRENT_TIMESTAMP', 'now()', 'transaction_timestamp()')) THEN
    ALTER TABLE "events" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
  END IF;
END
$$;

DO $$
BEGIN
  -- Publications use nullable text fields and timestamp-without-time-zone
  -- storage in the live scraper contract.
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'publications'
               AND column_name IN ('title', 'link') AND is_nullable = 'NO') THEN
    ALTER TABLE "publications"
      ALTER COLUMN "title" DROP NOT NULL,
      ALTER COLUMN "link" DROP NOT NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'publications'
               AND column_name = 'save_time'
               AND COALESCE(column_default, '') NOT IN
                   ('CURRENT_TIMESTAMP', 'now()', 'transaction_timestamp()')) THEN
    ALTER TABLE "publications"
      ALTER COLUMN "save_time" SET DEFAULT CURRENT_TIMESTAMP;
  END IF;

  IF (SELECT data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'publications'
        AND column_name = 'published') <> 'timestamp without time zone' THEN
    IF EXISTS (SELECT 1 FROM "publications" LIMIT 1) THEN
      RAISE EXCEPTION 'Refusing to convert populated publications.published to TIMESTAMP; reconcile data first';
    END IF;
    ALTER TABLE "publications"
      ALTER COLUMN "published" TYPE TIMESTAMP(6) USING "published"::timestamp(6);
  END IF;

  IF (SELECT data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'publications'
        AND column_name = 'save_time') <> 'timestamp without time zone' THEN
    IF EXISTS (SELECT 1 FROM "publications" LIMIT 1) THEN
      RAISE EXCEPTION 'Refusing to convert populated publications.save_time to TIMESTAMP; reconcile data first';
    END IF;
    ALTER TABLE "publications"
      ALTER COLUMN "save_time" TYPE TIMESTAMP(6) USING "save_time"::timestamp(6);
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'user_preferences'
               AND column_name = 'preferred_sources'
               AND COALESCE(column_default, '') NOT IN
                   ('''{}''::text[]', 'ARRAY[]::text[]')) THEN
    ALTER TABLE "user_preferences" ALTER COLUMN "preferred_sources" SET DEFAULT '{}'::text[];
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'user_preferences'
               AND column_name = 'preferred_topics'
               AND COALESCE(column_default, '') NOT IN
                   ('''{}''::text[]', 'ARRAY[]::text[]')) THEN
    ALTER TABLE "user_preferences" ALTER COLUMN "preferred_topics" SET DEFAULT '{}'::text[];
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'alert_preferences'
               AND column_name = 'sources'
               AND COALESCE(column_default, '') NOT IN
                   ('''{}''::text[]', 'ARRAY[]::text[]')) THEN
    ALTER TABLE "alert_preferences" ALTER COLUMN "sources" SET DEFAULT '{}'::text[];
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'alert_preferences'
               AND column_name = 'keywords'
               AND COALESCE(column_default, '') NOT IN
                   ('''{}''::text[]', 'ARRAY[]::text[]')) THEN
    ALTER TABLE "alert_preferences" ALTER COLUMN "keywords" SET DEFAULT '{}'::text[];
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'alert_preferences'
               AND column_name = 'immediate_sources'
               AND COALESCE(column_default, '') NOT IN
                   ('''{}''::character varying[]', 'ARRAY[]::character varying[]', 'ARRAY[]::character varying(50)[]')) THEN
    ALTER TABLE "alert_preferences" ALTER COLUMN "immediate_sources" SET DEFAULT '{}'::character varying[];
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'alert_preferences'
               AND column_name = 'immediate_keywords'
               AND COALESCE(column_default, '') NOT IN
                   ('''{}''::character varying[]', 'ARRAY[]::character varying[]', 'ARRAY[]::character varying(100)[]')) THEN
    ALTER TABLE "alert_preferences" ALTER COLUMN "immediate_keywords" SET DEFAULT '{}'::character varying[];
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'alert_preferences'
               AND column_name = 'domains'
               AND COALESCE(column_default, '') NOT IN
                   ('''{}''::character varying[]', 'ARRAY[]::character varying[]', 'ARRAY[]::character varying(20)[]')) THEN
    ALTER TABLE "alert_preferences" ALTER COLUMN "domains" SET DEFAULT '{}'::character varying[];
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'alert_history'
               AND column_name = 'content_ids'
               AND COALESCE(column_default, '') NOT IN
                   ('''{}''::integer[]', 'ARRAY[]::integer[]')) THEN
    ALTER TABLE "alert_history" ALTER COLUMN "content_ids" SET DEFAULT '{}'::integer[];
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'esg_driver_jobs'
               AND column_name = 'id' AND column_default IS NOT NULL) THEN
    ALTER TABLE "esg_driver_jobs" ALTER COLUMN "id" DROP DEFAULT;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'tender_classifications'
               AND column_name = 'esg_keywords'
               AND COALESCE(column_default, '') NOT IN
                   ('''{}''::text[]', 'ARRAY[]::text[]')) THEN
    ALTER TABLE "tender_classifications" ALTER COLUMN "esg_keywords" SET DEFAULT '{}'::text[];
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'tender_classifications'
               AND column_name = 'credit_keywords'
               AND COALESCE(column_default, '') NOT IN
                   ('''{}''::text[]', 'ARRAY[]::text[]')) THEN
    ALTER TABLE "tender_classifications" ALTER COLUMN "credit_keywords" SET DEFAULT '{}'::text[];
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'user_saved_tenders'
               AND column_name = 'tags'
               AND COALESCE(column_default, '') NOT IN
                   ('''{}''::text[]', 'ARRAY[]::text[]')) THEN
    ALTER TABLE "user_saved_tenders" ALTER COLUMN "tags" SET DEFAULT '{}'::text[];
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'user_tender_alerts'
               AND column_name = 'keywords'
               AND COALESCE(column_default, '') NOT IN
                   ('''{}''::text[]', 'ARRAY[]::text[]')) THEN
    ALTER TABLE "user_tender_alerts" ALTER COLUMN "keywords" SET DEFAULT '{}'::text[];
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'user_tender_alerts'
               AND column_name = 'excluded_keywords'
               AND COALESCE(column_default, '') NOT IN
                   ('''{}''::text[]', 'ARRAY[]::text[]')) THEN
    ALTER TABLE "user_tender_alerts" ALTER COLUMN "excluded_keywords" SET DEFAULT '{}'::text[];
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'user_tender_alerts'
               AND column_name = 'countries'
               AND COALESCE(column_default, '') NOT IN
                   ('''{}''::character varying[]', 'ARRAY[]::character varying[]', 'ARRAY[]::character varying(100)[]')) THEN
    ALTER TABLE "user_tender_alerts" ALTER COLUMN "countries" SET DEFAULT '{}'::character varying[];
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'user_tender_alerts'
               AND column_name = 'domains'
               AND COALESCE(column_default, '') NOT IN
                   ('''{}''::character varying[]', 'ARRAY[]::character varying[]', 'ARRAY[]::character varying(20)[]')) THEN
    ALTER TABLE "user_tender_alerts" ALTER COLUMN "domains" SET DEFAULT '{}'::character varying[];
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'weekly_digest'
               AND column_name = 'created_at' AND is_nullable = 'NO') THEN
    ALTER TABLE "weekly_digest" ALTER COLUMN "created_at" DROP NOT NULL;
  END IF;
END
$$;

DO $$
BEGIN
  IF to_regclass('public.idx_monitored_tender_candidates_matched_groups') IS NULL THEN
    CREATE INDEX "idx_monitored_tender_candidates_matched_groups"
      ON "monitored_tender_candidates" USING GIN ("matched_groups" array_ops);
  END IF;
  IF to_regclass('public.idx_monitored_tenders_match_details') IS NULL THEN
    CREATE INDEX "idx_monitored_tenders_match_details"
      ON "monitored_tenders" USING GIN ("match_details" jsonb_ops);
  END IF;
  IF to_regclass('public.idx_monitored_tenders_matched_groups') IS NULL THEN
    CREATE INDEX "idx_monitored_tenders_matched_groups"
      ON "monitored_tenders" USING GIN ("matched_groups" array_ops);
  END IF;
  IF to_regclass('public.idx_monitored_tenders_raw_json') IS NULL THEN
    CREATE INDEX "idx_monitored_tenders_raw_json"
      ON "monitored_tenders" USING GIN ("raw_json" jsonb_ops);
  END IF;
END
$$;

-- Constraint/index names are part of Prisma's introspected contract.  Rename
-- only when the old name exists and the live name does not.
DO $$
BEGIN
  IF to_regclass('public.events_pkey') IS NOT NULL
     AND to_regclass('public.esg_events_pkey') IS NULL THEN
    ALTER TABLE "events" RENAME CONSTRAINT "events_pkey" TO "esg_events_pkey";
  END IF;

  IF to_regclass('public.publications_pkey') IS NOT NULL
     AND to_regclass('public.esg_publications_pkey') IS NULL THEN
    ALTER TABLE "publications" RENAME CONSTRAINT "publications_pkey" TO "esg_publications_pkey";
  END IF;

  IF to_regclass('public.esg_articles_link_unique') IS NOT NULL
     AND to_regclass('public.esg_articles_link_key') IS NULL THEN
    ALTER INDEX "esg_articles_link_unique" RENAME TO "esg_articles_link_key";
  END IF;

  IF to_regclass('public.events_event_id_key') IS NOT NULL
     AND to_regclass('public.esg_events_event_id_key') IS NULL THEN
    ALTER INDEX "events_event_id_key" RENAME TO "esg_events_event_id_key";
  END IF;

  IF to_regclass('public.publications_link_unique') IS NOT NULL
     AND to_regclass('public.esg_publications_link_key') IS NULL THEN
    ALTER INDEX "publications_link_unique" RENAME TO "esg_publications_link_key";
  END IF;
END
$$;

DO $$
BEGIN
  IF to_regclass('public.unique_event_composite') IS NOT NULL THEN
    DROP INDEX "unique_event_composite";
  END IF;
END
$$;

COMMIT;
