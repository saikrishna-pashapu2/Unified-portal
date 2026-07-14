ALTER TABLE esg_driver_jobs
  ADD COLUMN checkpoint_json JSONB,
  ADD COLUMN catalog_version VARCHAR(120),
  ADD COLUMN parent_job_id UUID;

ALTER TABLE esg_driver_jobs
  ADD CONSTRAINT esg_driver_jobs_parent_job_id_fkey
  FOREIGN KEY (parent_job_id)
  REFERENCES esg_driver_jobs(id)
  ON DELETE RESTRICT
  ON UPDATE NO ACTION;

CREATE INDEX idx_esg_driver_jobs_parent
  ON esg_driver_jobs(parent_job_id);
