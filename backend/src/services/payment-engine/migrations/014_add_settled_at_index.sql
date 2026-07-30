-- =============================================================================
-- Add index on settled_at
-- Speeds up reporting queries that filter payment_sessions by settlement date
-- (e.g. "successful payments in the last N months").
-- =============================================================================

ALTER TABLE payment_sessions ADD INDEX idx_settled_at (settled_at);
