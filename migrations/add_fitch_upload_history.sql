-- Drop existing table if it exists (with old schema)
DROP TABLE IF EXISTS fitch_upload_history;

-- Create fitch_upload_history table with new schema
CREATE TABLE fitch_upload_history (
  id SERIAL PRIMARY KEY,
  user_email VARCHAR(255) NOT NULL,
  original_filename VARCHAR(255) NOT NULL,
  updated_filename VARCHAR(255) NOT NULL,
  file_data BYTEA NOT NULL,
  companies_count INTEGER DEFAULT 0,
  success_count INTEGER DEFAULT 0,
  error_count INTEGER DEFAULT 0,
  file_size INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes
CREATE INDEX idx_fitch_upload_history_user_email ON fitch_upload_history(user_email);
CREATE INDEX idx_fitch_upload_history_created_at ON fitch_upload_history(created_at);
