BEGIN;

-- Shared domain-wide article AI assessments. The tables are additive: legacy
-- per-user profile/run/selection rows remain for pending Credit confirmations,
-- but v2 reads never use them as recommendation input.
ALTER TABLE "article_ai_runs"
  ADD COLUMN "policy_version" INTEGER;

CREATE TABLE "article_ai_domain_assessments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "domain" VARCHAR(10) NOT NULL,
  "assessment_date" DATE NOT NULL,
  "policy_version" INTEGER NOT NULL DEFAULT 2,
  "status" VARCHAR(24) NOT NULL DEFAULT 'queued',
  "profile_source" VARCHAR(16) NOT NULL DEFAULT 'insufficient',
  "history_count" INTEGER NOT NULL DEFAULT 0,
  "profile_json" JSONB,
  "content_hash" VARCHAR(128),
  "model" VARCHAR(80),
  "input_tokens" INTEGER NOT NULL DEFAULT 0,
  "output_tokens" INTEGER NOT NULL DEFAULT 0,
  "request_count" INTEGER NOT NULL DEFAULT 0,
  "request_limit" INTEGER NOT NULL DEFAULT 1,
  "requests_reserved" INTEGER NOT NULL DEFAULT 0,
  "token_limit" INTEGER NOT NULL DEFAULT 12000,
  "tokens_reserved" INTEGER NOT NULL DEFAULT 0,
  "lease_owner" VARCHAR(180),
  "lease_token" UUID,
  "lease_expires_at" TIMESTAMPTZ(6),
  "error" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "started_at" TIMESTAMPTZ(6),
  "completed_at" TIMESTAMPTZ(6),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "article_ai_domain_assessments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "article_ai_domain_assessments_domain_date_policy_key"
    UNIQUE ("domain", "assessment_date", "policy_version"),
  CONSTRAINT "article_ai_domain_assessments_domain_check"
    CHECK ("domain" IN ('esg', 'credit')),
  CONSTRAINT "article_ai_domain_assessments_status_check"
    CHECK ("status" IN ('queued', 'running', 'ready', 'insufficient', 'budget_exhausted', 'error')),
  CONSTRAINT "article_ai_domain_assessments_profile_source_check"
    CHECK ("profile_source" IN ('domain', 'insufficient'))
);
CREATE INDEX "idx_article_ai_domain_assessments_domain_status_date"
  ON "article_ai_domain_assessments"("domain", "status", "assessment_date" DESC);
CREATE INDEX "idx_article_ai_domain_assessments_lease"
  ON "article_ai_domain_assessments"("status", "lease_expires_at");

CREATE TABLE "article_ai_domain_selections" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "assessment_id" UUID NOT NULL,
  "domain" VARCHAR(10) NOT NULL,
  "article_id" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "relevance_score" DOUBLE PRECISION,
  "selected_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "content_hash" VARCHAR(128) NOT NULL,
  "model" VARCHAR(80),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "article_ai_domain_selections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "article_ai_domain_selections_assessment_article_key"
    UNIQUE ("assessment_id", "article_id"),
  CONSTRAINT "article_ai_domain_selections_domain_check"
    CHECK ("domain" IN ('esg', 'credit')),
  CONSTRAINT "article_ai_domain_selections_assessment_id_fkey"
    FOREIGN KEY ("assessment_id") REFERENCES "article_ai_domain_assessments"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE INDEX "idx_article_ai_domain_selections_article"
  ON "article_ai_domain_selections"("domain", "article_id");
CREATE INDEX "idx_article_ai_domain_selections_expiry"
  ON "article_ai_domain_selections"("assessment_id", "expires_at");

CREATE TABLE "article_ai_user_selections" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" INTEGER NOT NULL,
  "domain_selection_id" UUID NOT NULL,
  "domain" VARCHAR(10) NOT NULL,
  "article_id" INTEGER NOT NULL,
  "state" VARCHAR(16) NOT NULL DEFAULT 'dismissed',
  "version" INTEGER NOT NULL DEFAULT 1,
  "pending_confirmation" BOOLEAN NOT NULL DEFAULT FALSE,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "article_ai_user_selections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "article_ai_user_selections_user_domain_article_key"
    UNIQUE ("user_id", "domain", "article_id"),
  CONSTRAINT "article_ai_user_selections_state_check"
    CHECK ("state" IN ('dismissed', 'confirmed')),
  CONSTRAINT "article_ai_user_selections_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "article_ai_user_selections_domain_selection_id_fkey"
    FOREIGN KEY ("domain_selection_id") REFERENCES "article_ai_domain_selections"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE INDEX "idx_article_ai_user_selections_user_state"
  ON "article_ai_user_selections"("user_id", "state");

CREATE TABLE "article_ai_domain_feedback" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" INTEGER NOT NULL,
  "domain" VARCHAR(10) NOT NULL,
  "article_id" INTEGER NOT NULL,
  "domain_selection_id" UUID NOT NULL,
  "user_selection_id" UUID NOT NULL,
  "action" VARCHAR(16) NOT NULL,
  "expected_version" INTEGER NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
  "idempotency_key" VARCHAR(220) NOT NULL,
  "error" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "applied_at" TIMESTAMPTZ(6),
  CONSTRAINT "article_ai_domain_feedback_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "article_ai_domain_feedback_idempotency_key"
    UNIQUE ("idempotency_key"),
  CONSTRAINT "article_ai_domain_feedback_user_selection_action_key"
    UNIQUE ("user_id", "domain_selection_id", "action"),
  CONSTRAINT "article_ai_domain_feedback_domain_check"
    CHECK ("domain" IN ('esg', 'credit')),
  CONSTRAINT "article_ai_domain_feedback_action_check"
    CHECK ("action" IN ('confirm', 'dismiss')),
  CONSTRAINT "article_ai_domain_feedback_status_check"
    CHECK ("status" IN ('pending', 'confirmed', 'dismissed', 'error')),
  CONSTRAINT "article_ai_domain_feedback_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "article_ai_domain_feedback_domain_selection_id_fkey"
    FOREIGN KEY ("domain_selection_id") REFERENCES "article_ai_domain_selections"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "article_ai_domain_feedback_user_selection_id_fkey"
    FOREIGN KEY ("user_selection_id") REFERENCES "article_ai_user_selections"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE INDEX "idx_article_ai_domain_feedback_status_created"
  ON "article_ai_domain_feedback"("status", "created_at");
CREATE INDEX "idx_article_ai_domain_feedback_user_article"
  ON "article_ai_domain_feedback"("user_id", "domain", "article_id");

COMMIT;
