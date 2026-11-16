ALTER TABLE "fitch_upload_history" ADD COLUMN "job_id" UUID;
CREATE UNIQUE INDEX "fitch_upload_history_job_id_key" ON "fitch_upload_history"("job_id") WHERE "job_id" IS NOT NULL;
