/**
 * Bank Service
 *
 * Shared service for bank lookups and NUBAN account resolution.
 * Used by route handlers and internally by participant service
 * to verify receiver details before any payment is processed.
 */

import axios from 'axios';
import pool from '../../lib/mysql';

// =============================================================================
// TYPES
// =============================================================================

export interface BankRecord {
  name: string;
  code: string;
}

export interface ResolvedAccount {
  accountNumber: string;
  accountName: string;
  bankCode: string;
  bankName: string;
}

const BANK_SEARCH_ALIASES: Record<string, string[]> = {
  access: ['Access Bank'],
  'access bank': ['Access Bank'],
  citibank: ['Citi Bank', 'Citibank Nigeria'],
  'citi bank': ['Citibank', 'Citibank Nigeria'],
  ecobank: ['Eco Bank', 'Ecobank Nigeria'],
  'eco bank': ['Ecobank', 'Ecobank Nigeria'],
  fidelity: ['Fidelity Bank'],
  'fidelity bank': ['Fidelity Bank'],
  'first bank': ['First Bank of Nigeria', 'FBN'],
  'first bank of nigeria': ['First Bank', 'FBN'],
  fbn: ['First Bank', 'First Bank of Nigeria'],
  fcmb: ['First City Monument Bank'],
  'first city monument bank': ['FCMB'],
  gtbank: ['GTBANK', 'GT Bank', 'Guaranty Trust Bank', 'Guaranteed Trust Bank'],
  gtb: ['GTBANK', 'GT Bank', 'Guaranty Trust Bank', 'Guaranteed Trust Bank'],
  'gt bank': ['GTBANK', 'GT Bank', 'Guaranty Trust Bank', 'Guaranteed Trust Bank'],
  'guaranty trust bank': ['GTBANK', 'GT Bank', 'Guaranty Trust Bank'],
  'guaranteed trust bank': ['GTBANK', 'GT Bank', 'Guaranty Trust Bank'],
  gtco: ['GTBANK', 'GT Bank', 'Guaranty Trust Bank'],
  globus: ['Globus Bank'],
  jaiz: ['Jaiz Bank'],
  keystone: ['Keystone Bank'],
  polaris: ['Polaris Bank'],
  providus: ['Providus Bank'],
  stanbic: ['Stanbic IBTC', 'Stanbic IBTC Bank'],
  'stanbic ibtc': ['Stanbic Bank', 'Stanbic IBTC Bank'],
  standard: ['Standard Chartered', 'Standard Chartered Bank'],
  'standard chartered': ['Standard Chartered Bank'],
  sterling: ['Sterling Bank'],
  suntrust: ['Suntrust Bank'],
  'taj bank': ['TAJBank', 'TAJ Bank'],
  tajbank: ['TAJ Bank'],
  titan: ['Titan Trust Bank'],
  'titan trust': ['Titan Trust Bank'],
  uba: ['UBA', 'United Bank for Africa', 'United Bank of Africa'],
  'united bank for africa': ['UBA', 'United Bank for Africa', 'United Bank of Africa'],
  'united bank of africa': ['UBA', 'United Bank for Africa', 'United Bank of Africa'],
  union: ['Union Bank'],
  'union bank': ['Union Bank of Nigeria'],
  unity: ['Unity Bank'],
  wema: ['Wema Bank'],
  zenith: ['Zenith Bank'],
  'zenith bank': ['Zenith Bank'],
  opay: ['OPay', 'Paycom'],
  paycom: ['OPay', 'O Pay'],
  'o pay': ['OPay', 'Paycom'],
  palmpay: ['PalmPay', 'Palm Pay'],
  'palm pay': ['PalmPay'],
  moniepoint: ['Moniepoint', 'TeamApt'],
  teamapt: ['Moniepoint'],
  kuda: ['Kuda Microfinance Bank', 'Kuda MFB'],
  carbon: ['Carbon Microfinance Bank', 'One Finance'],
  fairmoney: ['FairMoney Microfinance Bank'],
};

