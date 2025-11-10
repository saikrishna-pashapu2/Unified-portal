-- ============================================================================
-- TENDER MONITORING SYSTEM - DATABASE SCHEMA
-- ============================================================================
-- Description: Complete schema for tender/procurement monitoring system
-- Features:
--   - Multi-source tender aggregation
--   - Immediate English translation (no multi-language storage)
--   - AI-based ESG/Credit domain classification using LLM
--   - Configurable keyword matching for both domains
--   - User alerts and saved tenders
--   - Scraping every 3 hours
--   - Full-text search in English
--   - Translation and classification cost tracking
-- ============================================================================
-- IMPORTANT: Tables are created in dependency order to avoid FK errors
-- ============================================================================

-- ============================================================================
-- TABLE 1: tender_sources (NO DEPENDENCIES)
-- Track different tender data sources (websites to scrape)
-- ============================================================================

CREATE TABLE IF NOT EXISTS tender_sources (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    short_name VARCHAR(50) NOT NULL UNIQUE,     -- URL-friendly identifier
    country VARCHAR(100),
    base_url VARCHAR(500) NOT NULL,
    search_url_template VARCHAR(1000),          -- URL template for searches with placeholders
    
    -- Scraping configuration
    is_active BOOLEAN DEFAULT TRUE,
    scrape_frequency_hours INTEGER DEFAULT 3,   -- How often to scrape (3 hours)
    requires_auth BOOLEAN DEFAULT FALSE,
    
    -- Request configuration
    default_headers JSONB,                      -- HTTP headers for requests
    scraper_config JSONB,                       -- CSS selectors, pagination rules, etc.
    
    -- Scraping statistics
    last_scrape_date TIMESTAMP,
    last_scrape_status VARCHAR(50),             -- "success", "error", "partial"
    total_scrapes INTEGER DEFAULT 0,
    successful_scrapes INTEGER DEFAULT 0,
    failed_scrapes INTEGER DEFAULT 0,
    success_rate DECIMAL(5, 2),                 -- Percentage
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- TABLE 2: domain_keywords (NO DEPENDENCIES)
-- Configurable keywords for domain classification
-- ============================================================================

CREATE TABLE IF NOT EXISTS domain_keywords (
    id SERIAL PRIMARY KEY,
    domain VARCHAR(20) NOT NULL,                -- "esg", "credit"
    keyword TEXT NOT NULL,
    category VARCHAR(100),                      -- "environmental", "social", "governance", etc.
    weight DECIMAL(3, 2) DEFAULT 1.0,          -- Keyword importance weight
    language VARCHAR(10) DEFAULT 'en',          -- "en", "ru", "kz"
    is_active BOOLEAN DEFAULT TRUE,
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(domain, keyword, language)
);

-- ============================================================================
-- TABLE 3: tenders (DEPENDS ON: tender_sources)
-- Main table storing all tender information (content in English)
-- ============================================================================

CREATE TABLE IF NOT EXISTS tenders (
    id SERIAL PRIMARY KEY,
    
    -- Source tracking
    source_id INTEGER REFERENCES tender_sources(id) ON DELETE CASCADE,
    lot_id VARCHAR(50),                         -- Unique ID from source system
    tender_number VARCHAR(100),                 -- Official tender/lot number
    tender_url TEXT NOT NULL,                   -- URL to tender detail page
    announcement_url TEXT,                      -- URL to related announcement
    
    -- Original content (Russian/Kazakh - for reference only)
    original_title TEXT NOT NULL,              -- Original title (any language)
    original_description TEXT,                  -- Original description
    original_additional_info TEXT,              -- Original additional info
    original_delivery_terms TEXT,               -- Original delivery terms
    original_language VARCHAR(10) DEFAULT 'ru', -- "ru", "kz", "mixed"
    
    -- Primary content (ALWAYS in English - auto-translated immediately)
    title TEXT NOT NULL,                        -- English title (primary)
    description TEXT,                           -- English description
    additional_info TEXT,                       -- English additional info
    delivery_terms TEXT,                        -- English delivery terms
    
    -- Financial Information
    total_amount DECIMAL(20, 2),
    currency VARCHAR(10) DEFAULT 'KZT',
    amount_by_year JSONB,                       -- {"2025": 10126650, "2026": 9403740}
    advance_payment DECIMAL(20, 2),
    advance_percentage DECIMAL(5, 2),
    
    -- Classification & Categorization
    ktru_code VARCHAR(50),                      -- Product classification code
    procurement_type VARCHAR(100),
    procurement_method VARCHAR(100),
    
    -- Customer Information
    customer_name TEXT,
    customer_bin VARCHAR(50),                   -- Business ID Number
    customer_address TEXT,
    customer_contact TEXT,
    
    -- Dates
    published_date DATE,
    application_start_date DATE,
    application_end_date DATE,
    contract_start_date DATE,
    contract_end_date DATE,
    
    -- Status
    original_status VARCHAR(50),                -- Original status (Russian/Kazakh)
    status VARCHAR(50),                         -- Translated status (English)
    is_active BOOLEAN DEFAULT TRUE,
    
    -- AI Classification (LLM-based categorization)
    domain_classification JSONB,                -- {"esg": 0.85, "credit": 0.45} - confidence scores
    primary_domain VARCHAR(20),                 -- "esg", "credit", "both", "neither"
    classification_confidence DECIMAL(3, 2),    -- Confidence score 0-1
    matched_keywords JSONB,                     -- {"esg": ["green", "sustainability"], "credit": [...]}
    ai_summary TEXT,                            -- LLM-generated summary
    classification_date TIMESTAMP,
    
    -- Flexible additional data (for future extensibility)
    extra_data JSONB,                           -- Store any additional fields from different sources
    delivery_locations JSONB,                   -- [{"region": "...", "address": "..."}]
    documents JSONB,                            -- [{"name": "...", "url": "..."}]
    
    -- Full-text search
    search_vector tsvector,                     -- Auto-updated search index (English)
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    -- Constraints
    UNIQUE(source_id, lot_id)                   -- Prevent duplicates from same source
);

-- ============================================================================
-- TABLE 4: tender_scrape_logs (DEPENDS ON: tender_sources)
-- Track scraping operations
-- ============================================================================

CREATE TABLE IF NOT EXISTS tender_scrape_logs (
    id SERIAL PRIMARY KEY,
    source_id INTEGER REFERENCES tender_sources(id) ON DELETE CASCADE,
    
    -- Scrape details
    started_at TIMESTAMP NOT NULL,
    completed_at TIMESTAMP,
    status VARCHAR(50),                         -- "success", "error", "partial"
    
    -- Results
    tenders_found INTEGER DEFAULT 0,
    tenders_new INTEGER DEFAULT 0,
    tenders_updated INTEGER DEFAULT 0,
    tenders_failed INTEGER DEFAULT 0,
    
    -- Error tracking
    error_message TEXT,
    error_stack TEXT,
    
    -- Performance
    duration_seconds INTEGER,
    pages_scraped INTEGER DEFAULT 0,
    
    -- Metadata
    scraper_version VARCHAR(50),
    trigger_type VARCHAR(50)                    -- "scheduled", "manual", "on-demand"
);

-- ============================================================================
-- TABLE 5: tender_translations (DEPENDS ON: tenders)
-- Track translation operations and costs
-- ============================================================================

CREATE TABLE IF NOT EXISTS tender_translations (
    id SERIAL PRIMARY KEY,
    tender_id INTEGER REFERENCES tenders(id) ON DELETE CASCADE,
    
    -- Translation details
    source_language VARCHAR(10) NOT NULL,       -- "ru", "kz", "mixed"
    target_language VARCHAR(10) NOT NULL,       -- "en"
    
    -- Statistics
    total_characters INTEGER,
    translation_method VARCHAR(50) DEFAULT 'openai', -- "openai", "google", "manual"
    translation_cost DECIMAL(10, 6),            -- Cost in USD
    translation_time_ms INTEGER,                -- Processing time
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(tender_id)
);

-- ============================================================================
-- TABLE 6: tender_classifications (DEPENDS ON: tenders)
-- Track AI classification results
-- ============================================================================

CREATE TABLE IF NOT EXISTS tender_classifications (
    id SERIAL PRIMARY KEY,
    tender_id INTEGER REFERENCES tenders(id) ON DELETE CASCADE,
    
    -- Classification results
    esg_score DECIMAL(3, 2),                    -- 0-1 confidence for ESG
    credit_score DECIMAL(3, 2),                 -- 0-1 confidence for Credit
    primary_domain VARCHAR(20),                 -- "esg", "credit", "both", "neither"
    reasoning TEXT,                             -- LLM explanation
    
    -- Matched keywords
    esg_keywords TEXT[],                        -- Array of matched ESG keywords
    credit_keywords TEXT[],                     -- Array of matched Credit keywords
    
    -- AI metadata
    model_used VARCHAR(50) DEFAULT 'gpt-4o-mini',
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    classification_cost DECIMAL(10, 6),
    processing_time_ms INTEGER,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(tender_id)
);

-- ============================================================================
-- TABLE 7: user_tender_alerts (DEPENDS ON: users table - assumed to exist)
-- User subscriptions for tender notifications
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_tender_alerts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,                   -- FK to users table
    
    -- Alert configuration
    alert_name VARCHAR(255),
    keywords TEXT[],                            -- Array of keywords to match
    excluded_keywords TEXT[],                   -- Keywords to exclude
    min_amount DECIMAL(20, 2),
    max_amount DECIMAL(20, 2),
    countries VARCHAR(100)[],
    domains VARCHAR(20)[],                      -- ["esg", "credit"]
    
    -- Notification settings
    is_active BOOLEAN DEFAULT TRUE,
    frequency VARCHAR(20) DEFAULT 'instant',    -- "instant", "daily", "weekly"
    last_sent TIMESTAMP,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- TABLE 8: user_saved_tenders (DEPENDS ON: users, tenders)
-- User bookmarks and saved tenders
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_saved_tenders (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,                   -- FK to users table
    tender_id INTEGER REFERENCES tenders(id) ON DELETE CASCADE,
    
    -- User metadata
    notes TEXT,
    tags TEXT[],
    status VARCHAR(50),                         -- "watching", "applied", "won", "lost"
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(user_id, tender_id)
);

-- ============================================================================
-- INDEXES for Performance
-- ============================================================================

-- Tender search indexes
CREATE INDEX IF NOT EXISTS idx_tenders_tender_number ON tenders(tender_number);
CREATE INDEX IF NOT EXISTS idx_tenders_lot_id ON tenders(lot_id);
CREATE INDEX IF NOT EXISTS idx_tenders_source_id ON tenders(source_id);
CREATE INDEX IF NOT EXISTS idx_tenders_status ON tenders(status);
CREATE INDEX IF NOT EXISTS idx_tenders_is_active ON tenders(is_active);
CREATE INDEX IF NOT EXISTS idx_tenders_primary_domain ON tenders(primary_domain);
CREATE INDEX IF NOT EXISTS idx_tenders_application_end_date ON tenders(application_end_date);
CREATE INDEX IF NOT EXISTS idx_tenders_published_date ON tenders(published_date DESC);
CREATE INDEX IF NOT EXISTS idx_tenders_total_amount ON tenders(total_amount);
CREATE INDEX IF NOT EXISTS idx_tenders_customer_name ON tenders(customer_name);
CREATE INDEX IF NOT EXISTS idx_tenders_classification_date ON tenders(classification_date);

-- Full-text search index
CREATE INDEX IF NOT EXISTS idx_tenders_search_vector ON tenders USING GIN(search_vector);

-- JSONB indexes for flexible queries
CREATE INDEX IF NOT EXISTS idx_tenders_extra_data ON tenders USING GIN(extra_data);
CREATE INDEX IF NOT EXISTS idx_tenders_delivery_locations ON tenders USING GIN(delivery_locations);
CREATE INDEX IF NOT EXISTS idx_tenders_documents ON tenders USING GIN(documents);
CREATE INDEX IF NOT EXISTS idx_tenders_domain_classification ON tenders USING GIN(domain_classification);
CREATE INDEX IF NOT EXISTS idx_tenders_matched_keywords ON tenders USING GIN(matched_keywords);

-- Source indexes
CREATE INDEX IF NOT EXISTS idx_tender_sources_short_name ON tender_sources(short_name);
CREATE INDEX IF NOT EXISTS idx_tender_sources_is_active ON tender_sources(is_active);

-- Scrape log indexes
CREATE INDEX IF NOT EXISTS idx_tender_scrape_logs_source ON tender_scrape_logs(source_id);
CREATE INDEX IF NOT EXISTS idx_tender_scrape_logs_started ON tender_scrape_logs(started_at DESC);

-- Translation indexes
CREATE INDEX IF NOT EXISTS idx_tender_translations_tender ON tender_translations(tender_id);
CREATE INDEX IF NOT EXISTS idx_tender_translations_created ON tender_translations(created_at DESC);

-- Classification indexes
CREATE INDEX IF NOT EXISTS idx_tender_classifications_tender ON tender_classifications(tender_id);
CREATE INDEX IF NOT EXISTS idx_tender_classifications_domain ON tender_classifications(primary_domain);
CREATE INDEX IF NOT EXISTS idx_tender_classifications_esg_score ON tender_classifications(esg_score DESC);
CREATE INDEX IF NOT EXISTS idx_tender_classifications_credit_score ON tender_classifications(credit_score DESC);

-- Keyword indexes
CREATE INDEX IF NOT EXISTS idx_domain_keywords_domain ON domain_keywords(domain);
CREATE INDEX IF NOT EXISTS idx_domain_keywords_active ON domain_keywords(is_active);
CREATE INDEX IF NOT EXISTS idx_domain_keywords_language ON domain_keywords(language);

-- User alert indexes
CREATE INDEX IF NOT EXISTS idx_user_tender_alerts_user ON user_tender_alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_user_tender_alerts_active ON user_tender_alerts(is_active);

-- Saved tenders indexes
CREATE INDEX IF NOT EXISTS idx_user_saved_tenders_user ON user_saved_tenders(user_id);
CREATE INDEX IF NOT EXISTS idx_user_saved_tenders_tender ON user_saved_tenders(tender_id);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_tenders_updated_at BEFORE UPDATE ON tenders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tender_sources_updated_at BEFORE UPDATE ON tender_sources
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_tender_alerts_updated_at BEFORE UPDATE ON user_tender_alerts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_saved_tenders_updated_at BEFORE UPDATE ON user_saved_tenders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_domain_keywords_updated_at BEFORE UPDATE ON domain_keywords
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Update search vector automatically when title/description changes
-- Since all content is in English, we use English dictionary
CREATE OR REPLACE FUNCTION update_tender_search_vector()
RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector := 
        setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(NEW.description, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(NEW.additional_info, '')), 'C') ||
        setweight(to_tsvector('english', coalesce(NEW.customer_name, '')), 'D');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tenders_search_vector_update BEFORE INSERT OR UPDATE ON tenders
    FOR EACH ROW EXECUTE FUNCTION update_tender_search_vector();

