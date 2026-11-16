-- Credit's production article alerts use the same application-owned likes
-- contract as ESG. Keep this table independent of Credit's legacy user model:
-- identity and active-account checks are mastered by the ESG database.
CREATE TABLE IF NOT EXISTS "likes" (
  "id" SERIAL NOT NULL,
  "user_id" INTEGER NOT NULL,
  "content_type" VARCHAR(20) NOT NULL,
  "content_id" INTEGER NOT NULL,
  "created_at" TIMESTAMP(6),
  CONSTRAINT "likes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "unique_like" UNIQUE ("user_id", "content_type", "content_id")
);

CREATE INDEX IF NOT EXISTS "ix_likes_content_type" ON "likes"("content_type");
CREATE INDEX IF NOT EXISTS "ix_likes_user_id" ON "likes"("user_id");
