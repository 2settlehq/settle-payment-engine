/**
 * Mongoro Settlement Provider
 *
 * Adapts the existing MongoroService to the SettlementProvider interface
 * so SettlementRouter can dispatch to it alongside future providers.
 */

import { MongoroService, mongoroService } from '../mongoro.service';
import { SettlementRequest } from '../types';
import { SettlementProvider, SettlementTransferResult } from './types';

export class MongoroSettlementProvider implements SettlementProvider {
  readonly name = 'mongoro';

  constructor(private readonly mongoro: MongoroService = mongoroService) {}

  isEnabled(): boolean {
    return this.mongoro.isConfigured();
  }

  async transfer(request: SettlementRequest): Promise<SettlementTransferResult> {
    const response = await this.mongoro.transfer(
      request.accountNumber,
      request.bankCode,
      request.bankName || request.bankCode,
      request.accountName,
      request.amount,
      request.narration ?? `Settlement ${request.sessionId}`,
      request.currency
    );

    return {
      success: response.success && Boolean(response.data?.reference),
      reference: response.data?.reference,
      message: response.message,
      raw: response.data as unknown as Record<string, unknown>,
    };
  }
}

export const mongoroSettlementProvider = new MongoroSettlementProvider();
