CREATE TABLE "esg_driver_catalog_versions" (
  "id" UUID NOT NULL,
  "version" VARCHAR(120) NOT NULL,
  "workbook" VARCHAR(255) NOT NULL,
  "sha256" CHAR(64) NOT NULL,
  "display_name" VARCHAR(255) NOT NULL,
  "catalog_json" JSONB NOT NULL,
  "file_data" BYTEA,
  "warnings_json" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "driver_count" INTEGER NOT NULL,
  "sheet_count" INTEGER NOT NULL,
  "source_count" INTEGER NOT NULL,
  "is_bundled" BOOLEAN NOT NULL DEFAULT FALSE,
  "uploaded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "uploaded_by_user_id" INTEGER,
  CONSTRAINT "esg_driver_catalog_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "uq_esg_driver_catalog_versions_sha256" UNIQUE ("sha256"),
  CONSTRAINT "esg_driver_catalog_versions_uploaded_by_fkey"
    FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION
);

CREATE INDEX "idx_esg_driver_catalog_versions_uploaded_at"
  ON "esg_driver_catalog_versions"("uploaded_at" DESC, "id" DESC);
CREATE INDEX "idx_esg_driver_catalog_versions_uploaded_by"
  ON "esg_driver_catalog_versions"("uploaded_by_user_id");

CREATE TABLE "esg_driver_catalog_state" (
  "id" INTEGER NOT NULL,
  "active_version_id" UUID NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "esg_driver_catalog_state_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "uq_esg_driver_catalog_state_active_version" UNIQUE ("active_version_id"),
  CONSTRAINT "esg_driver_catalog_state_active_version_fkey"
    FOREIGN KEY ("active_version_id") REFERENCES "esg_driver_catalog_versions"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION
);

CREATE TABLE "esg_driver_catalog_activations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "version_id" UUID NOT NULL,
  "activated_by_user_id" INTEGER,
  "revision" INTEGER NOT NULL,
  "activated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "esg_driver_catalog_activations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "esg_driver_catalog_activations_version_fkey"
    FOREIGN KEY ("version_id") REFERENCES "esg_driver_catalog_versions"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "esg_driver_catalog_activations_user_fkey"
    FOREIGN KEY ("activated_by_user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION
);

CREATE INDEX "idx_esg_driver_catalog_activations_at"
  ON "esg_driver_catalog_activations"("activated_at" DESC, "id" DESC);
CREATE INDEX "idx_esg_driver_catalog_activations_version"
  ON "esg_driver_catalog_activations"("version_id");
CREATE INDEX "idx_esg_driver_catalog_activations_user"
  ON "esg_driver_catalog_activations"("activated_by_user_id");
