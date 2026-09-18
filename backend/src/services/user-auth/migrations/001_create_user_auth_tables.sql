-- =============================================================================
-- End-User Auth Tables (phone / email / wallet / Google login)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Users Table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id              VARCHAR(36) NOT NULL PRIMARY KEY,
  display_name    VARCHAR(255) NULL,
  avatar_url      VARCHAR(500) NULL,
  status          ENUM('active', 'suspended') NOT NULL DEFAULT 'active',
  last_login_at   TIMESTAMP NULL,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- -----------------------------------------------------------------------------
-- User Identities Table (one row per login method linked to a user)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_identities (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  user_id         VARCHAR(36) NOT NULL,
  type            ENUM('email', 'phone', 'wallet', 'google') NOT NULL,
  identifier      VARCHAR(255) NOT NULL,
  verified_at     TIMESTAMP NULL,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY uk_type_identifier (type, identifier),
  INDEX idx_user_id (user_id),
  CONSTRAINT fk_user_identities_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- -----------------------------------------------------------------------------
-- OTP Codes Table (phone/email passwordless login)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_otp_codes (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  channel         ENUM('email', 'phone') NOT NULL,
  identifier      VARCHAR(255) NOT NULL,
  code_hash       VARCHAR(64) NOT NULL,
  purpose         VARCHAR(30) NOT NULL DEFAULT 'login',
  attempts        INT NOT NULL DEFAULT 0,
  consumed_at     TIMESTAMP NULL,
  expires_at      TIMESTAMP NOT NULL,
  ip_address      VARCHAR(45) NULL,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_channel_identifier (channel, identifier),
  INDEX idx_expires_at (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- -----------------------------------------------------------------------------
-- Wallet Sign-In Nonces (SIWE-style login)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_wallet_nonces (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  wallet_address  VARCHAR(100) NOT NULL,
  nonce           VARCHAR(64) NOT NULL,
  message         TEXT NOT NULL,
  consumed_at     TIMESTAMP NULL,
  expires_at      TIMESTAMP NOT NULL,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_wallet_address (wallet_address)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- -----------------------------------------------------------------------------
-- Refresh Tokens Table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_refresh_tokens (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  user_id         VARCHAR(36) NOT NULL,
  token_hash      VARCHAR(64) NOT NULL,
  user_agent      VARCHAR(255) NULL,
  ip_address      VARCHAR(45) NULL,
  revoked_at      TIMESTAMP NULL,
  expires_at      TIMESTAMP NOT NULL,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY uk_token_hash (token_hash),
  INDEX idx_user_id (user_id),
  CONSTRAINT fk_user_refresh_tokens_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
