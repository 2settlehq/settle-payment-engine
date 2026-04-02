-- Migration 008: Add paystack to settlement_mode ENUM and change default to paystack
--
-- Previously: ENUM('mongoro', 'self') DEFAULT 'self'
-- Now:        ENUM('mongoro', 'paystack', 'self') DEFAULT 'paystack'

ALTER TABLE api_keys
  MODIFY COLUMN settlement_mode ENUM('mongoro', 'paystack', 'self') NOT NULL DEFAULT 'paystack';
