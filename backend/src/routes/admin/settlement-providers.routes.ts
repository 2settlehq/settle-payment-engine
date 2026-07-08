import { Router, Request, Response, NextFunction } from 'express';
import { providerBalanceRepository } from '../../services/payment-engine/settlement/provider-balance.repository';

const router = Router();

// =============================================================================
// LIST PROVIDER BALANCES
// =============================================================================

/**
 * GET /admin/settlement-providers/balances
 *
 * Shows funded, reserved, and spendable balance per provider/currency —
 * the same numbers the settlement router uses to pick a provider.
 */
router.get('/balances', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const balances = await providerBalanceRepository.listAll();
    return res.json({ success: true, balances });
  } catch (err) {
    next(err);
  }
});

// =============================================================================
// CREDIT PROVIDER BALANCE
// =============================================================================

/**
 * POST /admin/settlement-providers/:provider/credit
 *
 * Call this after funding a provider's account (e.g. a bank transfer into
 * the Mongoro-linked account) so the router's ledger reflects what's
 * actually available to spend. Body: { currency: "NGN", amount: 500000 }
 */
router.post('/:provider/credit', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { provider } = req.params;
    const { currency, amount } = req.body as { currency?: string; amount?: number };

    if (!currency || typeof currency !== 'string') {
      return res.status(400).json({ success: false, error: 'currency is required' });
    }
    if (typeof amount !== 'number' || !(amount > 0)) {
      return res.status(400).json({ success: false, error: 'amount must be a positive number' });
    }

    await providerBalanceRepository.credit(provider, currency, amount);

    return res.json({ success: true, message: `Credited ${amount} ${currency} to ${provider}` });
  } catch (err) {
    next(err);
  }
});

export default router;
