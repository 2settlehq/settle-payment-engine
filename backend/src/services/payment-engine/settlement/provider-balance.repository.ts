/**
 * Provider Balance Repository
 *
 * Tracks each settlement provider's spendable balance in our own database,
 * rather than querying the provider live. Providers here (e.g. Mongoro) don't
 * expose a real-time balance endpoint, and even if they did, a live check has
 * a check-then-act race: two concurrent settlements could both see enough
 * balance and both proceed, overdrawing the account. Reserving funds inside
 * the same SELECT ... FOR UPDATE transaction that checks them closes that gap.
 */

import { pool } from '../../../lib/mysql';
import { RowDataPacket } from 'mysql2';
import { InsufficientProviderBalanceError } from '../errors';

interface BalanceRow extends RowDataPacket {
  provider: string;
  balance: string;
  reserved: string;
}

interface BalanceRowWithCurrency extends BalanceRow {
  currency: string;
}

export interface ProviderSpendable {
  provider: string;
  spendable: number;
}

export class ProviderBalanceRepository {
  /** Spendable = funded balance minus amounts currently reserved for in-flight settlements. */
  async listSpendable(providers: string[], currency: string): Promise<ProviderSpendable[]> {
    if (providers.length === 0) return [];

    const placeholders = providers.map(() => '?').join(',');
    const [rows] = await pool.execute<BalanceRow[]>(
      `SELECT provider, balance, reserved FROM settlement_provider_balances
       WHERE currency = ? AND provider IN (${placeholders})`,
      [currency, ...providers]
    );

    const spendableByProvider = new Map(
      rows.map((row) => [row.provider, Number(row.balance) - Number(row.reserved)])
    );

    // Providers with no ledger row yet are treated as having zero spendable balance,
    // not as "unknown" — they're simply excluded from selection until credited.
    return providers.map((provider) => ({
      provider,
      spendable: spendableByProvider.get(provider) ?? 0,
    }));
  }

  /**
   * Atomically reserve `amount` against a provider's balance.
   * Throws InsufficientProviderBalanceError if the balance can no longer
   * cover it at lock time (guards the race between reading balances in
   * listSpendable and reserving one of them).
   */
  async reserve(provider: string, currency: string, amount: number): Promise<void> {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const [rows] = await connection.query(
        `SELECT balance, reserved FROM settlement_provider_balances
         WHERE provider = ? AND currency = ? FOR UPDATE`,
        [provider, currency]
      ) as [BalanceRow[], unknown];

      const row = rows[0];
      const spendable = row ? Number(row.balance) - Number(row.reserved) : 0;

      if (spendable < amount) {
        throw new InsufficientProviderBalanceError(provider, currency, amount, spendable);
      }

      await connection.query(
        `UPDATE settlement_provider_balances SET reserved = reserved + ?
         WHERE provider = ? AND currency = ?`,
        [amount, provider, currency]
      );

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  /** Release a reservation without debiting balance — the settlement attempt failed. */
  async release(provider: string, currency: string, amount: number): Promise<void> {
    await pool.execute(
      `UPDATE settlement_provider_balances SET reserved = GREATEST(reserved - ?, 0)
       WHERE provider = ? AND currency = ?`,
      [amount, provider, currency]
    );
  }

  /** Convert a reservation into an actual debit — the settlement attempt succeeded. */
  async commit(provider: string, currency: string, amount: number): Promise<void> {
    await pool.execute(
      `UPDATE settlement_provider_balances
       SET balance = balance - ?, reserved = GREATEST(reserved - ?, 0)
       WHERE provider = ? AND currency = ?`,
      [amount, amount, provider, currency]
    );
  }

  /** Top up a provider's tracked balance (e.g. after funding its account). */
  async credit(provider: string, currency: string, amount: number): Promise<void> {
    await pool.execute(
      `INSERT INTO settlement_provider_balances (provider, currency, balance, reserved)
       VALUES (?, ?, ?, 0)
       ON DUPLICATE KEY UPDATE balance = balance + VALUES(balance)`,
      [provider, currency, amount]
    );
  }

  async listAll(): Promise<(ProviderSpendable & { currency: string; balance: number; reserved: number })[]> {
    const [rows] = await pool.execute<BalanceRowWithCurrency[]>(
      `SELECT provider, currency, balance, reserved FROM settlement_provider_balances ORDER BY provider, currency`
    );
    return rows.map((row) => ({
      provider: row.provider,
      currency: row.currency,
      balance: Number(row.balance),
      reserved: Number(row.reserved),
      spendable: Number(row.balance) - Number(row.reserved),
    }));
  }
}

export const providerBalanceRepository = new ProviderBalanceRepository();
