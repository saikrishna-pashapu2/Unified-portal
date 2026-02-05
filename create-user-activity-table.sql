-- Migration to create user_activity table
-- Run this on your EC2 production database to fix the 500 errors

-- Create user_activity table in your ESG database
CREATE TABLE IF NOT EXISTS user_activity (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50),
    resource_id INTEGER,
    details TEXT,
    ip_address VARCHAR(45),
    user_agent TEXT,
    timestamp TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_user_activity_user FOREIGN KEY (user_id) 
        REFERENCES users(id) 
        ON DELETE CASCADE 
        ON UPDATE NO ACTION
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_user_activity_action ON user_activity(action);
CREATE INDEX IF NOT EXISTS idx_user_activity_resource ON user_activity(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_user_activity_timestamp ON user_activity(timestamp);
CREATE INDEX IF NOT EXISTS idx_user_activity_user_id ON user_activity(user_id);

-- Verify table was created
SELECT 'user_activity table created successfully!' AS status;
