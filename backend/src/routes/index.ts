import { Router } from 'express';
import { extendTimeout } from '../middleware/extendTimeout';
import transferRoutes from './transfer.routes';
import giftRoutes from './gift.routes';
import requestRoutes from './request.routes';
import transactionRoutes from './transaction.routes';
import rateRoutes from './rate.routes';
import bankRoutes from './bank.routes';
import cryptoRoutes from './crypto.routes';
import adminRoutes from './admin';
import paymentRoutes from './payment.routes';
import walletRoutes from './wallet.routes';
import authRoutes from './auth.routes';
import userAuthRoutes from './user-auth.routes';
import userRoutes from './user.routes';
import meRoutes from './me.routes';
import historyRoutes from './history.routes';
import webhookRoutes from './webhook.routes';
import sandboxRoutes from './sandbox.routes';
import reportRoutes from './report.routes';
import { authenticateUser } from '../services/user-auth/middleware/authenticateUser';
import {
  deprecateTransferRoutes,
  deprecateGiftRoutes,
  deprecateRequestRoutes,
  deprecateTransactionRoutes,
} from '../middleware/deprecation';

const router = Router();

// =============================================================================
// NEW UNIFIED ROUTES (preferred)
// =============================================================================
// Payment routes — 30s timeout (creation involves rate fetch + wallet derivation + settlement)
router.use('/payments', extendTimeout('30s'), paymentRoutes);

// =============================================================================
// WALLET-AS-A-SERVICE ROUTES
// =============================================================================
router.use('/wallets', walletRoutes);

// =============================================================================
// LEGACY ROUTES (deprecated - use /payments instead)
// =============================================================================
router.use('/transfer', deprecateTransferRoutes, transferRoutes);
router.use('/gifts', deprecateGiftRoutes, giftRoutes);
router.use('/requests', deprecateRequestRoutes, requestRoutes);
router.use('/transaction', deprecateTransactionRoutes, transactionRoutes);

// =============================================================================
// REPORT ROUTES (complaint/fraud reporting)
// =============================================================================
router.use('/reports', reportRoutes);

// =============================================================================
// OTHER ROUTES
// =============================================================================
router.use('/rate', rateRoutes);
router.use('/banks', bankRoutes);
router.use('/crypto', cryptoRoutes);

// Webhook routes — 30s timeout (provider callbacks may include settlement processing)
router.use('/webhooks', extendTimeout('30s'), webhookRoutes);

// Admin routes (uses separate admin auth, not HMAC)
router.use('/admin', adminRoutes);

// Auth routes (public - login with API key credentials)
router.use('/auth', authRoutes);

// End-user auth routes — 30s timeout (otp/request may call out to an email/SMS provider)
router.use('/users/auth', extendTimeout('30s'), userAuthRoutes);

// End-user profile routes (JWT-authenticated, distinct from merchant /me below)
router.use('/users/me', authenticateUser, userRoutes);

// Me routes (HMAC-authenticated, user-scoped)
router.use('/me', meRoutes);

// Unified transaction history (legacy + payment engine)
router.use('/history', historyRoutes);

// Sandbox routes — only usable by pk_test_ API keys
router.use('/sandbox', sandboxRoutes);

export default router;
