-- SQL Script to create weekly_digest table
-- Run this script in both ESG and Credit databases

CREATE TABLE IF NOT EXISTS weekly_digest (
    id SERIAL PRIMARY KEY,
    week_start DATE NOT NULL,
    week_end DATE NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index on created_at for faster lookups of latest digest
CREATE INDEX IF NOT EXISTS idx_weekly_digest_created_at ON weekly_digest(created_at DESC);

-- Create index on week_start for filtering by date range
CREATE INDEX IF NOT EXISTS idx_weekly_digest_week_start ON weekly_digest(week_start);

-- Optional: Add comment to table
COMMENT ON TABLE weekly_digest IS 'Stores AI-generated weekly digest reports of most-liked articles by domain';
