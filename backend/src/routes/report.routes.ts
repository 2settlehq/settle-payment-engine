/**
 * Report Routes
 *
 * Complaint/fraud reporting endpoints.
 * - POST /          Authenticated (HMAC) — merchant creates a report
 * - GET  /lookup    Public — end user looks up reports by phone/wallet
 * - GET  /:reportId Public — end user looks up a single report
 */

import { Router, Request, Response, NextFunction } from 'express';
import { requirePermission } from '../security/middleware/authenticate';
import {
  createReport,
  getReportByReportId,
  getReportsByUser,
  notifyNewReport,
} from '../services/report';
import {
  createReportSchema,
  lookupReportsSchema,
  reportIdParamSchema,
} from '../validation/report.schemas';

const router = Router();

// =============================================================================
// CREATE REPORT (authenticated)
// =============================================================================

/**
 * POST /v1/reports
 *
 * Merchant submits a complaint report on behalf of their user.
 * Requires 'report:create' permission.
 */
router.post(
  '/',
  requirePermission('report:create'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = createReportSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: parsed.error.flatten(),
        });
      }

      const apiKey = req.apiKey!;
      const report = await createReport({
        apiKeyId: apiKey.id,
        merchantId: apiKey.merchantId,
        ...parsed.data,
      });

      // Fire-and-forget admin notification
      notifyNewReport(report).catch(() => {});

      return res.status(201).json({
        success: true,
        data: { report },
      });
    } catch (err) {
      next(err);
    }
  }
);

// =============================================================================
// LOOKUP REPORTS (public — no auth)
// =============================================================================

/**
 * GET /v1/reports/lookup
 *
 * End user looks up their reports by phone number and/or wallet address.
 * At least one of phoneNumber or walletAddress is required.
 */
router.get('/lookup', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = lookupReportsSchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: parsed.error.flatten(),
      });
    }

    const { reports, total } = await getReportsByUser(parsed.data);

    return res.json({
      success: true,
      data: {
        reports,
        total,
        limit: parsed.data.limit,
        offset: parsed.data.offset,
      },
    });
  } catch (err) {
    next(err);
  }
});

// =============================================================================
// GET SINGLE REPORT (public — no auth)
// =============================================================================

/**
 * GET /v1/reports/:reportId
 *
 * Look up a single report by its RPT-XXXXX ID.
 */
router.get('/:reportId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const paramParsed = reportIdParamSchema.safeParse(req.params);
    if (!paramParsed.success) {
      return res.status(400).json({
        success: false,
        error: 'Invalid report ID format',
        details: paramParsed.error.flatten(),
      });
    }

    const report = await getReportByReportId(paramParsed.data.reportId);
    if (!report) {
      return res.status(404).json({
        success: false,
        error: 'Report not found',
        code: 'NOT_FOUND',
      });
    }

    return res.json({
      success: true,
      data: { report },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
