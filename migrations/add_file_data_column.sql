-- Migration: Add file_data column to file_uploads table
-- This allows storing Excel files directly in the database instead of on disk

ALTER TABLE file_uploads 
ADD COLUMN file_data BYTEA;

COMMENT ON COLUMN file_uploads.file_data IS 'Binary data of the uploaded/processed Excel file';