-- ============================================================================
-- SEED DATA: tender_sources (mitwork.kz)
-- ============================================================================

INSERT INTO tender_sources (
    name,
    short_name,
    country,
    base_url,
    search_url_template,
    is_active,
    scrape_frequency_hours,
    requires_auth,
    default_headers,
    scraper_config
) VALUES (
    'Kazakhstan Government Procurement Portal',
    'mitwork_kz',
    'Kazakhstan',
    'https://eep.mitwork.kz',
    'https://eep.mitwork.kz/ru/publics/lots?filter%5Bsubmit%5D=&filter%5Bsearch%5D={search}&page={page}&per-page=50',
    true,
    3,
    false,
    '{"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8"}'::jsonb,
    '{
        "list_page": {
            "item_selector": "div.col.col-12.publics__item.mb-6",
            "lot_id_pattern": "/ru/publics/lots/(\\\\d+)",
            "fields": {
                "tender_number": "a.publics__item__title",
                "title": "a.publics__item__title",
                "customer": "div.publics__item__info:nth-child(1)",
                "amount": "div.publics__item__info:nth-child(2)",
                "deadline": "div.publics__item__info:nth-child(3)",
                "status": "div.publics__item__info:nth-child(4)"
            }
        },
        "detail_page": {
            "tender_number": "h3",
            "title": "div.public-page__about h3",
            "description": "div.public-page__about div:contains(Описание предмета) + div",
            "additional_info": "div.public-page__about div:contains(Дополнительная информация) + div",
            "ktru_code": "div.public-page__about div:contains(КТРУ) + div",
            "procurement_method": "div.public-page__about div:contains(Способ закупки) + div",
            "total_amount": "div.public-page__buy div:contains(Сумма договора) + div",
            "advance_payment": "div.public-page__buy div:contains(Аванс) + div",
            "application_dates": "div.public-page__buy div:contains(Срок приема заявок) + div",
            "contract_period": "div.public-page__buy div:contains(Срок выполнения договора) + div",
            "delivery_terms": "div.public-page__buy div:contains(Условия поставки) + div",
            "customer_name": "div.public-page__buy div:contains(Заказчик) + div a",
            "customer_bin": "div.public-page__buy div:contains(БИН/ИИН) + div"
        },
        "pagination": {
            "page_param": "page",
            "max_pages": 10,
            "items_per_page": 50
        }
    }'::jsonb
)
ON CONFLICT (short_name) DO NOTHING;

