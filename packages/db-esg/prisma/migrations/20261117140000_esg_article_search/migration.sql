-- Local, read-only article archive search support.  The scraper-owned
-- esg_articles columns remain unchanged; these indexes only accelerate
-- expression-based reads.
BEGIN;

-- pg_trgm is a PostgreSQL contrib extension available in the supported local
-- and managed PostgreSQL images.  The application still probes both the
-- extension and its index at read time so an older/un-migrated database keeps
-- full-text and prefix search without claiming typo tolerance.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "esg_articles_search_fts_idx"
  ON "esg_articles" USING GIN (
    (
      setweight(to_tsvector('simple'::regconfig, COALESCE("title", '')), 'A')
        || setweight(to_tsvector('simple'::regconfig, COALESCE("summary", '')), 'B')
        || setweight(to_tsvector('simple'::regconfig, COALESCE("matched_keywords", '')), 'C')
        || setweight(to_tsvector('simple'::regconfig, COALESCE("source", '')), 'D')
    )
  );

CREATE INDEX IF NOT EXISTS "esg_articles_search_date_idx"
  ON "esg_articles" (
    (COALESCE("published", "save_time"::date)) DESC NULLS LAST,
    "id" DESC
  );

CREATE INDEX IF NOT EXISTS "esg_articles_search_source_date_idx"
  ON "esg_articles" (
    "source",
    (COALESCE("published", "save_time"::date)) DESC NULLS LAST,
    "id" DESC
  );

CREATE INDEX IF NOT EXISTS "esg_articles_search_title_trgm_idx"
  ON "esg_articles" USING GIN (LOWER(COALESCE("title", '')) gin_trgm_ops);

COMMIT;
