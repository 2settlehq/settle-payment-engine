-- =============================================================================
-- Migration 016: Add description to payment_sessions
-- Free-text note supplied at payment creation. Returned in API responses,
-- webhooks and history, and appended to the payout bank narration.
-- =============================================================================

ALTER TABLE payment_sessions ADD COLUMN description VARCHAR(255) NULL;