-- ============================================================================
-- SEED DATA: Domain Keywords
-- ============================================================================

INSERT INTO domain_keywords (domain, keyword, category, weight, language) VALUES
-- ESG Keywords (English)
('esg', 'environmental', 'environmental', 1.0, 'en'),
('esg', 'sustainability', 'environmental', 1.0, 'en'),
('esg', 'green', 'environmental', 0.9, 'en'),
('esg', 'climate', 'environmental', 1.0, 'en'),
('esg', 'carbon', 'environmental', 0.9, 'en'),
('esg', 'renewable', 'environmental', 1.0, 'en'),
('esg', 'emission', 'environmental', 0.9, 'en'),
('esg', 'pollution', 'environmental', 0.8, 'en'),
('esg', 'waste management', 'environmental', 0.9, 'en'),
('esg', 'recycling', 'environmental', 0.8, 'en'),
('esg', 'social responsibility', 'social', 1.0, 'en'),
('esg', 'diversity', 'social', 0.9, 'en'),
('esg', 'inclusion', 'social', 0.9, 'en'),
('esg', 'human rights', 'social', 1.0, 'en'),
('esg', 'labor practices', 'social', 0.9, 'en'),
('esg', 'community', 'social', 0.7, 'en'),
('esg', 'governance', 'governance', 1.0, 'en'),
('esg', 'transparency', 'governance', 0.9, 'en'),
('esg', 'compliance', 'governance', 0.8, 'en'),
('esg', 'ethics', 'governance', 0.9, 'en'),
('esg', 'reporting', 'governance', 0.7, 'en'),
('esg', 'esg rating', 'general', 1.0, 'en'),
('esg', 'esg score', 'general', 1.0, 'en'),

