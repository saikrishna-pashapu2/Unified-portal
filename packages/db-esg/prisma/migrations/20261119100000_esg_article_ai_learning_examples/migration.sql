-- Preserve approved ESG learning examples without retaining deleted-user identity.
-- The article ID is intentionally not a foreign key so the evidence remains
-- auditable if a scraper later removes an article row. The AI loader resolves
-- the ID through esg_articles and counts missing rows as explicit exclusions.
CREATE TABLE "article_ai_esg_learning_examples" (
  "article_id" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "article_ai_esg_learning_examples_pkey" PRIMARY KEY ("article_id")
);
