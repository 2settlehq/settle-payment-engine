/**
 * Settlement Router
 *
 * Picks which enabled settlement provider handles a payout, preferring
 * whichever has the highest spendable balance that can still cover the
 * transaction — this spreads volume across providers instead of draining
 * one down before touching the next, keeping more of them available for
 * large transactions.
 *
 * Balance is tracked in our own ledger (ProviderBalanceRepository), not
 * queried live from providers, so selection + reservation happens atomically
 * in one place. If the transfer itself fails on the chosen provider (API
 * outage, rejected transfer), the reservation is released and the next
 * candidate with sufficient balance is tried.
 */

import { SettlementProvider, SettlementTransferResult } from './providers/types';
import { ALL_SETTLEMENT_PROVIDERS } from './providers';
import { SettlementRequest } from './types';
import { ProviderBalanceRepository, providerBalanceRepository } from './provider-balance.repository';
import { InsufficientProviderBalanceError, NoProviderAvailableError } from '../errors';

export interface SettlementDispatchResult {
  provider: string;
  result: SettlementTransferResult;
}

export class SettlementRouter {
  constructor(
    private readonly providers: SettlementProvider[] = ALL_SETTLEMENT_PROVIDERS,
    private readonly balances: ProviderBalanceRepository = providerBalanceRepository
  ) {}

  async dispatch(request: SettlementRequest): Promise<SettlementDispatchResult> {
    const enabled = this.providers.filter((p) => p.isEnabled());
    if (enabled.length === 0) {
      throw new NoProviderAvailableError(request.currency, request.amount);
    }

    const spendable = await this.balances.listSpendable(
      enabled.map((p) => p.name),
      request.currency
    );
    const spendableByProvider = new Map(spendable.map((s) => [s.provider, s.spendable]));

    const candidates = enabled
      .filter((p) => (spendableByProvider.get(p.name) ?? 0) >= request.amount)
      .sort((a, b) => (spendableByProvider.get(b.name) ?? 0) - (spendableByProvider.get(a.name) ?? 0));

    if (candidates.length === 0) {
      throw new NoProviderAvailableError(request.currency, request.amount);
    }

    let lastError: unknown;

    for (const provider of candidates) {
      try {
        await this.balances.reserve(provider.name, request.currency, request.amount);
      } catch (error) {
        if (error instanceof InsufficientProviderBalanceError) {
          // Balance moved between listSpendable and this reserve attempt
          // (another settlement grabbed it first) — try the next candidate.
          lastError = error;
          continue;
        }
        throw error;
      }

      try {
        const result = await provider.transfer(request);

        if (result.success) {
          await this.balances.commit(provider.name, request.currency, request.amount);
          return { provider: provider.name, result };
        }

        await this.balances.release(provider.name, request.currency, request.amount);
        lastError = new Error(result.message);
      } catch (error) {
        await this.balances.release(provider.name, request.currency, request.amount);
        lastError = error;
      }
    }

    throw new NoProviderAvailableError(request.currency, request.amount, lastError);
  }
}

export const settlementRouter = new SettlementRouter();
