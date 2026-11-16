-- Reconcile Prisma's full-unique relation model with the existing nullable
-- relation index. PostgreSQL permits multiple NULLs in a full unique index,
-- so this preserves the previous non-null uniqueness and all existing rows.
BEGIN;

DROP INDEX IF EXISTS "email_queue_alert_history_id_key";
CREATE UNIQUE INDEX "email_queue_alert_history_id_key"
  ON "email_queue"("alert_history_id");

COMMIT;
