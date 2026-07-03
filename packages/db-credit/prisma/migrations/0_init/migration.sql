-- CreateEnum
CREATE TYPE "permissiontype" AS ENUM ('USER_CREATE', 'USER_READ', 'USER_UPDATE', 'USER_DELETE', 'ARTICLE_CREATE', 'ARTICLE_READ', 'ARTICLE_UPDATE', 'ARTICLE_DELETE', 'ARTICLE_PUBLISH', 'EVENT_CREATE', 'EVENT_READ', 'EVENT_UPDATE', 'EVENT_DELETE', 'ADMIN_ACCESS', 'ADMIN_USERS', 'ADMIN_CONTENT', 'ADMIN_SETTINGS', 'ADMIN_LOGS', 'SYSTEM_CONFIG', 'SYSTEM_BACKUP', 'SYSTEM_MAINTENANCE');

-- CreateEnum
CREATE TYPE "userrole" AS ENUM ('ADMIN', 'MODERATOR', 'USER', 'GUEST');

-- CreateTable
CREATE TABLE "activity_logs" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER,
    "action" VARCHAR(100) NOT NULL,
    "details" TEXT,
    "ip_address" VARCHAR(50),
    "timestamp" TIMESTAMP(6),

    CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activitylog" (
    "user_id" INTEGER,
    "action" VARCHAR(100) NOT NULL,
    "resource" VARCHAR(100),
    "resource_id" VARCHAR(255),
    "details" TEXT,
    "ip_address" VARCHAR(45),
    "user_agent" TEXT,
    "status" VARCHAR(50) NOT NULL,
    "error" TEXT,
    "request_id" VARCHAR(255),
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activitylog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_assistant_config" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER,
    "config_key" VARCHAR(100) NOT NULL,
    "config_value" TEXT NOT NULL,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_assistant_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_conversations" (
    "id" SERIAL NOT NULL,
    "session_id" VARCHAR(255) NOT NULL,
    "user_id" INTEGER,
    "title" VARCHAR(255),
    "summary" TEXT,
    "total_messages" INTEGER DEFAULT 0,
    "tokens_used" INTEGER DEFAULT 0,
    "cost_usd" DECIMAL(10,4) DEFAULT 0,
    "status" VARCHAR(20) DEFAULT 'active',
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_entity_memory" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER,
    "entity_type" VARCHAR(50) NOT NULL,
    "entity_key" VARCHAR(255) NOT NULL,
    "entity_data" JSONB NOT NULL,
    "confidence_score" DECIMAL(3,2) DEFAULT 0.5,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_entity_memory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_knowledge_base" (
    "id" SERIAL NOT NULL,
    "knowledge_type" VARCHAR(50) NOT NULL,
    "topic" VARCHAR(100) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "content" TEXT NOT NULL,
    "source" VARCHAR(100),
    "confidence_score" DECIMAL(3,2) DEFAULT 0.5,
    "usage_count" INTEGER DEFAULT 0,
    "last_used" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_knowledge_base_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_session_memory" (
    "id" SERIAL NOT NULL,
    "session_id" VARCHAR(255) NOT NULL,
    "user_id" INTEGER,
    "message_index" INTEGER NOT NULL,
    "role" VARCHAR(20) NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(6) DEFAULT (CURRENT_TIMESTAMP + '24:00:00'::interval),

    CONSTRAINT "ai_session_memory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "article" (
    "title" VARCHAR(500) NOT NULL,
    "slug" VARCHAR(500) NOT NULL,
    "summary" TEXT,
    "content" TEXT,
    "source" VARCHAR(255),
    "source_url" VARCHAR(1000),
    "published_at" TIMESTAMPTZ(6),
    "category" VARCHAR(100),
    "region" VARCHAR(100),
    "sector" VARCHAR(100),
    "keywords" JSON,
    "sentiment_score" DOUBLE PRECISION,
    "relevance_score" DOUBLE PRECISION,
    "author_id" INTEGER,
    "author_name" VARCHAR(255),
    "is_published" BOOLEAN NOT NULL,
    "is_featured" BOOLEAN NOT NULL,
    "view_count" INTEGER NOT NULL,
    "unique_viewers" INTEGER NOT NULL,
    "ai_summary" TEXT,
    "ai_summary_provider" VARCHAR(50),
    "ai_summary_generated_at" TIMESTAMPTZ(6),
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_deleted" BOOLEAN NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "article_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "article_tags" (
    "article_id" INTEGER NOT NULL,
    "tag_id" INTEGER NOT NULL,

    CONSTRAINT "article_tags_pkey" PRIMARY KEY ("article_id","tag_id")
);

