/**
 * Token Service
 * Issues/verifies short-lived JWT access tokens and rotates opaque refresh
 * tokens (only the sha256 hash of a refresh token is ever persisted - same
 * "never store the raw secret" convention as API key secrets).
 */

import jwt from 'jsonwebtoken';
import pool from '../../../lib/mysql';
import { RowDataPacket } from 'mysql2';
import { generateSecureToken, sha256 } from '../../../security/utils/crypto';
import config from '../../../config';
import { AuthTokens, JwtPayload } from '../types';
import { InvalidRefreshTokenError } from '../errors';

interface RefreshTokenRow extends RowDataPacket {
  id: number;
  user_id: string;
  revoked_at: Date | null;
  expires_at: Date;
}

function signAccessToken(userId: string): string {
  if (!config.auth.jwt.accessSecret) {
    throw new Error('JWT_ACCESS_SECRET is not configured');
  }
  return jwt.sign({ sub: userId }, config.auth.jwt.accessSecret, {
    expiresIn: config.auth.jwt.accessExpiresInSec,
  });
}

export function verifyAccessToken(token: string): JwtPayload {
  return jwt.verify(token, config.auth.jwt.accessSecret) as JwtPayload;
}

async function issueRefreshToken(
  userId: string,
  userAgent?: string,
  ipAddress?: string
): Promise<string> {
  const token = generateSecureToken(32);
  const expiresAt = new Date(
    Date.now() + config.auth.jwt.refreshExpiresInDays * 24 * 60 * 60 * 1000
  );

  await pool.query(
    `INSERT INTO user_refresh_tokens (user_id, token_hash, user_agent, ip_address, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
    [userId, sha256(token), userAgent || null, ipAddress || null, expiresAt]
  );

  return token;
}

/**
 * Issue a fresh access + refresh token pair for a user (login).
 */
export async function issueTokens(
  userId: string,
  userAgent?: string,
  ipAddress?: string
): Promise<AuthTokens> {
  const [accessToken, refreshToken] = await Promise.all([
    Promise.resolve(signAccessToken(userId)),
    issueRefreshToken(userId, userAgent, ipAddress),
  ]);

  return {
    accessToken,
    refreshToken,
    expiresInSec: config.auth.jwt.accessExpiresInSec,
  };
}

/**
 * Rotate a refresh token: revoke the presented one and issue a new pair.
 * Throws InvalidRefreshTokenError if the token is unknown, revoked, or expired.
 */
export async function rotateRefreshToken(
  refreshToken: string,
  userAgent?: string,
  ipAddress?: string
): Promise<AuthTokens> {
  const tokenHash = sha256(refreshToken);

  const [rows] = await pool.query<RefreshTokenRow[]>(
    `SELECT * FROM user_refresh_tokens WHERE token_hash = ? LIMIT 1`,
    [tokenHash]
  );

  const row = rows[0];
  if (!row || row.revoked_at || row.expires_at.getTime() < Date.now()) {
    throw new InvalidRefreshTokenError();
  }

  await pool.query(`UPDATE user_refresh_tokens SET revoked_at = NOW() WHERE id = ?`, [row.id]);

  return issueTokens(row.user_id, userAgent, ipAddress);
}

/**
 * Revoke a single refresh token (logout on one device).
 */
export async function revokeRefreshToken(refreshToken: string): Promise<void> {
  await pool.query(
    `UPDATE user_refresh_tokens SET revoked_at = NOW() WHERE token_hash = ? AND revoked_at IS NULL`,
    [sha256(refreshToken)]
  );
}

/**
 * Revoke every refresh token for a user (logout on all devices).
 */
export async function revokeAllRefreshTokens(userId: string): Promise<void> {
  await pool.query(
    `UPDATE user_refresh_tokens SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL`,
    [userId]
  );
}
