-- Private, opt-in article AI state. The tables are additive and do not alter
-- the scraper-owned article or normal likes tables.
CREATE TABLE "article_ai_preferences" (
  "id" SERIAL NOT NULL,
  "user_id" INTEGER NOT NULL,
  "domain" VARCHAR(10) NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT FALSE,
  "settings_version" INTEGER NOT NULL DEFAULT 1,
  "status" VARCHAR(32) NOT NULL DEFAULT 'off',
  "history_count" INTEGER NOT NULL DEFAULT 0,
  "profile_source" VARCHAR(16) NOT NULL DEFAULT 'insufficient',
  "last_run_at" TIMESTAMPTZ(6),
  "last_error" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "article_ai_preferences_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "article_ai_preferences_user_domain_key" UNIQUE ("user_id", "domain"),
  CONSTRAINT "article_ai_preferences_domain_check" CHECK ("domain" IN ('esg', 'credit')),
  CONSTRAINT "article_ai_preferences_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE INDEX "idx_article_ai_preferences_user_enabled"
  ON "article_ai_preferences"("user_id", "enabled");
CREATE INDEX "idx_article_ai_preferences_domain_status"
  ON "article_ai_preferences"("domain", "status");

CREATE TABLE "article_ai_profiles" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" INTEGER NOT NULL,
  "domain" VARCHAR(10) NOT NULL,
  "profile_version" INTEGER NOT NULL,
  "profile_source" VARCHAR(16) NOT NULL,
  "human_like_count" INTEGER NOT NULL,
  "profile_json" JSONB NOT NULL,
  "content_hash" VARCHAR(128) NOT NULL,
  "model" VARCHAR(80),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "article_ai_profiles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "article_ai_profiles_user_domain_version_key"
    UNIQUE ("user_id", "domain", "profile_version"),
  CONSTRAINT "article_ai_profiles_domain_check" CHECK ("domain" IN ('esg', 'credit')),
  CONSTRAINT "article_ai_profiles_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE INDEX "idx_article_ai_profiles_user_domain_created"
  ON "article_ai_profiles"("user_id", "domain", "created_at" DESC);

CREATE TABLE "article_ai_article_features" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "domain" VARCHAR(10) NOT NULL,
  "article_id" INTEGER NOT NULL,
  "content_hash" VARCHAR(128) NOT NULL,
  "normalized_text" TEXT NOT NULL,
  "feature_json" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "embedding_json" JSONB,
  "model" VARCHAR(80),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "article_ai_article_features_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "article_ai_features_domain_article_hash_key"
    UNIQUE ("domain", "article_id", "content_hash"),
  CONSTRAINT "article_ai_article_features_domain_check" CHECK ("domain" IN ('esg', 'credit'))
);
CREATE INDEX "idx_article_ai_features_domain_article_created"
  ON "article_ai_article_features"("domain", "article_id", "created_at" DESC);

CREATE TABLE "article_ai_runs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" INTEGER NOT NULL,
  "domain" VARCHAR(10) NOT NULL,
  "run_date" DATE NOT NULL,
  "settings_version" INTEGER NOT NULL,
  "status" VARCHAR(24) NOT NULL DEFAULT 'queued',
  "model" VARCHAR(80),
  "profile_source" VARCHAR(16),
  "input_tokens" INTEGER NOT NULL DEFAULT 0,
  "output_tokens" INTEGER NOT NULL DEFAULT 0,
  "request_count" INTEGER NOT NULL DEFAULT 0,
  "error" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "started_at" TIMESTAMPTZ(6),
  "completed_at" TIMESTAMPTZ(6),
  CONSTRAINT "article_ai_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "article_ai_runs_user_domain_date_key" UNIQUE ("user_id", "domain", "run_date"),
  CONSTRAINT "article_ai_runs_domain_check" CHECK ("domain" IN ('esg', 'credit')),
  CONSTRAINT "article_ai_runs_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE INDEX "idx_article_ai_runs_user_domain_created"
  ON "article_ai_runs"("user_id", "domain", "created_at" DESC);

