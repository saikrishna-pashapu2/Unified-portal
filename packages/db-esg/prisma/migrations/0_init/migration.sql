-- CreateTable
CREATE TABLE "alembic_version" (
    "version_num" VARCHAR(32) NOT NULL,

    CONSTRAINT "alembic_version_pkc" PRIMARY KEY ("version_num")
);

-- CreateTable
CREATE TABLE "esg_articles" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "published" TIMESTAMPTZ(6),
    "summary" TEXT,
    "link" TEXT NOT NULL,
    "source" TEXT,
    "matched_keywords" TEXT,
    "save_time" TIMESTAMPTZ(6),

    CONSTRAINT "esg_articles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" SERIAL NOT NULL,
    "event_name" TEXT,
    "event_id" TEXT,
    "event_url" TEXT,
    "start_date" DATE,
    "end_date" DATE,
    "start_time" TIME(6),
    "end_time" TIME(6),
    "timezone" TEXT,
    "image_url" TEXT,
    "ticket_price" TEXT,
    "tickets_url" TEXT,
    "venue_name" TEXT,
    "venue_address" TEXT,
    "organizer_name" TEXT,
    "organizer_url" TEXT,
    "summary" TEXT,
    "tags" TEXT,
    "source" TEXT,
    "month" TEXT,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_uploads" (
    "id" SERIAL NOT NULL,
    "task_id" VARCHAR(36) NOT NULL,
    "original_filename" VARCHAR(256) NOT NULL,
    "stored_filename" VARCHAR(256) NOT NULL,
    "output_filename" VARCHAR(256),
    "file_data" BYTEA,
    "status" VARCHAR(20),
    "error_message" TEXT,
    "user_id" INTEGER,
    "created_at" TIMESTAMP(6),
    "updated_at" TIMESTAMP(6),

    CONSTRAINT "file_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "likes" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "content_type" VARCHAR(20) NOT NULL,
    "content_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(6),

    CONSTRAINT "likes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pdf_translation_jobs" (
    "id" UUID NOT NULL,
    "user_id" INTEGER NOT NULL,
    "filename" TEXT NOT NULL,
    "stored_filename" TEXT NOT NULL,
    "input_path" TEXT NOT NULL,
    "target_lang" TEXT NOT NULL DEFAULT 'English',
    "status" TEXT NOT NULL DEFAULT 'processing',
    "message" TEXT,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "total_pages" INTEGER NOT NULL DEFAULT 0,
    "current_page" INTEGER NOT NULL DEFAULT 0,
    "pages" JSONB NOT NULL DEFAULT '[]',
    "translated_pages" JSONB NOT NULL DEFAULT '[]',
    "output_path" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "output_pdf" BYTEA,

    CONSTRAINT "pdf_translation_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pdf_translations" (
    "id" SERIAL NOT NULL,
    "job_id" VARCHAR(64) NOT NULL,
    "user_id" INTEGER NOT NULL,
    "original_filename" VARCHAR(255) NOT NULL,
    "file_path" VARCHAR(500) NOT NULL,
    "file_size" INTEGER,
    "source_language" VARCHAR(10),
    "target_language" VARCHAR(10) NOT NULL,
    "total_pages" INTEGER NOT NULL,
    "total_words" INTEGER,
    "status" VARCHAR(20),
    "created_at" TIMESTAMP(6),
    "started_at" TIMESTAMP(6),
    "completed_at" TIMESTAMP(6),
    "processing_time" DOUBLE PRECISION,
    "success_pages" INTEGER,
    "failed_pages" INTEGER,
    "error_message" TEXT,
    "ocr_method" VARCHAR(50),

    CONSTRAINT "pdf_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publications" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "published" TIMESTAMPTZ(6),
    "summary" TEXT,
    "link" TEXT NOT NULL,
    "source" TEXT,
    "image_url" TEXT,
    "save_time" TIMESTAMPTZ(6),

    CONSTRAINT "publications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "translation_history" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "total_translations" INTEGER,
    "total_pages_processed" INTEGER,
    "total_words_translated" INTEGER,
    "total_processing_time" DOUBLE PRECISION,
    "most_used_source_lang" VARCHAR(10),
    "most_used_target_lang" VARCHAR(10),
    "first_translation" TIMESTAMP(6),
    "last_translation" TIMESTAMP(6),
    "last_updated" TIMESTAMP(6),

    CONSTRAINT "translation_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "translation_pages" (
    "id" SERIAL NOT NULL,
    "translation_id" INTEGER NOT NULL,
    "page_number" INTEGER NOT NULL,
    "original_text" TEXT,
    "translated_text" TEXT,
    "original_word_count" INTEGER,
    "translated_word_count" INTEGER,
    "extraction_method" VARCHAR(50),
    "processing_time" DOUBLE PRECISION,
    "status" VARCHAR(20),
    "error_message" TEXT,
    "created_at" TIMESTAMP(6),

    CONSTRAINT "translation_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_preferences" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER,
    "preferred_sources" TEXT[],
    "preferred_topics" TEXT[],

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "username" VARCHAR(255) NOT NULL,
    "email" VARCHAR(255),
    "password" VARCHAR(255),
    "password_hash" VARCHAR(255) NOT NULL,
    "first_name" VARCHAR(64),
    "last_name" VARCHAR(64),
    "is_admin" BOOLEAN DEFAULT false,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "last_login" TIMESTAMP(6),
    "preferred_categories" VARCHAR(256),
    "email_notifications" BOOLEAN DEFAULT true,
    "is_active_db" BOOLEAN NOT NULL DEFAULT true,
    "team" VARCHAR(100),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_preferences" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "domain" VARCHAR(10) NOT NULL,
    "weekly_digest" BOOLEAN DEFAULT true,
    "daily_digest" BOOLEAN DEFAULT false,
    "immediate_alerts" BOOLEAN DEFAULT false,
    "alert_articles" BOOLEAN DEFAULT true,
    "alert_events" BOOLEAN DEFAULT true,
    "alert_publications" BOOLEAN DEFAULT true,
    "sources" TEXT[],
    "keywords" TEXT[],
    "team_likes_only" BOOLEAN DEFAULT true,
    "email_enabled" BOOLEAN DEFAULT true,
    "email_address" VARCHAR(255),
    "digest_day" VARCHAR(10) DEFAULT 'Monday',
    "digest_hour" INTEGER DEFAULT 9,
    "timezone" VARCHAR(50) DEFAULT 'Asia/Dubai',
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "alert_name" VARCHAR(255) DEFAULT 'My Alert',
    "alert_type" VARCHAR(50) DEFAULT 'weekly_digest',
    "is_active" BOOLEAN DEFAULT true,
    "immediate_sources" VARCHAR(50)[] DEFAULT ARRAY[]::VARCHAR(50)[],
    "immediate_keywords" VARCHAR(100)[] DEFAULT ARRAY[]::VARCHAR(100)[],
    "immediate_content_types" VARCHAR(50)[] DEFAULT ARRAY['articles']::VARCHAR(50)[],
    "last_sent_at" TIMESTAMP(6),
    "next_send_at" TIMESTAMP(6),
    "domains" VARCHAR(20)[] DEFAULT ARRAY[]::VARCHAR(20)[],

    CONSTRAINT "alert_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_history" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "domain" VARCHAR(10) NOT NULL,
    "alert_type" VARCHAR(20) NOT NULL,
    "content_type" VARCHAR(20),
    "content_ids" INTEGER[],
    "email_to" VARCHAR(255) NOT NULL,
    "email_subject" TEXT,
    "email_status" VARCHAR(20) DEFAULT 'pending',
    "total_items" INTEGER DEFAULT 0,
    "opened_at" TIMESTAMP(6),
    "clicked_at" TIMESTAMP(6),
    "error_message" TEXT,
    "retry_count" INTEGER DEFAULT 0,
    "sent_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "template_version" VARCHAR(10),
    "job_id" VARCHAR(100),

    CONSTRAINT "alert_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_queue" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "email_to" VARCHAR(255) NOT NULL,
    "email_subject" TEXT NOT NULL,
    "email_body" TEXT NOT NULL,
    "email_html" TEXT,
    "priority" INTEGER DEFAULT 5,
    "scheduled_for" TIMESTAMP(6) NOT NULL,
    "status" VARCHAR(20) DEFAULT 'queued',
    "attempts" INTEGER DEFAULT 0,
    "max_attempts" INTEGER DEFAULT 3,
    "last_error" TEXT,
    "last_attempt_at" TIMESTAMP(6),
    "sent_at" TIMESTAMP(6),
    "processed_by" VARCHAR(100),
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "alert_type" VARCHAR(20),
    "domain" VARCHAR(10),
    "metadata" JSONB,

    CONSTRAINT "email_queue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_content_sent" (
    "id" SERIAL NOT NULL,
    "alert_preference_id" INTEGER NOT NULL,
    "domain" VARCHAR(20) NOT NULL,
    "content_type" VARCHAR(20) NOT NULL,
    "content_id" INTEGER NOT NULL,
    "content_save_time" TIMESTAMP(6),
    "sent_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alert_content_sent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "meeting_id" UUID,
    "title" TEXT NOT NULL,
    "assignee_user_id" INTEGER,
    "due_date" DATE,
    "priority" VARCHAR(10),
    "status" VARCHAR(20) DEFAULT 'todo',
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "action_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "article_ai_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" INTEGER NOT NULL,
    "article_id" INTEGER NOT NULL,
    "domain" VARCHAR(10) NOT NULL DEFAULT 'credit',
    "session_data" JSONB NOT NULL DEFAULT '{"summary": null, "messages": [], "suggestedQuestions": []}',
    "message_count" INTEGER NOT NULL DEFAULT 0,
    "tokens_used" INTEGER NOT NULL DEFAULT 0,
    "cost_usd" DECIMAL(10,4) DEFAULT 0,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "article_ai_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "article_conversations" (
    "id" SERIAL NOT NULL,
    "session_id" VARCHAR(255) NOT NULL,
    "user_id" INTEGER,
    "article_id" INTEGER NOT NULL,
    "article_source" VARCHAR(20) NOT NULL,
    "article_summary" TEXT,
    "summary_generated_at" TIMESTAMP(6),
    "summary_tokens" INTEGER DEFAULT 0,
    "conversation_title" VARCHAR(255),
    "total_messages" INTEGER DEFAULT 0,
    "total_tokens_used" INTEGER DEFAULT 0,
    "total_cost_usd" DECIMAL(10,6) DEFAULT 0,
    "status" VARCHAR(20) DEFAULT 'active',
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "last_message_at" TIMESTAMP(6),

    CONSTRAINT "article_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "article_messages" (
    "id" SERIAL NOT NULL,
    "conversation_id" INTEGER NOT NULL,
    "message_index" INTEGER NOT NULL,
    "role" VARCHAR(20) NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "tokens_used" INTEGER DEFAULT 0,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "article_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "article_tool_calls" (
    "id" SERIAL NOT NULL,
    "conversation_id" INTEGER NOT NULL,
    "message_id" INTEGER,
    "tool_name" VARCHAR(100) NOT NULL,
    "tool_input" JSONB NOT NULL,
    "tool_output" JSONB,
    "status" VARCHAR(20) NOT NULL,
    "error_message" TEXT,
    "tokens_used" INTEGER DEFAULT 0,
    "execution_time_ms" INTEGER,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "article_tool_calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "esg_driver_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" INTEGER,
    "country" VARCHAR(120) NOT NULL,
    "sector" VARCHAR(160) NOT NULL,
    "language" VARCHAR(80) NOT NULL DEFAULT 'English',
    "status" VARCHAR(20) NOT NULL DEFAULT 'queued',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "stage" VARCHAR(120) NOT NULL DEFAULT 'queued',
    "error_message" TEXT,
    "result_json" JSONB,
    "evidence_json" JSONB,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(6),

    CONSTRAINT "esg_driver_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decisions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "meeting_id" UUID,
    "decision_text" TEXT NOT NULL,
    "decided_by_user_id" INTEGER,
    "timestamp_in_meeting" DECIMAL(10,2),
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "domain_keywords" (
    "id" SERIAL NOT NULL,
    "domain" VARCHAR(20) NOT NULL,
    "keyword" TEXT NOT NULL,
    "category" VARCHAR(100),
    "weight" DECIMAL(3,2) DEFAULT 1.0,
    "language" VARCHAR(10) DEFAULT 'en',
    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "domain_keywords_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_drafts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "meeting_id" UUID,
    "subject" VARCHAR(255),
    "body" TEXT,
    "sent" BOOLEAN DEFAULT false,
    "sent_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_participants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "meeting_id" UUID,
    "user_id" INTEGER,
    "role" VARCHAR(50),
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meeting_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_summaries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "meeting_id" UUID,
    "summary_bullets" JSONB,
    "summary_paragraph" TEXT,
    "key_topics" JSONB,
    "highlights" JSONB,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meeting_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meetings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" VARCHAR(255),
    "date" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "duration_sec" INTEGER,
    "recorded_by_user_id" INTEGER,
    "status" VARCHAR(50) DEFAULT 'processing',
    "recording_url" TEXT,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meetings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "questions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "meeting_id" UUID,
    "question_text" TEXT NOT NULL,
    "asked_by_user_id" INTEGER,
    "resolved" BOOLEAN DEFAULT false,
    "resolved_at" TIMESTAMP(6),
    "resolved_by_user_id" INTEGER,
    "answer_text" TEXT,
    "timestamp_in_meeting" DECIMAL(10,2),
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "meeting_id" UUID,
    "risk_text" TEXT NOT NULL,
    "raised_by_user_id" INTEGER,
    "severity" VARCHAR(20),
    "timestamp_in_meeting" DECIMAL(10,2),
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "risks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "speaker_mappings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "meeting_id" UUID,
    "speaker_label" VARCHAR(10) NOT NULL,
    "user_id" INTEGER,
    "sample_text" TEXT,
    "confidence_score" DECIMAL(3,2),
    "is_ai_suggested" BOOLEAN DEFAULT false,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "speaker_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tender_classifications" (
    "id" SERIAL NOT NULL,
    "tender_id" INTEGER,
    "esg_score" DECIMAL(3,2),
    "credit_score" DECIMAL(3,2),
    "primary_domain" VARCHAR(20),
    "reasoning" TEXT,
    "esg_keywords" TEXT[],
    "credit_keywords" TEXT[],
    "model_used" VARCHAR(50) DEFAULT 'gpt-4o-mini',
    "prompt_tokens" INTEGER,
    "completion_tokens" INTEGER,
    "classification_cost" DECIMAL(10,6),
    "processing_time_ms" INTEGER,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tender_classifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tender_scrape_logs" (
    "id" SERIAL NOT NULL,
    "source_id" INTEGER,
    "started_at" TIMESTAMP(6) NOT NULL,
    "completed_at" TIMESTAMP(6),
    "status" VARCHAR(50),
    "tenders_found" INTEGER DEFAULT 0,
    "tenders_new" INTEGER DEFAULT 0,
    "tenders_updated" INTEGER DEFAULT 0,
    "tenders_failed" INTEGER DEFAULT 0,
    "error_message" TEXT,
    "error_stack" TEXT,
    "duration_seconds" INTEGER,
    "pages_scraped" INTEGER DEFAULT 0,
    "scraper_version" VARCHAR(50),
    "trigger_type" VARCHAR(50),

    CONSTRAINT "tender_scrape_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tender_sources" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "short_name" VARCHAR(50) NOT NULL,
    "country" VARCHAR(100),
    "base_url" VARCHAR(500) NOT NULL,
    "search_url_template" VARCHAR(1000),
    "is_active" BOOLEAN DEFAULT true,
    "scrape_frequency_hours" INTEGER DEFAULT 3,
    "requires_auth" BOOLEAN DEFAULT false,
    "default_headers" JSONB,
    "scraper_config" JSONB,
    "last_scrape_date" TIMESTAMP(6),
    "last_scrape_status" VARCHAR(50),
    "total_scrapes" INTEGER DEFAULT 0,
    "successful_scrapes" INTEGER DEFAULT 0,
    "failed_scrapes" INTEGER DEFAULT 0,
    "success_rate" DECIMAL(5,2),
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tender_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tender_translations" (
    "id" SERIAL NOT NULL,
    "tender_id" INTEGER,
    "source_language" VARCHAR(10) NOT NULL,
    "target_language" VARCHAR(10) NOT NULL,
    "total_characters" INTEGER,
    "translation_method" VARCHAR(50) DEFAULT 'openai',
    "translation_cost" DECIMAL(10,6),
    "translation_time_ms" INTEGER,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tender_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenders" (
    "id" SERIAL NOT NULL,
    "source_id" INTEGER,
    "lot_id" VARCHAR(50),
    "tender_number" VARCHAR(100),
    "tender_url" TEXT NOT NULL,
    "announcement_url" TEXT,
    "original_title" TEXT NOT NULL,
    "original_description" TEXT,
    "original_additional_info" TEXT,
    "original_delivery_terms" TEXT,
    "original_language" VARCHAR(10) DEFAULT 'ru',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "additional_info" TEXT,
    "delivery_terms" TEXT,
    "total_amount" DECIMAL(20,2),
    "currency" VARCHAR(10) DEFAULT 'KZT',
    "amount_by_year" JSONB,
    "advance_payment" DECIMAL(20,2),
    "advance_percentage" DECIMAL(5,2),
    "ktru_code" VARCHAR(50),
    "procurement_type" VARCHAR(100),
    "procurement_method" VARCHAR(100),
    "customer_name" TEXT,
    "customer_bin" VARCHAR(50),
    "customer_address" TEXT,
    "customer_contact" TEXT,
    "published_date" DATE,
    "application_start_date" DATE,
    "application_end_date" DATE,
    "contract_start_date" DATE,
    "contract_end_date" DATE,
    "original_status" VARCHAR(50),
    "status" VARCHAR(50),
    "is_active" BOOLEAN DEFAULT true,
    "domain_classification" JSONB,
    "primary_domain" VARCHAR(20),
    "classification_confidence" DECIMAL(3,2),
    "matched_keywords" JSONB,
    "ai_summary" TEXT,
    "classification_date" TIMESTAMP(6),
    "extra_data" JSONB,
    "delivery_locations" JSONB,
    "documents" JSONB,
    "search_vector" tsvector,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transcript_segments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "meeting_id" UUID,
    "start_time" DECIMAL(10,2) NOT NULL,
    "end_time" DECIMAL(10,2) NOT NULL,
    "speaker_label" VARCHAR(10),
    "speaker_user_id" INTEGER,
    "text" TEXT NOT NULL,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transcript_segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_saved_tenders" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "tender_id" INTEGER,
    "notes" TEXT,
    "tags" TEXT[],
    "status" VARCHAR(50),
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_saved_tenders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_tender_alerts" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "alert_name" VARCHAR(255),
    "keywords" TEXT[],
    "excluded_keywords" TEXT[],
    "min_amount" DECIMAL(20,2),
    "max_amount" DECIMAL(20,2),
    "countries" VARCHAR(100)[],
    "domains" VARCHAR(20)[],
    "is_active" BOOLEAN DEFAULT true,
    "frequency" VARCHAR(20) DEFAULT 'instant',
    "last_sent" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_tender_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weekly_digest" (
    "id" SERIAL NOT NULL,
    "week_start" DATE NOT NULL,
    "week_end" DATE NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "weekly_digest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_activity" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "action" VARCHAR(100) NOT NULL,
    "resource_type" VARCHAR(50),
    "resource_id" INTEGER,
    "details" TEXT,
    "ip_address" VARCHAR(45),
    "user_agent" TEXT,
    "timestamp" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monitored_tender_sources" (
    "name" VARCHAR(64) NOT NULL,
    "display_name" VARCHAR(128) NOT NULL,
    "country" VARCHAR(2) NOT NULL,
    "base_url" VARCHAR(512) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "schedule_minutes" INTEGER NOT NULL DEFAULT 60,
    "last_run_at" TIMESTAMPTZ(6),
    "last_success_at" TIMESTAMPTZ(6),
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "total_tenders_seen" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "monitored_tender_sources_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "monitored_tenders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source_name" VARCHAR(64) NOT NULL,
    "external_id" VARCHAR(256) NOT NULL,
    "canonical_id" UUID,
    "title" TEXT NOT NULL,
    "title_en" TEXT,
    "title_language" VARCHAR(16),
    "translation_provider" VARCHAR(64),
    "title_translated_at" TIMESTAMPTZ(6),
    "buyer_name" TEXT,
    "buyer_external_id" VARCHAR(64),
    "country" VARCHAR(2) NOT NULL,
    "sector" VARCHAR(128),
    "value_amount" DECIMAL(18,2),
    "value_currency" VARCHAR(3),
    "published_at" TIMESTAMPTZ(6),
    "deadline_at" TIMESTAMPTZ(6),
    "status" VARCHAR(32) NOT NULL DEFAULT 'unknown',
    "source_url" VARCHAR(1024) NOT NULL,
    "language" VARCHAR(16) NOT NULL DEFAULT 'other',
    "matched_groups" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "match_details" JSONB,
    "ai_relevance_score" INTEGER,
    "ai_summary" TEXT,
    "ai_processed_at" TIMESTAMPTZ(6),
    "raw_json" JSONB NOT NULL,
    "first_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "change_log" JSONB NOT NULL DEFAULT '[]',
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "monitored_tenders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monitored_team_members" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "display_name" VARCHAR(256) NOT NULL,
    "member_key" VARCHAR(256) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "use_count" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "monitored_team_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monitored_share_contacts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sender_name" VARCHAR(256) NOT NULL,
    "sender_key" VARCHAR(256) NOT NULL,
    "email" VARCHAR(256) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "use_count" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "monitored_share_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monitored_tender_likes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tender_id" UUID NOT NULL,
    "team_member_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "monitored_tender_likes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monitored_email_recipients" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" VARCHAR(256) NOT NULL,
    "name" VARCHAR(256),
    "team" VARCHAR(128),
    "groups" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "monitored_email_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monitored_notification_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tender_id" UUID NOT NULL,
    "channel" VARCHAR(32) NOT NULL,
    "recipient" VARCHAR(512) NOT NULL,
    "status" VARCHAR(32) NOT NULL,
    "external_message_id" VARCHAR(128),
    "error" TEXT,
    "sent_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "monitored_notification_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monitored_tender_feedback" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tender_id" UUID NOT NULL,
    "verdict" VARCHAR(32) NOT NULL,
    "note" TEXT,
    "created_by" VARCHAR(256),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "monitored_tender_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "esg_articles_link_unique" ON "esg_articles"("link");

-- CreateIndex
CREATE UNIQUE INDEX "events_event_id_key" ON "events"("event_id");

-- CreateIndex
CREATE UNIQUE INDEX "unique_event_composite" ON "events"("event_name", "start_date", "source");

-- CreateIndex
CREATE UNIQUE INDEX "file_uploads_task_id_key" ON "file_uploads"("task_id");

-- CreateIndex
CREATE INDEX "ix_likes_content_type" ON "likes"("content_type");

-- CreateIndex
CREATE INDEX "ix_likes_user_id" ON "likes"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "unique_like" ON "likes"("user_id", "content_type", "content_id");

-- CreateIndex
CREATE UNIQUE INDEX "ix_pdf_translations_job_id" ON "pdf_translations"("job_id");

-- CreateIndex
CREATE UNIQUE INDEX "publications_link_unique" ON "publications"("link");

-- CreateIndex
CREATE UNIQUE INDEX "ix_users_username" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "ix_users_email" ON "users"("email");

-- CreateIndex
CREATE INDEX "ix_users_team" ON "users"("team");

-- CreateIndex
CREATE INDEX "idx_alert_preferences_alert_type" ON "alert_preferences"("alert_type");

-- CreateIndex
CREATE INDEX "idx_alert_preferences_is_active" ON "alert_preferences"("is_active");

-- CreateIndex
CREATE INDEX "idx_alert_preferences_next_send_at" ON "alert_preferences"("next_send_at");

-- CreateIndex
CREATE INDEX "idx_alert_prefs_user" ON "alert_preferences"("user_id");

-- CreateIndex
CREATE INDEX "idx_alert_history_domain" ON "alert_history"("domain");

-- CreateIndex
CREATE INDEX "idx_alert_history_sent" ON "alert_history"("sent_at" DESC);

-- CreateIndex
CREATE INDEX "idx_alert_history_status" ON "alert_history"("email_status");

-- CreateIndex
CREATE INDEX "idx_alert_history_type" ON "alert_history"("alert_type");

-- CreateIndex
CREATE INDEX "idx_alert_history_user" ON "alert_history"("user_id");

-- CreateIndex
CREATE INDEX "idx_email_queue_priority" ON "email_queue"("priority" DESC, "scheduled_for");

-- CreateIndex
CREATE INDEX "idx_email_queue_scheduled" ON "email_queue"("scheduled_for");

-- CreateIndex
CREATE INDEX "idx_email_queue_status" ON "email_queue"("status");

-- CreateIndex
CREATE INDEX "idx_email_queue_user" ON "email_queue"("user_id");

-- CreateIndex
CREATE INDEX "idx_alert_content_composite" ON "alert_content_sent"("domain", "content_type", "content_id");

-- CreateIndex
CREATE INDEX "idx_alert_content_alert_id" ON "alert_content_sent"("alert_preference_id");

-- CreateIndex
CREATE INDEX "idx_alert_content_domain" ON "alert_content_sent"("domain");

-- CreateIndex
CREATE INDEX "idx_alert_content_sent_at" ON "alert_content_sent"("sent_at");

-- CreateIndex
CREATE UNIQUE INDEX "unique_alert_content" ON "alert_content_sent"("alert_preference_id", "domain", "content_type", "content_id");

-- CreateIndex
CREATE INDEX "idx_action_items_assignee" ON "action_items"("assignee_user_id");

-- CreateIndex
CREATE INDEX "idx_action_items_meeting" ON "action_items"("meeting_id");

-- CreateIndex
CREATE INDEX "idx_action_items_status" ON "action_items"("status");

-- CreateIndex
CREATE INDEX "idx_article_ai_sessions_expires_at" ON "article_ai_sessions"("expires_at");

-- CreateIndex
CREATE INDEX "idx_article_ai_sessions_user_article" ON "article_ai_sessions"("user_id", "article_id");

-- CreateIndex
CREATE INDEX "idx_article_ai_sessions_user_created" ON "article_ai_sessions"("user_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "article_conversations_session_id_key" ON "article_conversations"("session_id");

-- CreateIndex
CREATE INDEX "idx_article_conversations_article" ON "article_conversations"("article_id", "article_source");

-- CreateIndex
CREATE INDEX "idx_article_conversations_session_id" ON "article_conversations"("session_id");

-- CreateIndex
CREATE INDEX "idx_article_conversations_user_id_last_message" ON "article_conversations"("user_id", "last_message_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "unique_user_article_conversation" ON "article_conversations"("user_id", "article_id", "article_source");

-- CreateIndex
CREATE INDEX "idx_article_messages_conversation_created" ON "article_messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_article_messages_conversation_index" ON "article_messages"("conversation_id", "message_index");

-- CreateIndex
CREATE INDEX "idx_article_tool_calls_conversation" ON "article_tool_calls"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_article_tool_calls_tool_name" ON "article_tool_calls"("tool_name");

-- CreateIndex
CREATE INDEX "idx_esg_driver_jobs_status" ON "esg_driver_jobs"("status");

-- CreateIndex
CREATE INDEX "idx_esg_driver_jobs_user_created" ON "esg_driver_jobs"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_decisions_meeting" ON "decisions"("meeting_id");

-- CreateIndex
CREATE INDEX "idx_domain_keywords_active" ON "domain_keywords"("is_active");

-- CreateIndex
CREATE INDEX "idx_domain_keywords_domain" ON "domain_keywords"("domain");

-- CreateIndex
CREATE INDEX "idx_domain_keywords_language" ON "domain_keywords"("language");

-- CreateIndex
CREATE UNIQUE INDEX "domain_keywords_domain_keyword_language_key" ON "domain_keywords"("domain", "keyword", "language");

-- CreateIndex
CREATE UNIQUE INDEX "email_drafts_meeting_id_key" ON "email_drafts"("meeting_id");

-- CreateIndex
CREATE INDEX "idx_email_drafts_meeting" ON "email_drafts"("meeting_id");

-- CreateIndex
CREATE INDEX "idx_email_drafts_sent" ON "email_drafts"("sent");

-- CreateIndex
CREATE INDEX "idx_participants_meeting" ON "meeting_participants"("meeting_id");

-- CreateIndex
CREATE INDEX "idx_participants_user" ON "meeting_participants"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_participants_meeting_id_user_id_key" ON "meeting_participants"("meeting_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_summaries_meeting_id_key" ON "meeting_summaries"("meeting_id");

-- CreateIndex
CREATE INDEX "idx_summaries_meeting" ON "meeting_summaries"("meeting_id");

-- CreateIndex
CREATE INDEX "idx_meetings_date" ON "meetings"("date" DESC);

-- CreateIndex
CREATE INDEX "idx_meetings_recorded_by" ON "meetings"("recorded_by_user_id");

-- CreateIndex
CREATE INDEX "idx_meetings_status" ON "meetings"("status");

-- CreateIndex
CREATE INDEX "idx_questions_meeting" ON "questions"("meeting_id");

-- CreateIndex
CREATE INDEX "idx_questions_resolved" ON "questions"("resolved");

-- CreateIndex
CREATE INDEX "idx_risks_meeting" ON "risks"("meeting_id");

-- CreateIndex
CREATE INDEX "idx_speaker_mapping_meeting" ON "speaker_mappings"("meeting_id");

-- CreateIndex
CREATE UNIQUE INDEX "speaker_mappings_meeting_id_speaker_label_key" ON "speaker_mappings"("meeting_id", "speaker_label");

-- CreateIndex
CREATE UNIQUE INDEX "tender_classifications_tender_id_key" ON "tender_classifications"("tender_id");

-- CreateIndex
CREATE INDEX "idx_tender_classifications_credit_score" ON "tender_classifications"("credit_score" DESC);

-- CreateIndex
CREATE INDEX "idx_tender_classifications_domain" ON "tender_classifications"("primary_domain");

-- CreateIndex
CREATE INDEX "idx_tender_classifications_esg_score" ON "tender_classifications"("esg_score" DESC);

-- CreateIndex
CREATE INDEX "idx_tender_classifications_tender" ON "tender_classifications"("tender_id");

-- CreateIndex
CREATE INDEX "idx_tender_scrape_logs_source" ON "tender_scrape_logs"("source_id");

-- CreateIndex
CREATE INDEX "idx_tender_scrape_logs_started" ON "tender_scrape_logs"("started_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "tender_sources_short_name_key" ON "tender_sources"("short_name");

-- CreateIndex
CREATE INDEX "idx_tender_sources_is_active" ON "tender_sources"("is_active");

-- CreateIndex
CREATE INDEX "idx_tender_sources_short_name" ON "tender_sources"("short_name");

-- CreateIndex
CREATE UNIQUE INDEX "tender_translations_tender_id_key" ON "tender_translations"("tender_id");

-- CreateIndex
CREATE INDEX "idx_tender_translations_created" ON "tender_translations"("created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_tender_translations_tender" ON "tender_translations"("tender_id");

-- CreateIndex
CREATE INDEX "idx_tenders_application_end_date" ON "tenders"("application_end_date");

-- CreateIndex
CREATE INDEX "idx_tenders_classification_date" ON "tenders"("classification_date");

-- CreateIndex
CREATE INDEX "idx_tenders_customer_name" ON "tenders"("customer_name");

-- CreateIndex
CREATE INDEX "idx_tenders_delivery_locations" ON "tenders" USING GIN ("delivery_locations");

-- CreateIndex
CREATE INDEX "idx_tenders_documents" ON "tenders" USING GIN ("documents");

-- CreateIndex
CREATE INDEX "idx_tenders_domain_classification" ON "tenders" USING GIN ("domain_classification");

-- CreateIndex
CREATE INDEX "idx_tenders_extra_data" ON "tenders" USING GIN ("extra_data");

-- CreateIndex
CREATE INDEX "idx_tenders_is_active" ON "tenders"("is_active");

-- CreateIndex
CREATE INDEX "idx_tenders_lot_id" ON "tenders"("lot_id");

-- CreateIndex
CREATE INDEX "idx_tenders_matched_keywords" ON "tenders" USING GIN ("matched_keywords");

-- CreateIndex
CREATE INDEX "idx_tenders_primary_domain" ON "tenders"("primary_domain");

-- CreateIndex
CREATE INDEX "idx_tenders_published_date" ON "tenders"("published_date" DESC);

-- CreateIndex
CREATE INDEX "idx_tenders_search_vector" ON "tenders" USING GIN ("search_vector");

-- CreateIndex
CREATE INDEX "idx_tenders_source_id" ON "tenders"("source_id");

-- CreateIndex
CREATE INDEX "idx_tenders_status" ON "tenders"("status");

-- CreateIndex
CREATE INDEX "idx_tenders_tender_number" ON "tenders"("tender_number");

-- CreateIndex
CREATE INDEX "idx_tenders_total_amount" ON "tenders"("total_amount");

-- CreateIndex
CREATE UNIQUE INDEX "tenders_source_id_lot_id_key" ON "tenders"("source_id", "lot_id");

-- CreateIndex
CREATE INDEX "idx_transcript_meeting" ON "transcript_segments"("meeting_id");

-- CreateIndex
CREATE INDEX "idx_transcript_speaker" ON "transcript_segments"("speaker_user_id");

-- CreateIndex
CREATE INDEX "idx_transcript_time" ON "transcript_segments"("meeting_id", "start_time");

-- CreateIndex
CREATE INDEX "idx_user_saved_tenders_tender" ON "user_saved_tenders"("tender_id");

-- CreateIndex
CREATE INDEX "idx_user_saved_tenders_user" ON "user_saved_tenders"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_saved_tenders_user_id_tender_id_key" ON "user_saved_tenders"("user_id", "tender_id");

-- CreateIndex
CREATE INDEX "idx_user_tender_alerts_active" ON "user_tender_alerts"("is_active");

-- CreateIndex
CREATE INDEX "idx_user_tender_alerts_user" ON "user_tender_alerts"("user_id");

-- CreateIndex
CREATE INDEX "idx_user_activity_action" ON "user_activity"("action");

-- CreateIndex
CREATE INDEX "idx_user_activity_resource" ON "user_activity"("resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "idx_user_activity_timestamp" ON "user_activity"("timestamp");

-- CreateIndex
CREATE INDEX "idx_user_activity_user_id" ON "user_activity"("user_id");

-- CreateIndex
CREATE INDEX "idx_monitored_sources_enabled" ON "monitored_tender_sources"("enabled");

-- CreateIndex
CREATE INDEX "idx_monitored_sources_country" ON "monitored_tender_sources"("country");

-- CreateIndex
CREATE INDEX "idx_monitored_tenders_source_name" ON "monitored_tenders"("source_name");

-- CreateIndex
CREATE INDEX "idx_monitored_tenders_canonical_id" ON "monitored_tenders"("canonical_id");

-- CreateIndex
CREATE INDEX "idx_monitored_tenders_country" ON "monitored_tenders"("country");

-- CreateIndex
CREATE INDEX "idx_monitored_tenders_published_at" ON "monitored_tenders"("published_at" DESC);

-- CreateIndex
CREATE INDEX "idx_monitored_tenders_deadline_at" ON "monitored_tenders"("deadline_at");

-- CreateIndex
CREATE INDEX "idx_monitored_tenders_first_seen_at" ON "monitored_tenders"("first_seen_at" DESC);

-- CreateIndex
CREATE INDEX "idx_monitored_tenders_is_active" ON "monitored_tenders"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "uq_monitored_tenders_source_external" ON "monitored_tenders"("source_name", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_monitored_team_members_member_key" ON "monitored_team_members"("member_key");

-- CreateIndex
CREATE INDEX "idx_monitored_team_members_member_key" ON "monitored_team_members"("member_key");

-- CreateIndex
CREATE INDEX "idx_monitored_team_members_last_used_at" ON "monitored_team_members"("last_used_at");

-- CreateIndex
CREATE INDEX "idx_monitored_share_contacts_sender_key" ON "monitored_share_contacts"("sender_key");

-- CreateIndex
CREATE UNIQUE INDEX "uq_monitored_share_contacts_sender_email" ON "monitored_share_contacts"("sender_key", "email");

-- CreateIndex
CREATE INDEX "idx_monitored_tender_likes_tender_id" ON "monitored_tender_likes"("tender_id");

-- CreateIndex
CREATE INDEX "idx_monitored_tender_likes_team_member_id" ON "monitored_tender_likes"("team_member_id");

-- CreateIndex
CREATE INDEX "idx_monitored_tender_likes_created_at" ON "monitored_tender_likes"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_monitored_tender_likes_tender_member" ON "monitored_tender_likes"("tender_id", "team_member_id");

-- CreateIndex
CREATE UNIQUE INDEX "monitored_email_recipients_email_key" ON "monitored_email_recipients"("email");

-- CreateIndex
CREATE INDEX "idx_monitored_email_recipients_enabled" ON "monitored_email_recipients"("enabled");

-- CreateIndex
CREATE INDEX "idx_monitored_email_recipients_team" ON "monitored_email_recipients"("team");

-- CreateIndex
CREATE INDEX "idx_monitored_notification_logs_tender_id" ON "monitored_notification_logs"("tender_id");

-- CreateIndex
CREATE INDEX "idx_monitored_notification_logs_sent_at" ON "monitored_notification_logs"("sent_at");

-- CreateIndex
CREATE INDEX "idx_monitored_notification_logs_recipient" ON "monitored_notification_logs"("recipient");

-- CreateIndex
CREATE INDEX "idx_monitored_tender_feedback_tender_id" ON "monitored_tender_feedback"("tender_id");

-- AddForeignKey
ALTER TABLE "file_uploads" ADD CONSTRAINT "file_uploads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "likes" ADD CONSTRAINT "fk_likes_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pdf_translation_jobs" ADD CONSTRAINT "pdf_translation_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pdf_translations" ADD CONSTRAINT "pdf_translations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "translation_history" ADD CONSTRAINT "translation_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "translation_pages" ADD CONSTRAINT "translation_pages_translation_id_fkey" FOREIGN KEY ("translation_id") REFERENCES "pdf_translations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "alert_preferences" ADD CONSTRAINT "alert_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "alert_history" ADD CONSTRAINT "alert_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "email_queue" ADD CONSTRAINT "email_queue_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "alert_content_sent" ADD CONSTRAINT "fk_alert_content_alert_pref" FOREIGN KEY ("alert_preference_id") REFERENCES "alert_preferences"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "action_items" ADD CONSTRAINT "action_items_assignee_user_id_fkey" FOREIGN KEY ("assignee_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "action_items" ADD CONSTRAINT "action_items_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "article_ai_sessions" ADD CONSTRAINT "fk_article_ai_sessions_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "article_conversations" ADD CONSTRAINT "article_conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "article_messages" ADD CONSTRAINT "article_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "article_conversations"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "article_tool_calls" ADD CONSTRAINT "article_tool_calls_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "article_conversations"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "esg_driver_jobs" ADD CONSTRAINT "esg_driver_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_decided_by_user_id_fkey" FOREIGN KEY ("decided_by_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "email_drafts" ADD CONSTRAINT "email_drafts_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "meeting_participants" ADD CONSTRAINT "meeting_participants_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "meeting_participants" ADD CONSTRAINT "meeting_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "meeting_summaries" ADD CONSTRAINT "meeting_summaries_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_asked_by_user_id_fkey" FOREIGN KEY ("asked_by_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_resolved_by_user_id_fkey" FOREIGN KEY ("resolved_by_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "risks" ADD CONSTRAINT "risks_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "risks" ADD CONSTRAINT "risks_raised_by_user_id_fkey" FOREIGN KEY ("raised_by_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "speaker_mappings" ADD CONSTRAINT "speaker_mappings_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "speaker_mappings" ADD CONSTRAINT "speaker_mappings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "tender_classifications" ADD CONSTRAINT "tender_classifications_tender_id_fkey" FOREIGN KEY ("tender_id") REFERENCES "tenders"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "tender_scrape_logs" ADD CONSTRAINT "tender_scrape_logs_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "tender_sources"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "tender_translations" ADD CONSTRAINT "tender_translations_tender_id_fkey" FOREIGN KEY ("tender_id") REFERENCES "tenders"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "tenders" ADD CONSTRAINT "tenders_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "tender_sources"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "transcript_segments" ADD CONSTRAINT "transcript_segments_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "transcript_segments" ADD CONSTRAINT "transcript_segments_speaker_user_id_fkey" FOREIGN KEY ("speaker_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_saved_tenders" ADD CONSTRAINT "user_saved_tenders_tender_id_fkey" FOREIGN KEY ("tender_id") REFERENCES "tenders"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_activity" ADD CONSTRAINT "user_activity_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "monitored_tenders" ADD CONSTRAINT "monitored_tenders_source_name_fkey" FOREIGN KEY ("source_name") REFERENCES "monitored_tender_sources"("name") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitored_tenders" ADD CONSTRAINT "monitored_tenders_canonical_id_fkey" FOREIGN KEY ("canonical_id") REFERENCES "monitored_tenders"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "monitored_tender_likes" ADD CONSTRAINT "monitored_tender_likes_tender_id_fkey" FOREIGN KEY ("tender_id") REFERENCES "monitored_tenders"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "monitored_tender_likes" ADD CONSTRAINT "monitored_tender_likes_team_member_id_fkey" FOREIGN KEY ("team_member_id") REFERENCES "monitored_team_members"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "monitored_notification_logs" ADD CONSTRAINT "monitored_notification_logs_tender_id_fkey" FOREIGN KEY ("tender_id") REFERENCES "monitored_tenders"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "monitored_tender_feedback" ADD CONSTRAINT "monitored_tender_feedback_tender_id_fkey" FOREIGN KEY ("tender_id") REFERENCES "monitored_tenders"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

