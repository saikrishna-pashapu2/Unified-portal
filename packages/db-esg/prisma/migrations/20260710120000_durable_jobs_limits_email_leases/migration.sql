CREATE TABLE "background_jobs" (
    "id" UUID NOT NULL,
    "job_type" VARCHAR(40) NOT NULL,
    "user_id" INTEGER NOT NULL,
    "payload_json" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "input_data" BYTEA,
    "output_data" BYTEA,
    "result_json" JSONB,
    "status" VARCHAR(20) NOT NULL DEFAULT 'queued',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "progress_json" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "available_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "lease_owner" VARCHAR(160),
    "lease_expires_at" TIMESTAMPTZ,
    "heartbeat_at" TIMESTAMPTZ,
    "cancel_requested" BOOLEAN NOT NULL DEFAULT FALSE,
    "idempotency_key" VARCHAR(180) NOT NULL,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "completed_at" TIMESTAMPTZ,
    CONSTRAINT "background_jobs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "background_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX "background_jobs_idempotency_key_key" ON "background_jobs"("idempotency_key");
CREATE INDEX "idx_background_jobs_claim" ON "background_jobs"("status", "available_at", "lease_expires_at", "created_at");
CREATE INDEX "idx_background_jobs_user_status" ON "background_jobs"("user_id", "status", "created_at" DESC);
CREATE INDEX "idx_background_jobs_type_status" ON "background_jobs"("job_type", "status");

CREATE OR REPLACE FUNCTION enforce_background_job_concurrency()
RETURNS trigger AS $$
DECLARE
    active_count INTEGER;
    active_limit INTEGER;
BEGIN
    active_limit := CASE WHEN NEW.job_type = 'esg_driver' THEN 1 ELSE 2 END;
    PERFORM pg_advisory_xact_lock(NEW.user_id, hashtext(NEW.job_type));
    SELECT COUNT(*)::int INTO active_count
    FROM background_jobs
    WHERE user_id = NEW.user_id
      AND job_type = NEW.job_type
      AND status IN ('queued', 'processing');
    IF active_count >= active_limit THEN
        RAISE EXCEPTION 'background_job_concurrency_limit'
          USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER background_jobs_concurrency_limit
BEFORE INSERT ON "background_jobs"
FOR EACH ROW EXECUTE FUNCTION enforce_background_job_concurrency();

CREATE TABLE "api_usage_buckets" (
    "scope_key" VARCHAR(220) NOT NULL,
    "feature" VARCHAR(80) NOT NULL,
    "window_kind" VARCHAR(10) NOT NULL,
    "window_start" TIMESTAMPTZ NOT NULL,
    "request_count" INTEGER NOT NULL DEFAULT 0,
    "cost_units" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT "api_usage_buckets_pkey" PRIMARY KEY ("scope_key", "feature", "window_kind", "window_start")
);

CREATE INDEX "idx_api_usage_buckets_cleanup" ON "api_usage_buckets"("window_start");

-- Older installations created this table at runtime. Define it in migrations so
-- fresh databases and upgraded databases have the same durable schema.
CREATE TABLE IF NOT EXISTS "esg_driver_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" INTEGER,
    "country" VARCHAR(120) NOT NULL,
    "sector" VARCHAR(160) NOT NULL,
    "language" VARCHAR(80) NOT NULL DEFAULT 'English',
    "status" VARCHAR(20) NOT NULL DEFAULT 'queued',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "stage" VARCHAR(120) NOT NULL DEFAULT 'queued',
    "error_message" TEXT,
    "result_json" JSONB,
    "evidence_json" JSONB,
    "activity_json" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(6),
    CONSTRAINT "esg_driver_jobs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "esg_driver_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "idx_esg_driver_jobs_status" ON "esg_driver_jobs"("status");
CREATE INDEX IF NOT EXISTS "idx_esg_driver_jobs_user_created" ON "esg_driver_jobs"("user_id", "created_at" DESC);

ALTER TABLE "file_uploads"
    ADD COLUMN "progress" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "rows_total" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "rows_done" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "esg_driver_jobs"
    ADD COLUMN IF NOT EXISTS "activity_json" JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "email_queue"
    ADD COLUMN "alert_history_id" INTEGER,
    ADD COLUMN "lease_expires_at" TIMESTAMP(6),
    ADD COLUMN "heartbeat_at" TIMESTAMP(6),
    ADD COLUMN "provider_message_id" VARCHAR(255),
    ADD COLUMN "idempotency_key" UUID NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE "email_queue"
    ADD CONSTRAINT "email_queue_alert_history_id_fkey"
    FOREIGN KEY ("alert_history_id") REFERENCES "alert_history"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

CREATE UNIQUE INDEX "email_queue_alert_history_id_key" ON "email_queue"("alert_history_id") WHERE "alert_history_id" IS NOT NULL;
CREATE UNIQUE INDEX "email_queue_idempotency_key_key" ON "email_queue"("idempotency_key");
CREATE INDEX "idx_email_queue_claim" ON "email_queue"("status", "scheduled_for", "lease_expires_at", "priority" DESC);
