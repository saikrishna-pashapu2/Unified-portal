-- Reconcile Prisma's full-unique nullable field model with the existing
-- partial index. PostgreSQL permits multiple NULLs in a full unique index,
-- so this preserves the previous non-null uniqueness and all existing rows.
BEGIN;

DROP INDEX IF EXISTS "fitch_upload_history_job_id_key";
CREATE UNIQUE INDEX "fitch_upload_history_job_id_key"
  ON "fitch_upload_history"("job_id");

COMMIT;
