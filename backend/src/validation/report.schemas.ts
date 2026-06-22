import { z } from 'zod';

// =============================================================================
// CONSTANTS
// =============================================================================

const COMPLAINT_TYPES = ['track_transaction', 'stolen_funds', 'fraud'] as const;
const REPORT_STATUSES = ['pending', 'processing', 'resolved', 'dismissed'] as const;

// =============================================================================
// CREATE REPORT (POST /v1/reports — authenticated)
// =============================================================================

export const createReportSchema = z.object({
  sessionReference: z.string().max(12).optional(),
  complaintType: z.enum(COMPLAINT_TYPES),
  name: z.string().min(1, 'Name is required').max(255),
  phoneNumber: z.string().max(20).optional(),
  walletAddress: z.string().max(100).optional(),
  fraudsterWalletAddress: z.string().max(100).optional(),
  description: z.string().max(5000).optional(),
}).refine(
  (data) => data.phoneNumber || data.walletAddress,
  { message: 'At least one of phoneNumber or walletAddress must be provided' }
);

// =============================================================================
// LOOKUP REPORTS (GET /v1/reports/lookup — public)
// =============================================================================

export const lookupReportsSchema = z.object({
  phoneNumber: z.string().optional(),
  walletAddress: z.string().optional(),
  status: z.enum(REPORT_STATUSES).optional(),
  complaintType: z.enum(COMPLAINT_TYPES).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
}).refine(
  (data) => data.phoneNumber || data.walletAddress,
  { message: 'At least one of phoneNumber or walletAddress is required' }
);

// =============================================================================
// ADMIN QUERY REPORTS (GET /v1/admin/reports/complaints)
// =============================================================================

export const adminQueryReportsSchema = z.object({
  status: z.enum(REPORT_STATUSES).optional(),
  complaintType: z.enum(COMPLAINT_TYPES).optional(),
  merchantId: z.string().optional(),
  apiKeyId: z.coerce.number().int().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// =============================================================================
// UPDATE REPORT (PATCH /v1/admin/reports/complaints/:reportId)
// =============================================================================

export const updateReportSchema = z.object({
  status: z.enum(REPORT_STATUSES).optional(),
  confirmer: z.string().max(100).optional(),
  adminNotes: z.string().max(5000).optional(),
}).refine(
  (data) => Object.values(data).some(v => v !== undefined),
  { message: 'At least one field must be provided to update' }
);

// =============================================================================
// REPORT ID PARAM
// =============================================================================

export const reportIdParamSchema = z.object({
  reportId: z.string().regex(/^RPT-\d{5,}$/, 'Invalid report ID format'),
});
