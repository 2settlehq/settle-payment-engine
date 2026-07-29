/**
 * Report Service
 *
 * Handles CRUD operations for fraud/complaint reports.
 */

import pool from '../../lib/mysql';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import {
  Report,
  CreateReportInput,
  UpdateReportInput,
  ReportFilters,
  UserReportFilters,
  AdminReportFilters,
} from './report.types';

// =============================================================================
// ROW TYPE
// =============================================================================

interface ReportRow extends RowDataPacket {
  id: number;
  report_id: string;
  api_key_id: number;
  merchant_id: string;
  session_reference: string | null;
  complaint_type: 'track_transaction' | 'stolen_funds' | 'fraud';
  name: string;
  phone_number: string | null;
  wallet_address: string | null;
  fraudster_wallet_address: string | null;
  description: string | null;
  status: 'pending' | 'processing' | 'resolved' | 'dismissed';
  confirmer: string | null;
  admin_notes: string | null;
  created_at: Date;
  updated_at: Date;
}

// =============================================================================
// HELPERS
// =============================================================================

function rowToReport(row: ReportRow): Report {
  return {
    id: row.id,
    reportId: row.report_id,
    apiKeyId: row.api_key_id,
    merchantId: row.merchant_id,
    sessionReference: row.session_reference,
    complaintType: row.complaint_type,
    name: row.name,
    phoneNumber: row.phone_number,
    walletAddress: row.wallet_address,
    fraudsterWalletAddress: row.fraudster_wallet_address,
    description: row.description,
    status: row.status,
    confirmer: row.confirmer,
    adminNotes: row.admin_notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Same alphabet as payment references (id-generator.ts) — excludes ambiguous
// characters (I, L, O, 0, 1) so IDs stay easy to read/type over phone or chat.
const REPORT_ID_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generateReportId(): string {
  let randomPart = '';
  for (let i = 0; i < 6; i++) {
    randomPart += REPORT_ID_CHARS[Math.floor(Math.random() * REPORT_ID_CHARS.length)];
  }
  return `RPT-${randomPart}`;
}

async function reportIdExists(reportId: string): Promise<boolean> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT 1 FROM reports WHERE report_id = ? LIMIT 1`,
    [reportId]
  );
  return rows.length > 0;
}

// =============================================================================
// CREATE
// =============================================================================

/**
 * Create a new complaint report.
 * Generates a random report_id up front, retrying on the rare collision.
 */
export async function createReport(input: CreateReportInput): Promise<Report> {
  let reportId = generateReportId();
  let attempts = 0;
  const maxAttempts = 5;

  while (await reportIdExists(reportId)) {
    attempts++;
    if (attempts >= maxAttempts) {
      throw new Error('Failed to generate unique report ID after multiple attempts');
    }
    reportId = generateReportId();
  }

  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO reports
      (report_id, api_key_id, merchant_id, session_reference,
       complaint_type, name, phone_number, wallet_address,
       fraudster_wallet_address, description, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    [
      reportId,
      input.apiKeyId,
      input.merchantId,
      input.sessionReference ?? null,
      input.complaintType,
      input.name,
      input.phoneNumber ?? null,
      input.walletAddress ?? null,
      input.fraudsterWalletAddress ?? null,
      input.description ?? null,
    ]
  );

  const [rows] = await pool.execute<ReportRow[]>(
    `SELECT * FROM reports WHERE id = ?`,
    [result.insertId]
  );

  return rowToReport(rows[0]);
}

// =============================================================================
// READ — Single
// =============================================================================

/**
 * Fetch a single report by its human-readable report_id (RPT-XXXXXX).
 */
export async function getReportByReportId(reportId: string): Promise<Report | null> {
  const [rows] = await pool.execute<ReportRow[]>(
    `SELECT * FROM reports WHERE report_id = ?`,
    [reportId]
  );

  if (!rows.length) return null;
  return rowToReport(rows[0]);
}

// =============================================================================
// READ — User lookup (public)
// =============================================================================

/**
 * Look up reports by end-user identity (phone and/or wallet address).
 * This powers the public lookup endpoint.
 */
export async function getReportsByUser(
  filters: UserReportFilters
): Promise<{ reports: Report[]; total: number }> {
  const { phoneNumber, walletAddress, status, complaintType, limit, offset } = filters;

  const conditions: string[] = [];
  const values: unknown[] = [];

  // At least one of phone or wallet must be provided (enforced by validation)
  if (phoneNumber && walletAddress) {
    conditions.push('(phone_number = ? OR wallet_address = ?)');
    values.push(phoneNumber, walletAddress);
  } else if (phoneNumber) {
    conditions.push('phone_number = ?');
    values.push(phoneNumber);
  } else if (walletAddress) {
    conditions.push('wallet_address = ?');
    values.push(walletAddress);
  }

  if (status) { conditions.push('status = ?'); values.push(status); }
  if (complaintType) { conditions.push('complaint_type = ?'); values.push(complaintType); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [rows] = await pool.query<ReportRow[]>(
    `SELECT * FROM reports ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...values, limit, offset]
  );
  const [countRows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM reports ${where}`,
    values
  );

  return {
    reports: rows.map(rowToReport),
    total: (countRows[0] as { total: number }).total,
  };
}

// =============================================================================
// READ — Admin (all reports)
// =============================================================================

/**
 * List all reports with admin-level filters.
 */
export async function getAllReports(
  filters: AdminReportFilters
): Promise<{ reports: Report[]; total: number }> {
  const { status, complaintType, merchantId, apiKeyId, from, to, search, limit, offset } = filters;

  const conditions: string[] = [];
  const values: unknown[] = [];

  if (status) { conditions.push('status = ?'); values.push(status); }
  if (complaintType) { conditions.push('complaint_type = ?'); values.push(complaintType); }
  if (merchantId) { conditions.push('merchant_id = ?'); values.push(merchantId); }
  if (apiKeyId) { conditions.push('api_key_id = ?'); values.push(apiKeyId); }
  if (from) { conditions.push('created_at >= ?'); values.push(new Date(from)); }
  if (to) { conditions.push('created_at <= ?'); values.push(new Date(to)); }
  if (search) {
    conditions.push('(report_id LIKE ? OR name LIKE ? OR wallet_address LIKE ? OR phone_number LIKE ?)');
    const searchTerm = `%${search}%`;
    values.push(searchTerm, searchTerm, searchTerm, searchTerm);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [rows] = await pool.query<ReportRow[]>(
    `SELECT * FROM reports ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...values, limit, offset]
  );
  const [countRows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM reports ${where}`,
    values
  );

  return {
    reports: rows.map(rowToReport),
    total: (countRows[0] as { total: number }).total,
  };
}

// =============================================================================
// UPDATE — Admin
// =============================================================================

/**
 * Update a report's status, confirmer, or admin notes.
 */
export async function updateReport(
  reportId: string,
  updates: UpdateReportInput
): Promise<Report | null> {
  const setClauses: string[] = [];
  const values: unknown[] = [];

  if (updates.status !== undefined) {
    setClauses.push('status = ?');
    values.push(updates.status);
  }
  if (updates.confirmer !== undefined) {
    setClauses.push('confirmer = ?');
    values.push(updates.confirmer);
  }
  if (updates.adminNotes !== undefined) {
    setClauses.push('admin_notes = ?');
    values.push(updates.adminNotes);
  }

  if (!setClauses.length) return getReportByReportId(reportId);

  values.push(reportId);

  await pool.query(
    `UPDATE reports SET ${setClauses.join(', ')} WHERE report_id = ?`,
    values
  );

  return getReportByReportId(reportId);
}
