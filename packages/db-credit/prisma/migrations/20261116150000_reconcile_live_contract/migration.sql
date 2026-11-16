-- Reconcile Credit's Prisma model with the existing live PostgreSQL contract.
--
-- The production database already has the target contract. Every operation is
-- therefore catalog-guarded so applying this migration there is a no-op. A
-- fresh database reaches the same contract after the checked-in migrations.
-- No table, column, or row is dropped. The only potentially lossy conversion
-- (events.date timestamp -> date) is allowed only on an empty table.

BEGIN;

-- Remove indexes that are present in the historical Prisma baseline but not in
-- the live Credit contract.
DO $$
DECLARE
  index_name text;
BEGIN
  FOREACH index_name IN ARRAY ARRAY[
    'idx_articles_date_desc',
    'idx_articles_region',
    'idx_articles_region_sector',
    'idx_articles_sector',
    'idx_articles_source',
    'idx_credit_articles_date',
    'idx_credit_articles_region',
    'idx_credit_articles_sector',
    'idx_credit_articles_source',
    'unique_article_combination'
  ]::text[] LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_class AS index_rel
      JOIN pg_namespace AS index_schema ON index_schema.oid = index_rel.relnamespace
      JOIN pg_index AS index_meta ON index_meta.indexrelid = index_rel.oid
      WHERE index_schema.nspname = current_schema()
        AND index_rel.relname = index_name
        AND index_meta.indrelid = to_regclass(format('%I.%I', current_schema(), 'credit_articles'))
    ) THEN
      EXECUTE format('DROP INDEX %I.%I', current_schema(), index_name);
    END IF;
  END LOOP;
END
$$;

-- save_time exists in the live scraper contract. Add it only when absent and
-- repair its default only when the catalog says it is not already equivalent.
DO $$
DECLARE
  default_expression text;
BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'credit_articles')) IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = current_schema()
         AND table_name = 'credit_articles'
         AND column_name = 'save_time'
     ) THEN
    ALTER TABLE "credit_articles"
      ADD COLUMN "save_time" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP;
  ELSE
    SELECT pg_get_expr(attribute_default.adbin, attribute_default.adrelid)
    INTO default_expression
    FROM pg_attribute AS attribute
    LEFT JOIN pg_attrdef AS attribute_default
      ON attribute_default.adrelid = attribute.attrelid
     AND attribute_default.adnum = attribute.attnum
    WHERE attribute.attrelid = to_regclass(format('%I.%I', current_schema(), 'credit_articles'))
      AND attribute.attname = 'save_time'
      AND NOT attribute.attisdropped;

    IF default_expression IS NULL
       OR regexp_replace(lower(default_expression), '[[:space:]]', '', 'g')
          NOT IN ('current_timestamp', 'now()', 'transaction_timestamp()') THEN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'credit_articles'
          AND column_name = 'save_time'
      ) THEN
        ALTER TABLE "credit_articles"
          ALTER COLUMN "save_time" SET DEFAULT CURRENT_TIMESTAMP;
      END IF;
    END IF;
  END IF;
END
$$;

-- Rename primary-key constraints to the names used by the live contract.
DO $$
DECLARE
  table_name text;
  old_name text;
  new_name text;
BEGIN
  FOR table_name, old_name, new_name IN
    SELECT *
    FROM (VALUES
      ('events', 'events_pkey', 'credit_events_pkey'),
      ('methodologies', 'methodologies_pkey', 'credit_methodologies_pkey'),
      ('publications', 'publications_pkey', 'credit_publications_pkey')
    ) AS constraint_names(table_name, old_name, new_name)
  LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conrelid = to_regclass(format('%I.%I', current_schema(), table_name))
        AND conname = old_name
        AND contype = 'p'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conrelid = to_regclass(format('%I.%I', current_schema(), table_name))
        AND conname = new_name
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I.%I RENAME CONSTRAINT %I TO %I',
        current_schema(), table_name, old_name, new_name
      );
    END IF;
  END LOOP;
END
$$;

-- Widen the legacy event text columns and make title nullable. These changes
-- are non-lossy. Converting date from timestamp to date is potentially lossy,
-- so populated legacy tables fail with an actionable message instead of being
-- silently truncated.
DO $$
DECLARE
  column_type text;
  nullable_state text;
  date_type text;
  has_rows boolean;
BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'events')) IS NULL THEN
    RETURN;
  END IF;

  SELECT data_type, is_nullable
  INTO date_type, nullable_state
  FROM information_schema.columns
  WHERE table_schema = current_schema()
    AND table_name = 'events'
    AND column_name = 'date';

  IF date_type IS NOT NULL AND date_type <> 'date' THEN
    SELECT EXISTS (SELECT 1 FROM "events") INTO has_rows;
    IF has_rows THEN
      RAISE EXCEPTION
        'Credit live-contract migration cannot convert events.date to DATE because events contains rows; export/convert the data and rerun the migration';
    END IF;
    ALTER TABLE "events"
      ALTER COLUMN "date" TYPE DATE USING "date"::date;
  END IF;

  IF nullable_state = 'NO' THEN
    ALTER TABLE "events" ALTER COLUMN "date" DROP NOT NULL;
  END IF;

  SELECT data_type, is_nullable
  INTO column_type, nullable_state
  FROM information_schema.columns
  WHERE table_schema = current_schema()
    AND table_name = 'events'
    AND column_name = 'title';
  IF column_type IS NOT NULL AND column_type <> 'text' THEN
    ALTER TABLE "events" ALTER COLUMN "title" TYPE TEXT USING "title"::text;
  END IF;
  IF nullable_state = 'NO' THEN
    ALTER TABLE "events" ALTER COLUMN "title" DROP NOT NULL;
  END IF;

  FOREACH column_type IN ARRAY ARRAY['location', 'link', 'source']::text[] LOOP
    SELECT data_type
    INTO nullable_state
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'events'
      AND column_name = column_type;

    IF nullable_state IS NOT NULL AND nullable_state <> 'text' THEN
      EXECUTE format(
        'ALTER TABLE %I.%I ALTER COLUMN %I TYPE TEXT USING %I::text',
        current_schema(), 'events', column_type, column_type
      );
    END IF;
  END LOOP;
END
$$;

-- methodology.report_url is text in production and is not unique. The link
-- uniqueness is retained under its live index name.
DO $$
DECLARE
  column_type text;
  old_index_exists boolean;
  new_index_exists boolean;
BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'methodologies')) IS NULL THEN
    RETURN;
  END IF;

  SELECT data_type
  INTO column_type
  FROM information_schema.columns
  WHERE table_schema = current_schema()
    AND table_name = 'methodologies'
    AND column_name = 'report_url';
  IF column_type IS NOT NULL AND column_type <> 'text' THEN
    ALTER TABLE "methodologies"
      ALTER COLUMN "report_url" TYPE TEXT USING "report_url"::text;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM pg_class AS index_rel
    JOIN pg_namespace AS index_schema ON index_schema.oid = index_rel.relnamespace
    JOIN pg_index AS index_meta ON index_meta.indexrelid = index_rel.oid
    WHERE index_schema.nspname = current_schema()
      AND index_rel.relname = 'methodologies_report_url_key'
      AND index_meta.indrelid = to_regclass(format('%I.%I', current_schema(), 'methodologies'))
  ) INTO old_index_exists;
  IF old_index_exists THEN
    EXECUTE format('DROP INDEX %I.%I', current_schema(), 'methodologies_report_url_key');
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM pg_class AS index_rel
    JOIN pg_namespace AS index_schema ON index_schema.oid = index_rel.relnamespace
    JOIN pg_index AS index_meta ON index_meta.indexrelid = index_rel.oid
    WHERE index_schema.nspname = current_schema()
      AND index_rel.relname = 'methodologies_link_key'
      AND index_meta.indrelid = to_regclass(format('%I.%I', current_schema(), 'methodologies'))
  ) INTO old_index_exists;
  SELECT EXISTS (
    SELECT 1
    FROM pg_class AS index_rel
    JOIN pg_namespace AS index_schema ON index_schema.oid = index_rel.relnamespace
    JOIN pg_index AS index_meta ON index_meta.indexrelid = index_rel.oid
    WHERE index_schema.nspname = current_schema()
      AND index_rel.relname = 'credit_methodologies_link_key'
      AND index_meta.indrelid = to_regclass(format('%I.%I', current_schema(), 'methodologies'))
  ) INTO new_index_exists;
  IF old_index_exists AND NOT new_index_exists THEN
    EXECUTE format(
      'ALTER INDEX %I.%I RENAME TO %I',
      current_schema(), 'methodologies_link_key', 'credit_methodologies_link_key'
    );
  ELSIF NOT new_index_exists THEN
    CREATE UNIQUE INDEX "credit_methodologies_link_key" ON "methodologies"("link");
  END IF;
