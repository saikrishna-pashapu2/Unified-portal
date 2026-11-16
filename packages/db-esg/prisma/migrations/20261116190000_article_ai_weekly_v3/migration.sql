BEGIN;

-- Weekly v3 reuses the existing shared assessment/selection/feedback anchor.
-- Policy-2 daily rows remain intact and are never rewritten by this migration.
ALTER TABLE "article_ai_domain_assessments"
  ADD COLUMN "source_start_at" TIMESTAMPTZ(6),
  ADD COLUMN "source_cutoff_at" TIMESTAMPTZ(6),
  ADD COLUMN "processing_at" TIMESTAMPTZ(6),
  ADD COLUMN "email_at" TIMESTAMPTZ(6),
  ADD COLUMN "valid_until" TIMESTAMPTZ(6),
  ADD COLUMN "manifest_cutoff_at" TIMESTAMPTZ(6),
  ADD COLUMN "phase" VARCHAR(32),
  ADD COLUMN "coverage_json" JSONB,
  ADD COLUMN "manifest_hash" VARCHAR(128);

ALTER TABLE "article_ai_domain_assessments"
  ADD CONSTRAINT "article_ai_domain_assessments_phase_check"
  CHECK ("phase" IS NULL OR "phase" IN (
    'manifest', 'history_profile', 'history_merge',
    'candidate_evaluation', 'candidate_merge', 'finalize'
  ));

CREATE TABLE "article_ai_weekly_batches" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "assessment_id" UUID NOT NULL,
  "phase" VARCHAR(32) NOT NULL,
  "level" INTEGER NOT NULL DEFAULT 0,
  "batch_index" INTEGER NOT NULL,
  "state" VARCHAR(16) NOT NULL DEFAULT 'queued',
  "input_hash" VARCHAR(128) NOT NULL,
  "input_count" INTEGER NOT NULL DEFAULT 0,
  "processed_count" INTEGER NOT NULL DEFAULT 0,
  "input_refs_json" JSONB NOT NULL,
  "output_json" JSONB,
  "output_hash" VARCHAR(128),
  "eliminations_json" JSONB,
  "attempt" INTEGER NOT NULL DEFAULT 0,
  "request_count" INTEGER NOT NULL DEFAULT 0,
  "input_tokens" INTEGER NOT NULL DEFAULT 0,
  "output_tokens" INTEGER NOT NULL DEFAULT 0,
  "lease_owner" VARCHAR(180),
  "lease_token" UUID,
  "lease_expires_at" TIMESTAMPTZ(6),
  "error" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "started_at" TIMESTAMPTZ(6),
  "completed_at" TIMESTAMPTZ(6),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "article_ai_weekly_batches_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "article_ai_weekly_batches_phase_check"
    CHECK ("phase" IN ('history_profile', 'history_merge', 'candidate_evaluation', 'candidate_merge')),
  CONSTRAINT "article_ai_weekly_batches_state_check"
    CHECK ("state" IN ('queued', 'running', 'ready', 'error')),
  CONSTRAINT "article_ai_weekly_batches_assessment_id_fkey"
    FOREIGN KEY ("assessment_id") REFERENCES "article_ai_domain_assessments"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "article_ai_weekly_batches_assessment_phase_batch_key"
    UNIQUE ("assessment_id", "phase", "level", "batch_index", "input_hash")
);

CREATE INDEX "idx_article_ai_weekly_batches_assessment_phase_state"
  ON "article_ai_weekly_batches"("assessment_id", "phase", "state");
CREATE INDEX "idx_article_ai_weekly_batches_lease"
  ON "article_ai_weekly_batches"("state", "lease_expires_at");

CREATE TABLE "article_ai_weekly_inputs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "assessment_id" UUID NOT NULL,
  "kind" VARCHAR(16) NOT NULL,
  "domain" VARCHAR(10) NOT NULL,
  "article_id" INTEGER NOT NULL,
  "content_hash" VARCHAR(128),
  "title" TEXT,
  "summary" TEXT,
  "content" TEXT,
  "source" TEXT,
  "url" TEXT,
  "published_at" TIMESTAMPTZ(6),
  "observed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "eligible_at" TIMESTAMPTZ(6),
  "first_seen_at" TIMESTAMPTZ(6),
  "first_seen_known" BOOLEAN NOT NULL DEFAULT FALSE,
  "source_period_start" TIMESTAMPTZ(6),
  "source_period_end" TIMESTAMPTZ(6),
  "carryover_from_week" DATE,
  "exclusion_reason" TEXT,
  "snapshot_json" JSONB,
  "state" VARCHAR(16) NOT NULL DEFAULT 'pending',
  "ordinal" INTEGER NOT NULL,
  "batch_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "article_ai_weekly_inputs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "article_ai_weekly_inputs_kind_check"
    CHECK ("kind" IN ('history', 'candidate')),
  CONSTRAINT "article_ai_weekly_inputs_domain_check"
    CHECK ("domain" IN ('esg', 'credit')),
  CONSTRAINT "article_ai_weekly_inputs_state_check"
    CHECK ("state" IN ('pending', 'assigned', 'processed', 'excluded')),
  CONSTRAINT "article_ai_weekly_inputs_assessment_id_fkey"
    FOREIGN KEY ("assessment_id") REFERENCES "article_ai_domain_assessments"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "article_ai_weekly_inputs_batch_id_fkey"
    FOREIGN KEY ("batch_id") REFERENCES "article_ai_weekly_batches"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT "article_ai_weekly_inputs_assessment_kind_article_key"
    UNIQUE ("assessment_id", "kind", "article_id")
);

CREATE INDEX "idx_article_ai_weekly_inputs_assessment_kind_state"
  ON "article_ai_weekly_inputs"("assessment_id", "kind", "state");
CREATE INDEX "idx_article_ai_weekly_inputs_assessment_article"
  ON "article_ai_weekly_inputs"("assessment_id", "article_id");
CREATE INDEX "idx_article_ai_weekly_inputs_domain_article_hash"
  ON "article_ai_weekly_inputs"("domain", "article_id", "content_hash");

-- Complete batch outputs are reusable only when domain, model, policy, phase,
-- and the full immutable input hash all match.
CREATE TABLE "article_ai_weekly_batch_cache" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "domain" VARCHAR(10) NOT NULL,
  "policy_version" INTEGER NOT NULL,
  "model" VARCHAR(80) NOT NULL,
  "phase" VARCHAR(32) NOT NULL,
  "input_hash" VARCHAR(128) NOT NULL,
  "input_count" INTEGER NOT NULL DEFAULT 0,
  "output_json" JSONB NOT NULL,
  "output_hash" VARCHAR(128) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "article_ai_weekly_batch_cache_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "article_ai_weekly_batch_cache_domain_check"
    CHECK ("domain" IN ('esg', 'credit')),
  CONSTRAINT "article_ai_weekly_batch_cache_scope_key"
    UNIQUE ("domain", "policy_version", "model", "phase", "input_hash")
);

CREATE INDEX "idx_article_ai_weekly_batch_cache_lookup"
  ON "article_ai_weekly_batch_cache"("domain", "policy_version", "phase", "created_at" DESC);

COMMIT;
