CREATE TABLE "pdf_translation_v2_usage_events" (
    "id" BIGSERIAL NOT NULL,
    "job_id" UUID NOT NULL,
    "page_number" INTEGER,
    "operation" VARCHAR(40) NOT NULL,
    "response_id" TEXT NOT NULL,
    "model" VARCHAR(80) NOT NULL,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT "pdf_translation_v2_usage_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "pdf_translation_v2_usage_events_job_id_fkey"
      FOREIGN KEY ("job_id") REFERENCES "pdf_translation_v2_jobs"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX "pdf_translation_v2_usage_event_key"
  ON "pdf_translation_v2_usage_events"("job_id", "operation", "response_id");
CREATE INDEX "idx_pdf_translation_v2_usage_created"
  ON "pdf_translation_v2_usage_events"("created_at");
CREATE INDEX "idx_pdf_translation_v2_usage_job_page"
  ON "pdf_translation_v2_usage_events"("job_id", "page_number");