CREATE TABLE "article_ai_budgets" (
  "user_id" INTEGER NOT NULL,
  "domain" VARCHAR(10) NOT NULL,
  "budget_date" DATE NOT NULL,
  "request_limit" INTEGER NOT NULL DEFAULT 2,
  "requests_reserved" INTEGER NOT NULL DEFAULT 0,
  "token_limit" INTEGER NOT NULL DEFAULT 12000,
  "tokens_reserved" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "article_ai_budgets_pkey" PRIMARY KEY ("user_id", "domain", "budget_date"),
  CONSTRAINT "article_ai_budgets_domain_check" CHECK ("domain" IN ('esg', 'credit')),
  CONSTRAINT "article_ai_budgets_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE INDEX "idx_article_ai_budgets_date" ON "article_ai_budgets"("budget_date");

CREATE TABLE "article_ai_selections" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" INTEGER NOT NULL,
  "domain" VARCHAR(10) NOT NULL,
  "article_id" INTEGER NOT NULL,
  "state" VARCHAR(16) NOT NULL DEFAULT 'selected',
  "reason" TEXT NOT NULL,
  "relevance_score" DOUBLE PRECISION,
  "decision_json" JSONB,
  "version" INTEGER NOT NULL DEFAULT 1,
  "selected_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "content_hash" VARCHAR(128) NOT NULL,
  "pending_confirmation" BOOLEAN NOT NULL DEFAULT FALSE,
  "profile_version" INTEGER,
  "model" VARCHAR(80),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "article_ai_selections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "article_ai_selections_user_domain_article_key"
    UNIQUE ("user_id", "domain", "article_id"),
  CONSTRAINT "article_ai_selections_domain_check" CHECK ("domain" IN ('esg', 'credit')),
  CONSTRAINT "article_ai_selections_state_check"
    CHECK ("state" IN ('selected', 'confirmed', 'dismissed')),
  CONSTRAINT "article_ai_selections_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE INDEX "idx_article_ai_selections_digest"
  ON "article_ai_selections"("user_id", "domain", "state", "expires_at");
CREATE INDEX "idx_article_ai_selections_article"
  ON "article_ai_selections"("domain", "article_id");

CREATE TABLE "article_ai_feedback" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" INTEGER NOT NULL,
  "domain" VARCHAR(10) NOT NULL,
  "article_id" INTEGER NOT NULL,
  "selection_id" UUID,
  "action" VARCHAR(16) NOT NULL,
  "expected_version" INTEGER NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
  "idempotency_key" VARCHAR(180) NOT NULL,
  "error" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "applied_at" TIMESTAMPTZ(6),
  CONSTRAINT "article_ai_feedback_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "article_ai_feedback_idempotency_key" UNIQUE ("idempotency_key"),
  CONSTRAINT "article_ai_feedback_version_action_key"
    UNIQUE ("user_id", "domain", "article_id", "expected_version", "action"),
  CONSTRAINT "article_ai_feedback_domain_check" CHECK ("domain" IN ('esg', 'credit')),
  CONSTRAINT "article_ai_feedback_action_check" CHECK ("action" IN ('confirm', 'dismiss')),
  CONSTRAINT "article_ai_feedback_status_check"
    CHECK ("status" IN ('pending', 'confirmed', 'dismissed', 'error')),
  CONSTRAINT "article_ai_feedback_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "article_ai_feedback_selection_id_fkey"
    FOREIGN KEY ("selection_id") REFERENCES "article_ai_selections"("id") ON DELETE SET NULL ON UPDATE NO ACTION
);
CREATE INDEX "idx_article_ai_feedback_status_created"
  ON "article_ai_feedback"("status", "created_at");
CREATE INDEX "idx_article_ai_feedback_user_article"
  ON "article_ai_feedback"("user_id", "domain", "article_id");
