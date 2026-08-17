-- =============================================================================
-- Add settlement_fee to payment_sessions
-- Persists the payout-provider fee (e.g. Mongoro's `fee` field, in
-- fiat_currency) so per-transaction processing cost can be reconstructed
-- alongside the blockchain network fee already tracked in sweep_transactions.
-- =============================================================================

ALTER TABLE payment_sessions ADD COLUMN settlement_fee DECIMAL(15, 2) NULL AFTER settled_fiat_amount;