function normalizeBankSearchTerm(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(plc|limited|ltd|ng|nigeria|nigerian)\b/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getBankSearchTerms(name: string): string[] {
  const trimmed = name.trim();
  const normalized = normalizeBankSearchTerm(trimmed);
  const aliases = BANK_SEARCH_ALIASES[normalized] ?? [];
  return [...new Set([trimmed, ...aliases].filter(Boolean))];
}

const WEAK_BANK_WORDS = new Set([
  'bank',
  'microfinance',
  'mfb',
  'mfbank',
  'finance',
  'financial',
  'limited',
  'ltd',
  'plc',
  'ng',
  'nigeria',
  'nigerian',
  'for',
  'of',
  'the',
]);

function getBankTokens(name: string): string[] {
  return normalizeBankSearchTerm(name)
    .split(' ')
    .filter((token) => token && !WEAK_BANK_WORDS.has(token));
}

function getAcronym(name: string): string {
  return getBankTokens(name).map((token) => token[0]).join('');
}

function scoreBankSearchMatch(query: string, bankName: string): number {
  const terms = getBankSearchTerms(query);
  const normalizedBankName = normalizeBankSearchTerm(bankName);
  const bankTokens = getBankTokens(bankName);
  const bankAcronym = getAcronym(bankName);
  let bestScore = 0;

  for (const term of terms) {
    const normalizedTerm = normalizeBankSearchTerm(term);
    const termTokens = getBankTokens(term);

    if (!normalizedTerm) continue;

    if (normalizedBankName === normalizedTerm) {
      bestScore = Math.max(bestScore, 1);
      continue;
    }

    if (bankAcronym && normalizedTerm === bankAcronym) {
      bestScore = Math.max(bestScore, 0.98);
      continue;
    }

    if (normalizedBankName.startsWith(normalizedTerm)) {
      bestScore = Math.max(bestScore, 0.92);
    }

    if (bankAcronym && bankAcronym.startsWith(normalizedTerm) && normalizedTerm.length >= 2) {
      bestScore = Math.max(bestScore, 0.9);
    }

    if (normalizedBankName.includes(normalizedTerm)) {
      bestScore = Math.max(bestScore, 0.82);
    }

    if (termTokens.length > 0) {
      const matches = termTokens.filter((token) =>
        bankTokens.some((bankToken) => bankToken === token || bankToken.startsWith(token))
      ).length;
      const tokenScore = matches / Math.max(termTokens.length, bankTokens.length);
      bestScore = Math.max(bestScore, tokenScore);
    }
  }

  return bestScore;
}

// =============================================================================
// SERVICE
// =============================================================================

export class BankService {
  /**
   * Search banks table by name.
   * Returns matching banks with their codes.
   */
  async searchBanks(name: string): Promise<BankRecord[]> {
    const [rows] = await pool.query<any[]>(
      'SELECT name, code FROM banks'
    );

    return rows
      .map((row) => ({
        bank: { name: row.name, code: row.code },
        score: scoreBankSearchMatch(name, row.name),
      }))
      .filter((result) => result.score >= 0.45)
      .sort((a, b) => b.score - a.score || a.bank.name.localeCompare(b.bank.name))
      .slice(0, 10)
      .map((result) => result.bank);
  }

  /**
   * Look up a bank record by its CBN code.
   */
  async getBankByCode(code: string): Promise<BankRecord | null> {
    const [rows] = await pool.query<any[]>(
      `SELECT name, code FROM banks WHERE code = ? LIMIT 1`,
      [code]
    );
    return rows.length > 0 ? { name: rows[0].name, code: rows[0].code } : null;
  }

  /**
   * Resolve a bank account via NUBAN.
   * If bankNameFallback is not provided, looks up the bank name from our banks
   * table using the bank code so the name is always populated.
   *
   * @param bankCode       - CBN bank code
   * @param accountNumber  - NUBAN account number
   * @param bankNameFallback - Optional override; auto-looked up from DB if omitted
   */
  async resolveAccount(
    bankCode: string,
    accountNumber: string,
    bankNameFallback?: string
  ): Promise<ResolvedAccount> {
    const nubanApiKey = process.env.NUBAN_API_KEY;
    if (!nubanApiKey) {
      throw new Error('NUBAN_API_KEY is not configured');
    }

    // Auto-lookup bank name from DB if not provided — NUBAN doesn't return it
    const resolvedBankName = bankNameFallback || (await this.getBankByCode(bankCode))?.name || bankCode;

    let response;
    try {
      response = await axios.get<any[]>(
        `https://app.nuban.com.ng/api/${nubanApiKey}?bank_code=${bankCode}&acc_no=${accountNumber}`
      );
    } catch (err: any) {
      console.error('[BankService] NUBAN API request failed:', err.message, err.response?.status, err.response?.data);
      throw new Error('NUBAN_SERVICE_UNAVAILABLE');
    }

    // NUBAN returns an error object { error: true, message: '...' } on failure instead of an array
    if (!Array.isArray(response.data) || response.data.length === 0) {
      console.error('[BankService] NUBAN error response:', response.data);
      const nubanMsg: string = (response.data as any)?.message ?? '';
      if (nubanMsg.toLowerCase().includes('api key') || nubanMsg.toLowerCase().includes('api_key')) {
        throw new Error('NUBAN_SERVICE_UNAVAILABLE');
      }
      throw new Error('Could not verify account details. Please confirm the account number and bank code are correct.');
    }

    console.log('NUBAN resolution result:', response.data);
    const nuban = response.data[0];

    return {
      accountNumber: nuban.account_number ?? accountNumber,
      accountName: nuban.account_name,
      bankCode: nuban.bank_code ?? bankCode,
      bankName: nuban.bank_name || resolvedBankName,
    };
  }

  // /**
  //  * @deprecated — resolveReceiver() accepted a bank name and searched the DB
  //  * to get the bank code before calling NUBAN. All callers now receive bankCode
  //  * directly (from GET /banks/list or POST /payments/verify-receiver) and call
  //  * resolveAccount() instead. Bank name is auto-looked up inside resolveAccount()
  //  * so callers no longer need to pass it.
  //  *
  //  * Resolve a receiver from a bank name (user-provided text) and account number.
  //  *  1. Search banks table for the bank name → get bank code
  //  *  2. Call NUBAN with bank code + account number → get verified account details
  //  *  3. Fall back to our bank name if NUBAN doesn't return one
  //  */
  // async resolveReceiver(bankName: string, accountNumber: string): Promise<ResolvedAccount> {
  //   const banks = await this.searchBanks(bankName);
  //   if (banks.length === 0) {
  //     throw new Error(`Bank not found: "${bankName}". Please check the bank name.`);
  //   }
  //   const bank = banks[0];
  //   return this.resolveAccount(bank.code, accountNumber, bank.name);
  // }
}

// =============================================================================
// SINGLETON
// =============================================================================

let instance: BankService | null = null;

export function getBankService(): BankService {
  if (!instance) {
    instance = new BankService();
  }
  return instance;
}

export const bankService = getBankService();