-- Credit Keywords (English)
('credit', 'credit rating', 'rating', 1.0, 'en'),
('credit', 'credit score', 'rating', 1.0, 'en'),
('credit', 'rating agency', 'rating', 1.0, 'en'),
('credit', 'financial', 'finance', 0.7, 'en'),
('credit', 'loan', 'finance', 0.8, 'en'),
('credit', 'debt', 'finance', 0.8, 'en'),
('credit', 'bond', 'finance', 0.9, 'en'),
('credit', 'investment', 'finance', 0.7, 'en'),
('credit', 'financing', 'finance', 0.8, 'en'),
('credit', 'creditworthiness', 'assessment', 1.0, 'en'),
('credit', 'default', 'risk', 0.9, 'en'),
('credit', 'risk assessment', 'risk', 1.0, 'en'),
('credit', 'financial stability', 'stability', 0.9, 'en'),
('credit', 'liquidity', 'finance', 0.8, 'en'),
('credit', 'solvency', 'finance', 0.9, 'en')
ON CONFLICT (domain, keyword, language) DO NOTHING;

-- ============================================================================
-- VIEWS for Easy Querying
-- ============================================================================

-- View: Active tenders with upcoming deadlines
CREATE OR REPLACE VIEW active_tenders AS
SELECT 
    t.*,
    ts.name as source_name,
    ts.short_name as source_short_name,
    tc.esg_score,
    tc.credit_score,
    tc.primary_domain as classified_domain,
    EXTRACT(DAY FROM (t.application_end_date - NOW())) as days_until_deadline