END
$$;

-- The live scraper expects empty text-array defaults for these preferences.
DO $$
DECLARE
  column_name text;
  default_expression text;
BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'newsletter_preferences')) IS NULL THEN
    RETURN;
  END IF;

  FOREACH column_name IN ARRAY ARRAY['sources', 'regions', 'sectors']::text[] LOOP
    SELECT pg_get_expr(attribute_default.adbin, attribute_default.adrelid)
    INTO default_expression
    FROM pg_attribute AS attribute
    LEFT JOIN pg_attrdef AS attribute_default
      ON attribute_default.adrelid = attribute.attrelid
     AND attribute_default.adnum = attribute.attnum
    WHERE attribute.attrelid = to_regclass(format('%I.%I', current_schema(), 'newsletter_preferences'))
      AND attribute.attname = column_name
      AND NOT attribute.attisdropped;

    IF default_expression IS NULL
       OR regexp_replace(lower(default_expression), '[[:space:]]', '', 'g')
          NOT IN ('array[]::text[]', '''{}''::text[]') THEN
      EXECUTE format(
        'ALTER TABLE %I.%I ALTER COLUMN %I SET DEFAULT ARRAY[]::TEXT[]',
        current_schema(), 'newsletter_preferences', column_name
      );
    END IF;
  END LOOP;
END
$$;

-- Rename or recreate the live methodology/publication link indexes only when
-- pg_catalog shows that the desired index is absent.
DO $$
DECLARE
  old_index_exists boolean;
  new_index_exists boolean;
BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'publications')) IS NULL THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM pg_class AS index_rel
    JOIN pg_namespace AS index_schema ON index_schema.oid = index_rel.relnamespace
    JOIN pg_index AS index_meta ON index_meta.indexrelid = index_rel.oid
    WHERE index_schema.nspname = current_schema()
      AND index_rel.relname = 'publications_link_key'
      AND index_meta.indrelid = to_regclass(format('%I.%I', current_schema(), 'publications'))
  ) INTO old_index_exists;
  SELECT EXISTS (
    SELECT 1
    FROM pg_class AS index_rel
    JOIN pg_namespace AS index_schema ON index_schema.oid = index_rel.relnamespace
    JOIN pg_index AS index_meta ON index_meta.indexrelid = index_rel.oid
    WHERE index_schema.nspname = current_schema()
      AND index_rel.relname = 'credit_publications_link_key'
      AND index_meta.indrelid = to_regclass(format('%I.%I', current_schema(), 'publications'))
  ) INTO new_index_exists;
  IF old_index_exists AND NOT new_index_exists THEN
    EXECUTE format(
      'ALTER INDEX %I.%I RENAME TO %I',
      current_schema(), 'publications_link_key', 'credit_publications_link_key'
    );
  ELSIF NOT new_index_exists THEN
    CREATE UNIQUE INDEX "credit_publications_link_key" ON "publications"("link");
  END IF;
END
$$;

-- Ensure the single-column nullable-link uniqueness that exists in production.
-- Duplicate non-null links are rejected explicitly so no data is removed.
DO $$
DECLARE
  target_index_exists boolean;
  duplicate_link text;
BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'credit_articles')) IS NULL THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM pg_class AS index_rel
    JOIN pg_namespace AS index_schema ON index_schema.oid = index_rel.relnamespace
    JOIN pg_index AS index_meta ON index_meta.indexrelid = index_rel.oid
    WHERE index_schema.nspname = current_schema()
      AND index_rel.relname = 'credit_articles_link_key'
      AND index_meta.indrelid = to_regclass(format('%I.%I', current_schema(), 'credit_articles'))
      AND index_meta.indisunique
      AND index_meta.indnatts = 1
      AND EXISTS (
        SELECT 1
        FROM pg_attribute AS indexed_column
        WHERE indexed_column.attrelid = index_meta.indrelid
          AND indexed_column.attnum = ANY(index_meta.indkey)
          AND indexed_column.attname = 'link'
      )
  ) INTO target_index_exists;

  IF NOT target_index_exists THEN
    IF EXISTS (
      SELECT 1
      FROM pg_class AS index_rel
      JOIN pg_namespace AS index_schema ON index_schema.oid = index_rel.relnamespace
      JOIN pg_index AS index_meta ON index_meta.indexrelid = index_rel.oid
      WHERE index_schema.nspname = current_schema()
        AND index_rel.relname = 'credit_articles_link_key'
        AND index_meta.indrelid = to_regclass(format('%I.%I', current_schema(), 'credit_articles'))
    ) THEN
      RAISE EXCEPTION
        'Credit live-contract migration found an incompatible credit_articles_link_key index; inspect it before rerunning';
    END IF;

    SELECT link
    INTO duplicate_link
    FROM "credit_articles"
    WHERE link IS NOT NULL
    GROUP BY link
    HAVING COUNT(*) > 1
    LIMIT 1;
    IF duplicate_link IS NOT NULL THEN
      RAISE EXCEPTION
        'Credit live-contract migration cannot create unique credit_articles.link; duplicate value is %',
        duplicate_link;
    END IF;

    CREATE UNIQUE INDEX "credit_articles_link_key" ON "credit_articles"("link");
  END IF;
END
$$;

-- Align the two historical Fitch index names with the live contract. If both
-- names are absent, create the target index; if production already has the
-- target, no DDL is emitted.
DO $$
DECLARE
  old_index_exists boolean;
  new_index_exists boolean;
BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'fitch_upload_history')) IS NULL THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM pg_class AS index_rel
    JOIN pg_namespace AS index_schema ON index_schema.oid = index_rel.relnamespace
    JOIN pg_index AS index_meta ON index_meta.indexrelid = index_rel.oid
    WHERE index_schema.nspname = current_schema()
      AND index_rel.relname = 'fitch_upload_history_user_email_idx'
      AND index_meta.indrelid = to_regclass(format('%I.%I', current_schema(), 'fitch_upload_history'))
  ) INTO old_index_exists;
  SELECT EXISTS (
    SELECT 1
    FROM pg_class AS index_rel
    JOIN pg_namespace AS index_schema ON index_schema.oid = index_rel.relnamespace
    JOIN pg_index AS index_meta ON index_meta.indexrelid = index_rel.oid
    WHERE index_schema.nspname = current_schema()
      AND index_rel.relname = 'idx_fitch_upload_history_user_email'
      AND index_meta.indrelid = to_regclass(format('%I.%I', current_schema(), 'fitch_upload_history'))
  ) INTO new_index_exists;
  IF old_index_exists AND NOT new_index_exists THEN
    EXECUTE format(
      'ALTER INDEX %I.%I RENAME TO %I',
      current_schema(), 'fitch_upload_history_user_email_idx', 'idx_fitch_upload_history_user_email'
    );
  ELSIF NOT new_index_exists THEN
    CREATE INDEX "idx_fitch_upload_history_user_email" ON "fitch_upload_history"("user_email");
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM pg_class AS index_rel
    JOIN pg_namespace AS index_schema ON index_schema.oid = index_rel.relnamespace
    JOIN pg_index AS index_meta ON index_meta.indexrelid = index_rel.oid
    WHERE index_schema.nspname = current_schema()
      AND index_rel.relname = 'fitch_upload_history_created_at_idx'
      AND index_meta.indrelid = to_regclass(format('%I.%I', current_schema(), 'fitch_upload_history'))
  ) INTO old_index_exists;
  SELECT EXISTS (
    SELECT 1
    FROM pg_class AS index_rel
    JOIN pg_namespace AS index_schema ON index_schema.oid = index_rel.relnamespace
    JOIN pg_index AS index_meta ON index_meta.indexrelid = index_rel.oid
    WHERE index_schema.nspname = current_schema()
      AND index_rel.relname = 'idx_fitch_upload_history_created_at'
      AND index_meta.indrelid = to_regclass(format('%I.%I', current_schema(), 'fitch_upload_history'))
  ) INTO new_index_exists;
  IF old_index_exists AND NOT new_index_exists THEN
    EXECUTE format(
      'ALTER INDEX %I.%I RENAME TO %I',
      current_schema(), 'fitch_upload_history_created_at_idx', 'idx_fitch_upload_history_created_at'
    );
  ELSIF NOT new_index_exists THEN
    CREATE INDEX "idx_fitch_upload_history_created_at" ON "fitch_upload_history"("created_at");
  END IF;
END
$$;

COMMIT;
