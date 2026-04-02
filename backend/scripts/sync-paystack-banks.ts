/**
 * Sync Paystack Bank Codes
 *
 * Fetches the full bank list from Paystack and populates the `paystack_code`
 * column in the `banks` table by fuzzy-matching on bank name.
 *
 * Usage:
 *   npx ts-node scripts/sync-paystack-banks.ts
 *   npx ts-node scripts/sync-paystack-banks.ts --dry-run
 *
 * Prerequisites:
 *   ALTER TABLE banks ADD COLUMN IF NOT EXISTS paystack_code VARCHAR(20) NULL;
 *   (MySQL 8.0 doesn't support IF NOT EXISTS on ALTER TABLE — run manually if needed)
 */

import axios from 'axios';
import * as dotenv from 'dotenv';
import { resolve } from 'path';
import { RowDataPacket, Pool } from 'mysql2/promise';

// dotenv MUST load before the mysql pool is created — use require() to prevent import hoisting
dotenv.config({ path: resolve(__dirname, '../.env') });

const pool: Pool = require('../src/lib/mysql').pool;

const DRY_RUN = process.argv.includes('--dry-run');

interface PaystackBank {
  id: number;
  name: string;
  slug: string;
  code: string;
  longcode: string;
  type: string;
  active: boolean;
  country: string;
}

interface BankRow extends RowDataPacket {
  id: number;
  name: string;
  code: string;
  paystack_code: string | null;
}

/** Normalize a bank name for comparison: lowercase, strip punctuation/common words */
function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(bank|microfinance|mfb|mfbank|finance|limited|ltd|plc|ng|nigeria|nigerian)\b/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Simple similarity: count matching words / max word count */
function similarity(a: string, b: string): number {
  const wa = new Set(normalize(a).split(' ').filter(Boolean));
  const wb = new Set(normalize(b).split(' ').filter(Boolean));
  if (wa.size === 0 || wb.size === 0) return 0;
  let matches = 0;
  for (const w of wa) {
    if (wb.has(w)) matches++;
  }
  return matches / Math.max(wa.size, wb.size);
}

async function fetchPaystackBanks(): Promise<PaystackBank[]> {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) throw new Error('PAYSTACK_SECRET_KEY not set in .env');

  const banks: PaystackBank[] = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const res = await axios.get<{ status: boolean; data: PaystackBank[] }>(
      `https://api.paystack.co/bank?country=nigeria&perPage=${perPage}&page=${page}`,
      { headers: { Authorization: `Bearer ${key}` }, timeout: 15000 }
    );
    const chunk = res.data.data;
    if (!chunk || chunk.length === 0) break;
    banks.push(...chunk);
    if (chunk.length < perPage) break;
    page++;
  }

  return banks;
}

async function main() {
  console.log(`=== Sync Paystack Bank Codes ${DRY_RUN ? '[DRY RUN]' : ''} ===\n`);

  // 1. Fetch Paystack bank list
  console.log('Fetching banks from Paystack...');
  let paystackBanks: PaystackBank[];
  try {
    paystackBanks = await fetchPaystackBanks();
  } catch (err: any) {
    console.error('Paystack fetch failed:', err.message);
    if (err.response) console.error('  Status:', err.response.status, JSON.stringify(err.response.data));
    await pool.end();
    process.exit(1);
  }
  console.log(`  Got ${paystackBanks!.length} banks from Paystack\n`);

  // 2. Load our banks table
  const [rows] = await pool.execute<BankRow[]>('SELECT id, name, code, paystack_code FROM banks');
  console.log(`  Got ${rows.length} banks in our DB\n`);

  const THRESHOLD = 0.5; // minimum similarity to accept a match

  const updates: { id: number; ourName: string; ourCode: string; paystackName: string; paystackCode: string; score: number }[] = [];
  const unmatched: { name: string; code: string }[] = [];

  for (const bank of rows) {
    // Try exact code match first (CBN code === Paystack code for some banks)
    const exactCode = paystackBanks.find(p => p.code === bank.code);
    if (exactCode) {
      updates.push({
        id: bank.id,
        ourName: bank.name,
        ourCode: bank.code,
        paystackName: exactCode.name,
        paystackCode: exactCode.code,
        score: 1.0,
      });
      continue;
    }

    // Fuzzy name match
    let best: PaystackBank | null = null;
    let bestScore = 0;
    for (const p of paystackBanks) {
      const score = similarity(bank.name, p.name);
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }

    if (best && bestScore >= THRESHOLD) {
      updates.push({
        id: bank.id,
        ourName: bank.name,
        ourCode: bank.code,
        paystackName: best.name,
        paystackCode: best.code,
        score: bestScore,
      });
    } else {
      unmatched.push({ name: bank.name, code: bank.code });
    }
  }

  // 3. Report matches
  console.log(`MATCHED (${updates.length}):`);
  for (const u of updates) {
    const flag = u.score < 0.8 ? ' ⚠ low confidence' : '';
    console.log(`  [${u.ourCode}] "${u.ourName}" → paystack_code=${u.paystackCode} "${u.paystackName}" (score=${u.score.toFixed(2)})${flag}`);
  }

  if (unmatched.length > 0) {
    console.log(`\nUNMATCHED (${unmatched.length}) — paystack_code will be left NULL:`);
    for (const u of unmatched) {
      console.log(`  [${u.code}] "${u.name}"`);
    }
  }

  if (DRY_RUN) {
    console.log('\n[DRY RUN] No changes written. Re-run without --dry-run to apply.');
    await pool.end();
    return;
  }

  // 4. Apply updates
  console.log(`\nWriting ${updates.length} paystack_code values...`);
  let written = 0;
  for (const u of updates) {
    await pool.execute('UPDATE banks SET paystack_code = ? WHERE id = ?', [u.paystackCode, u.id]);
    written++;
  }

  // 5. Clear stale recipient codes so they get regenerated with correct bank codes
  const [rcResult] = await pool.execute('UPDATE receivers SET paystack_recipient_code = NULL') as any;
  console.log(`Cleared ${rcResult.affectedRows} stale paystack_recipient_code entries from receivers table`);

  console.log(`\nDone. ${written} banks updated, ${unmatched.length} unmatched.\n`);
  await pool.end();
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