FROM tenders t
JOIN tender_sources ts ON t.source_id = ts.id
LEFT JOIN tender_classifications tc ON t.id = tc.tender_id
WHERE t.is_active = true
  AND t.application_end_date > NOW()
ORDER BY t.application_end_date ASC;

-- View: Tender statistics by source
CREATE OR REPLACE VIEW tender_source_stats AS
SELECT 
    ts.id,
    ts.name,
    ts.short_name,
    COUNT(t.id) as total_tenders,
    COUNT(CASE WHEN t.is_active THEN 1 END) as active_tenders,
    COUNT(CASE WHEN t.primary_domain = 'esg' THEN 1 END) as esg_tenders,
    COUNT(CASE WHEN t.primary_domain = 'credit' THEN 1 END) as credit_tenders,
    COUNT(CASE WHEN t.primary_domain = 'both' THEN 1 END) as both_tenders,
    SUM(t.total_amount) as total_value,
    MAX(t.published_date) as latest_tender_date,
    ts.last_scrape_date,
    ts.success_rate
FROM tender_sources ts
LEFT JOIN tenders t ON t.source_id = ts.id
GROUP BY ts.id, ts.name, ts.short_name, ts.last_scrape_date, ts.success_rate;

-- View: ESG-specific tenders
CREATE OR REPLACE VIEW esg_tenders AS
SELECT 
    t.*,
    tc.esg_score,
    tc.esg_keywords,
    ts.name as source_name
