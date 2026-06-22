-- =============================================================================
-- Reportly: Fraud / Complaint Reports Table
-- =============================================================================

CREATE TABLE IF NOT EXISTS reports (
  id                        INT AUTO_INCREMENT PRIMARY KEY,
  report_id                 VARCHAR(20) NOT NULL UNIQUE,

  -- Which merchant/client submitted this report
  api_key_id                INT NOT NULL,
  merchant_id               VARCHAR(50) NOT NULL,

  -- Optional linkage to a payment session
  session_reference         VARCHAR(12) NULL,

  -- Report content
  complaint_type            ENUM('track_transaction', 'stolen_funds', 'fraud') NOT NULL,
  name                      VARCHAR(255) NOT NULL,
  phone_number              VARCHAR(20) NULL,
  wallet_address            VARCHAR(100) NULL,
  fraudster_wallet_address  VARCHAR(100) NULL,
  description               TEXT NULL,

  -- Status lifecycle
  status                    ENUM('pending', 'processing', 'resolved', 'dismissed')
                              NOT NULL DEFAULT 'pending',
  confirmer                 VARCHAR(100) NULL,
  admin_notes               TEXT NULL,

  -- Timestamps
  created_at                TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at                TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  -- Indexes for user-facing lookups (public endpoint)
  INDEX idx_phone_number (phone_number),
  INDEX idx_wallet_address (wallet_address),

  -- Indexes for admin/internal queries
  INDEX idx_api_key_id (api_key_id),
  INDEX idx_merchant_id (merchant_id),
  INDEX idx_session_reference (session_reference),
  INDEX idx_status (status),
  INDEX idx_complaint_type (complaint_type),
  INDEX idx_created_at (created_at),

  -- Foreign key
  FOREIGN KEY (api_key_id) REFERENCES api_keys(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
