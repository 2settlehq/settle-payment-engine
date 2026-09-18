-- Settlement Provider Balances Migration
-- Run: mysql -u root -p 2settle < src/services/payment-engine/settlement/migrations/002_create_provider_balances.sql
--
-- Tracks each settlement provider's spendable balance in our own ledger so the
-- router can pick the provider with the most balance to cover a payout,
-- reserving funds atomically instead of trusting a live (and racy) provider
-- balance check. Rows start at zero — credit them via the admin
-- settlement-providers endpoint after funding the corresponding account.

CREATE TABLE IF NOT EXISTS settlement_provider_balances (
  id INT AUTO_INCREMENT PRIMARY KEY,
  provider VARCHAR(50) NOT NULL,
  currency VARCHAR(10) NOT NULL,
  balance DECIMAL(18,2) NOT NULL DEFAULT 0,
  reserved DECIMAL(18,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uk_settlement_provider_currency (provider, currency)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO settlement_provider_balances (provider, currency, balance, reserved)
VALUES ('mongoro', 'NGN', 0, 0);
