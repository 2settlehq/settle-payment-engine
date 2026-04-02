-- Migration 005: Add paystack_code column to banks table
-- Paystack uses different bank codes from CBN codes (e.g. Moniepoint: CBN=090405, Paystack=50515)
-- Populated by: npx ts-node scripts/sync-paystack-banks.ts

ALTER TABLE banks
  ADD COLUMN paystack_code VARCHAR(20) NULL AFTER code;