-- CreateTable
CREATE TABLE "articlestar" (
    "user_id" INTEGER NOT NULL,
    "article_id" INTEGER NOT NULL,
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "articlestar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "articleview" (
    "article_id" INTEGER NOT NULL,
    "user_id" INTEGER,
    "ip_address" VARCHAR(45),
    "user_agent" TEXT,
    "referrer" VARCHAR(1000),
    "view_duration" INTEGER,
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "articleview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_articles" (
    "id" SERIAL NOT NULL,
    "title" TEXT,
    "date" DATE,
    "content" TEXT,
    "link" TEXT,
    "source" TEXT,
    "matched_keywords" TEXT,
    "region" TEXT,
    "sector" TEXT,
    "starred" BOOLEAN DEFAULT false,
    "starred_at" TIMESTAMP(6),
    "summary" TEXT,
    "url" VARCHAR,
    "created_at" TIMESTAMP(6),
    "updated_at" TIMESTAMP(6),

    CONSTRAINT "credit_articles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_alerts" (
    "id" SERIAL NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "alert_type" VARCHAR(50) NOT NULL,
    "subscription_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "email_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event" (
    "title" VARCHAR(500) NOT NULL,
    "slug" VARCHAR(500) NOT NULL,
    "description" TEXT,
    "event_type" VARCHAR(50),
    "location" VARCHAR(500),
    "venue" VARCHAR(500),
    "is_virtual" BOOLEAN NOT NULL,
    "virtual_link" VARCHAR(1000),
    "start_date" TIMESTAMPTZ(6) NOT NULL,
    "end_date" TIMESTAMPTZ(6),
    "timezone" VARCHAR(50),
    "registration_link" VARCHAR(1000),
    "registration_deadline" TIMESTAMPTZ(6),
    "max_attendees" INTEGER,
    "price" DOUBLE PRECISION,
    "currency" VARCHAR(3),
    "organizer" VARCHAR(255),
    "organizer_email" VARCHAR(255),
    "organizer_phone" VARCHAR(50),
    "sponsors" JSON,
    "agenda" TEXT,
    "speakers" JSON,
    "tags" JSON,
    "source" VARCHAR(255),
    "source_url" VARCHAR(1000),
    "is_published" BOOLEAN NOT NULL,
    "is_featured" BOOLEAN NOT NULL,
    "is_cancelled" BOOLEAN NOT NULL,
    "cancellation_reason" TEXT,
    "created_by_id" INTEGER,
    "view_count" INTEGER NOT NULL,
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_deleted" BOOLEAN NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eventregistration" (
    "event_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "registered_at" TIMESTAMPTZ(6) NOT NULL,
    "is_confirmed" BOOLEAN NOT NULL,
    "is_cancelled" BOOLEAN NOT NULL,
    "cancelled_at" TIMESTAMPTZ(6),
    "cancellation_reason" TEXT,
    "attended" BOOLEAN NOT NULL,
    "check_in_time" TIMESTAMPTZ(6),
    "dietary_requirements" TEXT,
    "special_requirements" TEXT,
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eventregistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" SERIAL NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "date" TIMESTAMP(6),
    "location" VARCHAR(255),
    "details" TEXT,
    "link" VARCHAR(500),
    "source" VARCHAR(50),
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "methodologies" (
    "id" SERIAL NOT NULL,
    "title" TEXT,
    "published_date" DATE,
    "abstract" TEXT,
    "description" TEXT,
    "link" TEXT,
    "source" TEXT,
    "permalink" TEXT,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "report_url" VARCHAR(255),

    CONSTRAINT "methodologies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "newsletter_logs" (
    "id" SERIAL NOT NULL,
    "subscription_id" INTEGER NOT NULL,
    "sent_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "email_to" VARCHAR(255) NOT NULL,
    "email_subject" VARCHAR(500),
    "articles_count" INTEGER DEFAULT 0,
    "success" BOOLEAN DEFAULT true,
    "error_message" TEXT,
    "articles_included" JSONB,
    "email_content_preview" TEXT,

    CONSTRAINT "newsletter_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "newsletter_preferences" (
    "id" SERIAL NOT NULL,
    "subscription_id" INTEGER NOT NULL,
    "sources" TEXT[],
    "regions" TEXT[],
    "sectors" TEXT[],
    "include_starred_only" BOOLEAN DEFAULT false,
    "frequency" VARCHAR(20) NOT NULL DEFAULT 'weekly',
    "day_of_week" INTEGER,
    "time_of_day" TIME(6) DEFAULT '09:00:00'::time without time zone,
    "timezone" VARCHAR(50) DEFAULT 'UTC',
    "max_articles_per_email" INTEGER DEFAULT 10,
    "include_summary" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "newsletter_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "newsletter_subscriptions" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "subscription_type" VARCHAR(50) NOT NULL,
    "is_active" BOOLEAN DEFAULT true,
    "email" VARCHAR(255),
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "newsletter_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permission" (
    "name" "permissiontype" NOT NULL,
    "description" VARCHAR(255),
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publications" (
    "id" SERIAL NOT NULL,
    "title" TEXT,
    "date" DATE,
    "description" TEXT,
    "link" TEXT,
    "image_url" TEXT,
    "source" TEXT,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "publications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refreshtoken" (
    "token" VARCHAR(255) NOT NULL,
    "user_id" INTEGER NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked" BOOLEAN NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refreshtoken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tag" (
    "name" VARCHAR(100) NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user" (
    "email" VARCHAR(255) NOT NULL,
    "username" VARCHAR(100),
    "full_name" VARCHAR(255),
    "hashed_password" VARCHAR(255) NOT NULL,
    "is_active" BOOLEAN NOT NULL,
    "is_verified" BOOLEAN NOT NULL,
    "role" "userrole" NOT NULL,
    "bio" TEXT,
    "avatar_url" VARCHAR(500),
    "phone_number" VARCHAR(20),
    "last_login_at" TIMESTAMPTZ(6),
    "last_login_ip" VARCHAR(45),
    "failed_login_attempts" INTEGER NOT NULL,
    "locked_until" TIMESTAMPTZ(6),
    "two_factor_enabled" BOOLEAN NOT NULL,
    "two_factor_secret" VARCHAR(32),
    "email_verified_at" TIMESTAMPTZ(6),
    "email_verification_token" VARCHAR(255),
    "password_reset_token" VARCHAR(255),
    "password_reset_expires" TIMESTAMPTZ(6),
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_deleted" BOOLEAN NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_activity" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "action" VARCHAR(100) NOT NULL,
    "resource_type" VARCHAR(50),
    "resource_id" INTEGER,
    "details" TEXT,
    "ip_address" INET,
    "user_agent" TEXT,
    "timestamp" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_alerts" (
    "id" SERIAL NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "sources" TEXT,
    "sectors" TEXT,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_article_stars" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "article_id" INTEGER NOT NULL,
    "starred_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_article_stars_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_events" (
    "id" SERIAL NOT NULL,
    "user_email" VARCHAR(100) NOT NULL,
    "event_id" INTEGER NOT NULL,
    "event_title" VARCHAR(255) NOT NULL,
    "event_date" TIMESTAMP(6) NOT NULL,
    "event_link" VARCHAR(500),
    "created_at" TIMESTAMP(6),

    CONSTRAINT "user_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_permissions" (
    "user_id" INTEGER NOT NULL,
    "permission_id" INTEGER NOT NULL,

    CONSTRAINT "user_permissions_pkey" PRIMARY KEY ("user_id","permission_id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "first_name" VARCHAR(50) NOT NULL,
    "last_name" VARCHAR(50) NOT NULL,
    "email" VARCHAR(100) NOT NULL,
    "password_hash" VARCHAR(256) NOT NULL,
    "role" VARCHAR(20) NOT NULL,
    "is_active" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(6),
    "updated_at" TIMESTAMP(6),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usersession" (
    "user_id" INTEGER NOT NULL,
    "session_id" VARCHAR(255) NOT NULL,
    "ip_address" VARCHAR(45),
    "user_agent" TEXT,
    "last_activity" TIMESTAMPTZ(6) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usersession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fitch_upload_history" (
    "id" SERIAL NOT NULL,
    "user_email" VARCHAR(255) NOT NULL,
    "original_filename" VARCHAR(255) NOT NULL,
    "updated_filename" VARCHAR(255) NOT NULL,
    "file_data" BYTEA NOT NULL,
    "companies_count" INTEGER NOT NULL DEFAULT 0,
    "success_count" INTEGER NOT NULL DEFAULT 0,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "file_size" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fitch_upload_history_pkey" PRIMARY KEY ("id")
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

-- CreateIndex
CREATE INDEX "ix_activitylog_action" ON "activitylog"("action");

-- CreateIndex
CREATE INDEX "ix_activitylog_created_at" ON "activitylog"("created_at");

-- CreateIndex
CREATE INDEX "ix_activitylog_id" ON "activitylog"("id");

-- CreateIndex
CREATE INDEX "ix_activitylog_request_id" ON "activitylog"("request_id");

-- CreateIndex
CREATE INDEX "ix_activitylog_resource" ON "activitylog"("resource");

-- CreateIndex
CREATE INDEX "ix_activitylog_updated_at" ON "activitylog"("updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_assistant_config_user_id_config_key_key" ON "ai_assistant_config"("user_id", "config_key");

-- CreateIndex
CREATE INDEX "idx_conversations_session" ON "ai_conversations"("session_id");

-- CreateIndex
CREATE INDEX "idx_conversations_user" ON "ai_conversations"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_entity_memory_key" ON "ai_entity_memory"("entity_key");

-- CreateIndex
CREATE INDEX "idx_entity_memory_user_type" ON "ai_entity_memory"("user_id", "entity_type");

-- CreateIndex
CREATE UNIQUE INDEX "ai_entity_memory_user_id_entity_type_entity_key_key" ON "ai_entity_memory"("user_id", "entity_type", "entity_key");

-- CreateIndex
CREATE INDEX "idx_knowledge_base_topic" ON "ai_knowledge_base"("topic", "knowledge_type");

-- CreateIndex
CREATE INDEX "idx_knowledge_base_usage" ON "ai_knowledge_base"("usage_count" DESC, "last_used" DESC);

-- CreateIndex
CREATE INDEX "idx_session_memory_expires" ON "ai_session_memory"("expires_at");

-- CreateIndex
CREATE INDEX "idx_session_memory_session" ON "ai_session_memory"("session_id", "message_index");

-- CreateIndex
CREATE UNIQUE INDEX "ix_article_slug" ON "article"("slug");

-- CreateIndex
CREATE INDEX "ix_article_category" ON "article"("category");

-- CreateIndex
CREATE INDEX "ix_article_created_at" ON "article"("created_at");

-- CreateIndex
CREATE INDEX "ix_article_id" ON "article"("id");

-- CreateIndex
CREATE INDEX "ix_article_is_deleted" ON "article"("is_deleted");

-- CreateIndex
CREATE INDEX "ix_article_is_published" ON "article"("is_published");

-- CreateIndex
CREATE INDEX "ix_article_published_at" ON "article"("published_at");

-- CreateIndex
CREATE INDEX "ix_article_region" ON "article"("region");

-- CreateIndex
CREATE INDEX "ix_article_sector" ON "article"("sector");

-- CreateIndex
CREATE INDEX "ix_article_source" ON "article"("source");

-- CreateIndex
CREATE INDEX "ix_article_title" ON "article"("title");

-- CreateIndex
CREATE INDEX "ix_article_updated_at" ON "article"("updated_at");

-- CreateIndex
CREATE INDEX "ix_articlestar_created_at" ON "articlestar"("created_at");

-- CreateIndex
CREATE INDEX "ix_articlestar_id" ON "articlestar"("id");

-- CreateIndex
CREATE INDEX "ix_articlestar_updated_at" ON "articlestar"("updated_at");

-- CreateIndex
CREATE INDEX "ix_articleview_created_at" ON "articleview"("created_at");

-- CreateIndex
CREATE INDEX "ix_articleview_id" ON "articleview"("id");

-- CreateIndex
CREATE INDEX "ix_articleview_updated_at" ON "articleview"("updated_at");

-- CreateIndex
CREATE INDEX "idx_articles_date_desc" ON "credit_articles"("date" DESC);

-- CreateIndex
CREATE INDEX "idx_articles_region" ON "credit_articles"("region");

-- CreateIndex
CREATE INDEX "idx_articles_region_sector" ON "credit_articles"("region", "sector");

-- CreateIndex
CREATE INDEX "idx_articles_sector" ON "credit_articles"("sector");

-- CreateIndex
CREATE INDEX "idx_articles_source" ON "credit_articles"("source");

-- CreateIndex
CREATE INDEX "idx_credit_articles_date" ON "credit_articles"("date");

-- CreateIndex
CREATE INDEX "idx_credit_articles_region" ON "credit_articles"("region");

-- CreateIndex
CREATE INDEX "idx_credit_articles_sector" ON "credit_articles"("sector");

-- CreateIndex
CREATE INDEX "idx_credit_articles_source" ON "credit_articles"("source");

-- CreateIndex
CREATE UNIQUE INDEX "unique_article_combination" ON "credit_articles"("link", "region", "sector", "source");

-- CreateIndex
CREATE UNIQUE INDEX "ix_event_slug" ON "event"("slug");

-- CreateIndex
CREATE INDEX "ix_event_created_at" ON "event"("created_at");

-- CreateIndex
CREATE INDEX "ix_event_event_type" ON "event"("event_type");

-- CreateIndex
CREATE INDEX "ix_event_id" ON "event"("id");

-- CreateIndex
CREATE INDEX "ix_event_is_deleted" ON "event"("is_deleted");

-- CreateIndex
CREATE INDEX "ix_event_is_published" ON "event"("is_published");

-- CreateIndex
CREATE INDEX "ix_event_start_date" ON "event"("start_date");

-- CreateIndex
CREATE INDEX "ix_event_title" ON "event"("title");

-- CreateIndex
CREATE INDEX "ix_event_updated_at" ON "event"("updated_at");

-- CreateIndex
CREATE INDEX "ix_eventregistration_created_at" ON "eventregistration"("created_at");

-- CreateIndex
CREATE INDEX "ix_eventregistration_id" ON "eventregistration"("id");

-- CreateIndex
CREATE INDEX "ix_eventregistration_updated_at" ON "eventregistration"("updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "methodologies_link_key" ON "methodologies"("link");

-- CreateIndex
CREATE UNIQUE INDEX "methodologies_report_url_key" ON "methodologies"("report_url");

-- CreateIndex
CREATE INDEX "idx_newsletter_logs_sent_at" ON "newsletter_logs"("sent_at");

-- CreateIndex
CREATE INDEX "idx_newsletter_logs_subscription" ON "newsletter_logs"("subscription_id", "sent_at");

-- CreateIndex
CREATE INDEX "idx_newsletter_preferences_frequency" ON "newsletter_preferences"("frequency", "day_of_week");

-- CreateIndex
CREATE INDEX "idx_newsletter_subscriptions_type" ON "newsletter_subscriptions"("subscription_type", "is_active");

-- CreateIndex
CREATE INDEX "idx_newsletter_subscriptions_user_active" ON "newsletter_subscriptions"("user_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "newsletter_subscriptions_user_id_subscription_type_key" ON "newsletter_subscriptions"("user_id", "subscription_type");

-- CreateIndex
CREATE UNIQUE INDEX "permission_name_key" ON "permission"("name");

-- CreateIndex
CREATE INDEX "ix_permission_created_at" ON "permission"("created_at");

-- CreateIndex
CREATE INDEX "ix_permission_id" ON "permission"("id");

-- CreateIndex
CREATE INDEX "ix_permission_updated_at" ON "permission"("updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "publications_link_key" ON "publications"("link");

-- CreateIndex
CREATE UNIQUE INDEX "ix_refreshtoken_token" ON "refreshtoken"("token");

-- CreateIndex
CREATE INDEX "ix_refreshtoken_created_at" ON "refreshtoken"("created_at");

-- CreateIndex
CREATE INDEX "ix_refreshtoken_id" ON "refreshtoken"("id");

-- CreateIndex
CREATE INDEX "ix_refreshtoken_updated_at" ON "refreshtoken"("updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ix_tag_name" ON "tag"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ix_tag_slug" ON "tag"("slug");

-- CreateIndex
CREATE INDEX "ix_tag_created_at" ON "tag"("created_at");

-- CreateIndex
CREATE INDEX "ix_tag_id" ON "tag"("id");

-- CreateIndex
CREATE INDEX "ix_tag_updated_at" ON "tag"("updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "ix_user_email" ON "user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "ix_user_username" ON "user"("username");

-- CreateIndex
CREATE INDEX "ix_user_created_at" ON "user"("created_at");

-- CreateIndex
CREATE INDEX "ix_user_id" ON "user"("id");

-- CreateIndex
CREATE INDEX "ix_user_is_deleted" ON "user"("is_deleted");

-- CreateIndex
CREATE INDEX "ix_user_updated_at" ON "user"("updated_at");

-- CreateIndex
CREATE INDEX "idx_user_activity_action" ON "user_activity"("action");

-- CreateIndex
CREATE INDEX "idx_user_activity_resource" ON "user_activity"("resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "idx_user_activity_timestamp" ON "user_activity"("timestamp");

-- CreateIndex
CREATE INDEX "idx_user_activity_user_id" ON "user_activity"("user_id");

-- CreateIndex
CREATE INDEX "idx_user_article_stars_article_id" ON "user_article_stars"("article_id");

-- CreateIndex
CREATE INDEX "idx_user_article_stars_starred_at" ON "user_article_stars"("starred_at" DESC);

-- CreateIndex
CREATE INDEX "idx_user_article_stars_user_id" ON "user_article_stars"("user_id");

-- CreateIndex
CREATE INDEX "idx_user_stars_article_id" ON "user_article_stars"("article_id");

-- CreateIndex
CREATE INDEX "idx_user_stars_starred_at" ON "user_article_stars"("starred_at" DESC);

-- CreateIndex
CREATE INDEX "idx_user_stars_user_id" ON "user_article_stars"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "idx_users_email" ON "users"("email");

-- CreateIndex
CREATE INDEX "idx_users_is_active" ON "users"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "ix_usersession_session_id" ON "usersession"("session_id");

-- CreateIndex
CREATE INDEX "ix_usersession_created_at" ON "usersession"("created_at");

-- CreateIndex
CREATE INDEX "ix_usersession_id" ON "usersession"("id");

-- CreateIndex
CREATE INDEX "ix_usersession_updated_at" ON "usersession"("updated_at");

-- CreateIndex
CREATE INDEX "fitch_upload_history_user_email_idx" ON "fitch_upload_history"("user_email");

-- CreateIndex
CREATE INDEX "fitch_upload_history_created_at_idx" ON "fitch_upload_history"("created_at");

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "activitylog" ADD CONSTRAINT "activitylog_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ai_assistant_config" ADD CONSTRAINT "ai_assistant_config_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ai_entity_memory" ADD CONSTRAINT "ai_entity_memory_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ai_session_memory" ADD CONSTRAINT "ai_session_memory_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "article" ADD CONSTRAINT "article_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "article_tags" ADD CONSTRAINT "article_tags_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "article"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "article_tags" ADD CONSTRAINT "article_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tag"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "articlestar" ADD CONSTRAINT "articlestar_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "article"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "articlestar" ADD CONSTRAINT "articlestar_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "articleview" ADD CONSTRAINT "articleview_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "article"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "articleview" ADD CONSTRAINT "articleview_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "event" ADD CONSTRAINT "event_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "eventregistration" ADD CONSTRAINT "eventregistration_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "eventregistration" ADD CONSTRAINT "eventregistration_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "newsletter_logs" ADD CONSTRAINT "newsletter_logs_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "newsletter_subscriptions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "newsletter_preferences" ADD CONSTRAINT "newsletter_preferences_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "newsletter_subscriptions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "newsletter_subscriptions" ADD CONSTRAINT "newsletter_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "refreshtoken" ADD CONSTRAINT "refreshtoken_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_activity" ADD CONSTRAINT "user_activity_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_article_stars" ADD CONSTRAINT "fk_article" FOREIGN KEY ("article_id") REFERENCES "credit_articles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_article_stars" ADD CONSTRAINT "fk_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permission"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "usersession" ADD CONSTRAINT "usersession_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

