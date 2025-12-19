-- Create company research tables
-- Run this SQL directly on your database or use: npx prisma db push

-- Company Research Sessions table
CREATE TABLE IF NOT EXISTS company_research_sessions (
    id SERIAL PRIMARY KEY,
    session_id VARCHAR(255) NOT NULL UNIQUE,
    user_id INTEGER NOT NULL,
    company_name VARCHAR(500) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'in_progress',
    total_tokens_used INTEGER NOT NULL DEFAULT 0,
    total_cost_usd DECIMAL(10, 4) NOT NULL DEFAULT 0,
    research_summary TEXT,
    final_report JSON,
    error_message TEXT,
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ(6),
    CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Indexes for company_research_sessions
CREATE INDEX IF NOT EXISTS idx_company_research_sessions_user_created 
    ON company_research_sessions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_company_research_sessions_session 
    ON company_research_sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_company_research_sessions_status 
    ON company_research_sessions(status);

-- Research Findings table
CREATE TABLE IF NOT EXISTS research_findings (
    id SERIAL PRIMARY KEY,
    session_id VARCHAR(255) NOT NULL,
    finding_type VARCHAR(100) NOT NULL,
    title VARCHAR(500) NOT NULL,
    content TEXT NOT NULL,
    source_url VARCHAR(1000),
    source_name VARCHAR(255),
    confidence_score DECIMAL(3, 2) DEFAULT 0.5,
    metadata JSON,
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_session FOREIGN KEY (session_id) REFERENCES company_research_sessions(session_id) ON DELETE CASCADE
);

-- Indexes for research_findings
CREATE INDEX IF NOT EXISTS idx_research_findings_session_type 
    ON research_findings(session_id, finding_type);
CREATE INDEX IF NOT EXISTS idx_research_findings_type 
    ON research_findings(finding_type);

-- Company Contacts table
CREATE TABLE IF NOT EXISTS company_contacts (
    id SERIAL PRIMARY KEY,
    session_id VARCHAR(255) NOT NULL,
    company_name VARCHAR(500) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    job_title VARCHAR(255),
    department VARCHAR(255),
    email VARCHAR(255),
    phone VARCHAR(100),
    linkedin_url VARCHAR(1000),
    source_url VARCHAR(1000),
    relevance_score DECIMAL(3, 2) DEFAULT 0.5,
    metadata JSON,
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_contact_session FOREIGN KEY (session_id) REFERENCES company_research_sessions(session_id) ON DELETE CASCADE
);

-- Indexes for company_contacts
CREATE INDEX IF NOT EXISTS idx_company_contacts_session 
    ON company_contacts(session_id);
CREATE INDEX IF NOT EXISTS idx_company_contacts_company_name 
    ON company_contacts(company_name);
CREATE INDEX IF NOT EXISTS idx_company_contacts_department 
    ON company_contacts(department);

-- Success message
SELECT 'Company research tables created successfully!' as message;
