-- Additive schema for the tender-monitor pipeline inside the Portal ESG DB.
-- Run against the ESG RDS database before deploying the scheduler:
--   psql "$ESG_DATABASE_URL" -f packages/db-esg/prisma/monitored-tenders-schema.sql

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS monitored_tender_sources (
  name varchar(64) PRIMARY KEY,
  display_name varchar(128) NOT NULL,
  country varchar(2) NOT NULL,
  base_url varchar(512) NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  schedule_minutes integer NOT NULL DEFAULT 60,
  last_run_at timestamptz,
  last_success_at timestamptz,
  consecutive_failures integer NOT NULL DEFAULT 0,
  last_error text,
  total_tenders_seen integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS monitored_tenders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_name varchar(64) NOT NULL REFERENCES monitored_tender_sources(name) ON UPDATE CASCADE ON DELETE RESTRICT,
  external_id varchar(256) NOT NULL,
  canonical_id uuid REFERENCES monitored_tenders(id) ON DELETE SET NULL,
  title text NOT NULL,
  title_en text,
  title_language varchar(16),
  translation_provider varchar(64),
  title_translated_at timestamptz,
  buyer_name text,
  buyer_external_id varchar(64),
  country varchar(2) NOT NULL,
  sector varchar(128),
  value_amount numeric(18, 2),
  value_currency varchar(3),
  published_at timestamptz,
  deadline_at timestamptz,
  status varchar(32) NOT NULL DEFAULT 'unknown',
  source_url varchar(1024) NOT NULL,
  language varchar(16) NOT NULL DEFAULT 'other',
  matched_groups text[] NOT NULL DEFAULT '{}',
  match_details jsonb,
  ai_relevance_score integer,
  ai_summary text,
  ai_processed_at timestamptz,
  raw_json jsonb NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_changed_at timestamptz NOT NULL DEFAULT now(),
  change_log jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  CONSTRAINT uq_monitored_tenders_source_external UNIQUE (source_name, external_id)
);

CREATE TABLE IF NOT EXISTS monitored_team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name varchar(256) NOT NULL,
  member_key varchar(256) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  use_count integer NOT NULL DEFAULT 1,
  CONSTRAINT uq_monitored_team_members_member_key UNIQUE (member_key)
);

CREATE TABLE IF NOT EXISTS monitored_share_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_name varchar(256) NOT NULL,
  sender_key varchar(256) NOT NULL,
  email varchar(256) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  use_count integer NOT NULL DEFAULT 1,
  CONSTRAINT uq_monitored_share_contacts_sender_email UNIQUE (sender_key, email)
);

CREATE TABLE IF NOT EXISTS monitored_tender_likes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tender_id uuid NOT NULL REFERENCES monitored_tenders(id) ON DELETE CASCADE,
  team_member_id uuid NOT NULL REFERENCES monitored_team_members(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_monitored_tender_likes_tender_member UNIQUE (tender_id, team_member_id)
);

CREATE TABLE IF NOT EXISTS monitored_email_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email varchar(256) NOT NULL UNIQUE,
  name varchar(256),
  team varchar(128),
  groups text[] NOT NULL DEFAULT '{}',
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS monitored_notification_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tender_id uuid NOT NULL REFERENCES monitored_tenders(id) ON DELETE CASCADE,
  channel varchar(32) NOT NULL,
  recipient varchar(512) NOT NULL,
  status varchar(32) NOT NULL,
  external_message_id varchar(128),
  error text,
  sent_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS monitored_tender_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tender_id uuid NOT NULL REFERENCES monitored_tenders(id) ON DELETE CASCADE,
  verdict varchar(32) NOT NULL,
  note text,
  created_by varchar(256),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_monitored_sources_enabled ON monitored_tender_sources(enabled);
CREATE INDEX IF NOT EXISTS idx_monitored_sources_country ON monitored_tender_sources(country);

CREATE INDEX IF NOT EXISTS idx_monitored_tenders_source_name ON monitored_tenders(source_name);
CREATE INDEX IF NOT EXISTS idx_monitored_tenders_canonical_id ON monitored_tenders(canonical_id);
CREATE INDEX IF NOT EXISTS idx_monitored_tenders_country ON monitored_tenders(country);
CREATE INDEX IF NOT EXISTS idx_monitored_tenders_published_at ON monitored_tenders(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_monitored_tenders_deadline_at ON monitored_tenders(deadline_at);
CREATE INDEX IF NOT EXISTS idx_monitored_tenders_first_seen_at ON monitored_tenders(first_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_monitored_tenders_is_active ON monitored_tenders(is_active);
CREATE INDEX IF NOT EXISTS idx_monitored_tenders_matched_groups ON monitored_tenders USING gin(matched_groups);
CREATE INDEX IF NOT EXISTS idx_monitored_tenders_match_details ON monitored_tenders USING gin(match_details);
CREATE INDEX IF NOT EXISTS idx_monitored_tenders_raw_json ON monitored_tenders USING gin(raw_json);

CREATE INDEX IF NOT EXISTS idx_monitored_team_members_member_key ON monitored_team_members(member_key);
CREATE INDEX IF NOT EXISTS idx_monitored_team_members_last_used_at ON monitored_team_members(last_used_at);

CREATE INDEX IF NOT EXISTS idx_monitored_share_contacts_sender_key ON monitored_share_contacts(sender_key);

CREATE INDEX IF NOT EXISTS idx_monitored_tender_likes_tender_id ON monitored_tender_likes(tender_id);
CREATE INDEX IF NOT EXISTS idx_monitored_tender_likes_team_member_id ON monitored_tender_likes(team_member_id);
CREATE INDEX IF NOT EXISTS idx_monitored_tender_likes_created_at ON monitored_tender_likes(created_at);

CREATE INDEX IF NOT EXISTS idx_monitored_email_recipients_enabled ON monitored_email_recipients(enabled);
CREATE INDEX IF NOT EXISTS idx_monitored_email_recipients_team ON monitored_email_recipients(team);

CREATE INDEX IF NOT EXISTS idx_monitored_notification_logs_tender_id ON monitored_notification_logs(tender_id);
CREATE INDEX IF NOT EXISTS idx_monitored_notification_logs_sent_at ON monitored_notification_logs(sent_at);
CREATE INDEX IF NOT EXISTS idx_monitored_notification_logs_recipient ON monitored_notification_logs(recipient);

CREATE INDEX IF NOT EXISTS idx_monitored_tender_feedback_tender_id ON monitored_tender_feedback(tender_id);