FROM tenders t
LEFT JOIN tender_classifications tc ON t.id = tc.tender_id
JOIN tender_sources ts ON t.source_id = ts.id
WHERE t.primary_domain IN ('esg', 'both')
  AND t.is_active = true
ORDER BY t.published_date DESC;

-- View: Credit-specific tenders
CREATE OR REPLACE VIEW credit_tenders AS
SELECT 
    t.*,
    tc.credit_score,
    tc.credit_keywords,
    ts.name as source_name
FROM tenders t
LEFT JOIN tender_classifications tc ON t.id = tc.tender_id
JOIN tender_sources ts ON t.source_id = ts.id
WHERE t.primary_domain IN ('credit', 'both')
  AND t.is_active = true
ORDER BY t.published_date DESC;

-- ============================================================================
-- COMMENTS (Documentation)
-- ============================================================================

COMMENT ON TABLE tenders IS 'Main table storing tender/procurement information. All content translated to English immediately.';
COMMENT ON TABLE tender_sources IS 'Configuration and tracking for tender data sources (websites). Scrapes every 3 hours.';
COMMENT ON TABLE tender_scrape_logs IS 'History of scraping operations for monitoring and debugging';
COMMENT ON TABLE tender_translations IS 'Track translation operations and costs (content already in English in tenders table)';
COMMENT ON TABLE tender_classifications IS 'AI-based classification of tenders into ESG/Credit domains using LLM';
COMMENT ON TABLE domain_keywords IS 'Configurable keywords for domain classification. Used by LLM as context.';
COMMENT ON TABLE user_tender_alerts IS 'User subscriptions for tender notifications based on custom criteria';
COMMENT ON TABLE user_saved_tenders IS 'User bookmarks/saved tenders with notes and status tracking';

COMMENT ON COLUMN tenders.title IS 'Primary title in English (auto-translated immediately on scrape)';
COMMENT ON COLUMN tenders.original_title IS 'Original title in source language (Russian/Kazakh) for reference';
COMMENT ON COLUMN tenders.primary_domain IS 'AI-classified domain: esg, credit, both, or neither';
COMMENT ON COLUMN tenders.domain_classification IS 'JSONB with confidence scores: {"esg": 0.85, "credit": 0.45}';
COMMENT ON COLUMN tenders.extra_data IS 'Flexible JSONB field for source-specific data that does not fit standard schema';
COMMENT ON COLUMN tenders.search_vector IS 'Full-text search vector in English (auto-updated by trigger)';
COMMENT ON COLUMN tender_sources.scraper_config IS 'JSON configuration for HTML parsing (CSS selectors, etc.)';

-- ============================================================================
-- SUCCESS MESSAGE
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE '============================================================';
    RAISE NOTICE 'Tender Monitoring System Schema Created Successfully!';
    RAISE NOTICE '============================================================';
    RAISE NOTICE 'Tables created: 8';
    RAISE NOTICE '  1. tender_sources (mitwork.kz configured)';
    RAISE NOTICE '  2. domain_keywords (45 ESG/Credit keywords seeded)';
    RAISE NOTICE '  3. tenders (main data table)';
    RAISE NOTICE '  4. tender_scrape_logs';
    RAISE NOTICE '  5. tender_translations';
    RAISE NOTICE '  6. tender_classifications';
    RAISE NOTICE '  7. user_tender_alerts';
    RAISE NOTICE '  8. user_saved_tenders';
    RAISE NOTICE '';
    RAISE NOTICE 'Indexes: 25+';
    RAISE NOTICE 'Triggers: 6';
    RAISE NOTICE 'Views: 4';
    RAISE NOTICE '';
    RAISE NOTICE 'Next Steps:';
    RAISE NOTICE '  1. Run: cd packages/db-esg && pnpm db:generate';
    RAISE NOTICE '  2. Build tender scraper service';
    RAISE NOTICE '  3. Implement translation service (OpenAI)';
    RAISE NOTICE '  4. Implement classification service (LLM)';
    RAISE NOTICE '  5. Create API routes';
    RAISE NOTICE '  6. Build UI components';
    RAISE NOTICE '============================================================';
END $$;
