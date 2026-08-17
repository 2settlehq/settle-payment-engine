/**
 * Compute per-transaction processing cost against what was charged, for
 * settled payments in a window (or --all time). Complements
 * report:successful-payments, which reports revenue only.
 *
 * Cost = settlement fee (payout-provider fee, e.g. Mongoro's `fee` field -
 * persisted to payment_sessions.settlement_fee as of migration 015) +
 * network fee (blockchain fee paid to sweep the deposit to the hot wallet -
 * sweep_transactions.gas_used/gas_price for the session, converted to USD
 * via the swept chain's native-asset price, then to the transaction's own
 * fiat_currency using payment_sessions.rate, which is fiat-per-USD for
 * that transaction since it's how charge-calculator.ts derives chargeUsd).
 *
 * Native asset prices default to the reference values in
 * docs/transaction-overhead.md (captured 2026-08-02) - override with
 * --btc-price/--eth-price/--bnb-price/--trx-price for current market rates,
 * since these move constantly and the defaults will go stale.
 *
 * A transaction with no matching sweep_transactions row (sweeper disabled,
 * legacy wallet pool, or not yet swept) reports network_fee as null and
 * has_sweep_record: false rather than silently treating it as zero cost -
 * check that column before trusting net_margin on those rows.
 *
 * Pass --estimate for a worked cost-per-transaction figure that needs no
 * database at all - it applies 2Settle's own fee tiers (mirrored from
 * charge-calculator.ts) against reference network + settlement + auth-SMS
 * fees, broken into individual components:
 *   - sweep fee: the deposit-address -> hot-wallet transfer itself
 *   - pre-fund fee: for token sweeps only (ERC20/BEP20/TRC20), the separate
 *     hot-wallet -> deposit-address transaction that funds native gas first
 *     (see sweeper.service.ts's ensureGasForTokenSweep) - a real cost this
 *     script previously omitted entirely
 *   - settlement fee: payout-provider fee (Paystack-schedule proxy)
 *   - auth SMS fee: phone-OTP login cost (Africa's Talking), amortized
 *     across --sms-txns-per-login transactions per login (default 1)
 * Use this when there isn't enough real settled/swept history yet for the
 * live report above to say anything (e.g. a fresh or low-volume database).
 *
 * Sample commands:
 *   pnpm run report:transaction-overhead -- --estimate
 *   pnpm run report:transaction-overhead -- --estimate --csv
 *   pnpm run report:transaction-overhead -- --estimate --ngn-rate 1400
 *   pnpm run report:transaction-overhead -- --estimate --sms-txns-per-login 3
 *   pnpm run report:transaction-overhead
 *   pnpm run report:transaction-overhead -- --months 1 --csv
 *   pnpm run report:transaction-overhead -- --all --csv --csv-path ./reports/overhead.csv
 *   pnpm run report:transaction-overhead -- --btc-price 65000 --eth-price 1900 --bnb-price 600 --trx-price 0.34
 *   pnpm run report:transaction-overhead -- --host YOUR_HOST --user YOUR_USER --password YOUR_PASSWORD --db YOUR_DB
 */

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

const envPaths = [
  path.resolve(__dirname, '../../.env'),
  path.resolve(__dirname, '../.env'),
];

for (const envPath of envPaths) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  }
}

function getArg(flag, fallback) {
  const index = process.argv.indexOf(flag);
  if (index >= 0 && process.argv[index + 1]) {
    return process.argv[index + 1];
  }
  return fallback;
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function assertDatabaseName(name) {
  if (!/^[A-Za-z0-9_]+$/.test(name)) {
    throw new Error(`Invalid database name: ${name}`);
  }
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function formatMoney(value, currency) {
  const number = Number(value || 0);
  return `${currency} ${number.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// "NGN X (USD Y)" - USD gets 4 decimals under $0.01 (e.g. BSC gas fees are
// sub-cent) and 2 decimals otherwise, so small values don't print as $0.00.
function formatDual(ngnValue, ngnPerUsd) {
  const ngn = Number(ngnValue || 0);
  const usd = ngn / ngnPerUsd;
  const usdDecimals = Math.abs(usd) < 0.01 && usd !== 0 ? 4 : 2;
  const ngnStr = ngn.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const usdStr = usd.toLocaleString('en-US', { minimumFractionDigits: usdDecimals, maximumFractionDigits: usdDecimals });
  return `NGN ${ngnStr} ($${usdStr})`;
}

function toCsv(rows) {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const escape = (value) => {
    if (value === null || value === undefined) return '';
    const str = value instanceof Date ? value.toISOString() : String(value);
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((header) => escape(row[header])).join(','));
  }
  return lines.join('\n');
}

// Reference native-asset USD prices - see docs/transaction-overhead.md for
// sourcing/date. Override via CLI flags since these go stale fast.
const DEFAULT_NATIVE_PRICES_USD = {
  bitcoin: 63200,
  ethereum: 1850,
  bsc: 583,
  tron: 0.33,
};

// Mirrors how each chain's sweeper actually populates gas_used/gas_price
// (see src/services/payment-engine/sweeper/chains/*.sweeper.ts) - the
// columns don't mean the same thing on every chain:
//  - bitcoin: gas_used IS the total fee, in satoshis; gas_price is sat/vByte
//    and only informational.
//  - ethereum/bsc: gas_used is gas units, gas_price is gwei; fee = used * price.
//  - tron: gas_used IS the total fee/reserve, in SUN.
function computeNetworkFeeNative(chain, gasUsed, gasPrice) {
  if (gasUsed === null || gasUsed === undefined) return 0;
  const used = Number(gasUsed);
  if (!Number.isFinite(used)) return 0;

  switch (chain) {
    case 'bitcoin':
      return used / 1e8;
    case 'ethereum':
    case 'bsc': {
      const priceGwei = Number(gasPrice);
      return Number.isFinite(priceGwei) ? (used * priceGwei) / 1e9 : 0;
    }
    case 'tron':
      return used / 1e6;
    default:
      return 0;
  }
}

// =============================================================================
// --estimate mode: a worked figure with no database required
// =============================================================================

const DEFAULT_NGN_PER_USD = 1363; // XE mid-market rate, captured 2026-08-02

// Mirrors DEFAULT_FEE_TIERS in src/services/payment-engine/charges/charge-calculator.ts.
// exampleAmount is just a representative fiat amount within each tier, used
// to size the settlement-fee estimate below.
const FEE_TIERS = [
  { name: 'basic', maxAmount: 100_000, feeAmount: 500, exampleAmount: 50_000 },
  { name: 'standard', maxAmount: 1_000_000, feeAmount: 1_000, exampleAmount: 500_000 },
  { name: 'premium', maxAmount: 2_000_000, feeAmount: 1_500, exampleAmount: 1_500_000 },
];

// Reference network fees in USD per (crypto, network) combo actually
// supported by this engine (see CLAUDE.md's crypto/network table). Sourced
// 2026-08-02 - see docs/TRANSACTION_OVERHEAD.md for citations. Where the
// codebase already models a fee (BSC gas formula, Tron's 5-TRX sweep
// reserve in tron.sweeper.ts), that figure is used instead of a market
// average so the estimate matches what the live report will eventually
// compute from real sweep_transactions rows.
//
// Split into two legs because sweeper.service.ts's ensureGasForTokenSweep()
// does too: token sweeps (ERC20/BEP20/TRC20) need the deposit address
// pre-funded with native gas from the hot wallet BEFORE the token itself
// can be swept - that pre-fund is a second, separate on-chain transaction
// with its own real fee, paid by the hot wallet. Native-coin sweeps (BTC/
// ETH/BNB/TRX) need no pre-fund - the deposit already holds the coin that
// pays its own gas. This pre-fund leg isn't written to sweep_transactions
// (prefundEVMGas/prefundTronGas execute it without a DB record - see
// "Known Gaps"), so the live (non---estimate) report also can't see it yet.
const NETWORK_FEE_COMBOS = [
  { crypto: 'BTC', network: 'bitcoin', sweepFeeUsd: 0.65, prefundFeeUsd: 0, note: 'Blockchair avg BTC tx fee' },
  { crypto: 'ETH', network: 'ethereum', sweepFeeUsd: 0.175, prefundFeeUsd: 0, note: 'native L1 transfer, $0.10-$0.25 range' },
  { crypto: 'USDT/USDC', network: 'erc20', sweepFeeUsd: 0.525, prefundFeeUsd: 0.175, note: 'sweep: ERC20 transfer (~65k gas); pre-fund: native ETH send (~21k gas) so the deposit address can pay its own gas' },
  { crypto: 'BNB', network: 'bsc', sweepFeeUsd: 0.0006, prefundFeeUsd: 0, note: '21000 gas x 0.05 gwei (BscScan gas tracker)' },
  { crypto: 'USDT/USDC', network: 'bep20', sweepFeeUsd: 0.0019, prefundFeeUsd: 0.0006, note: 'sweep: 65000 gas x 0.05 gwei; pre-fund: 21000 gas x 0.05 gwei' },
  { crypto: 'TRX', network: 'tron', sweepFeeUsd: 0.05, prefundFeeUsd: 0, note: 'native transfer, sub-$0.10' },
  { crypto: 'USDT', network: 'trc20', sweepFeeUsd: 1.65, prefundFeeUsd: 0, note: '5 TRX bandwidth reserve per tron.sweeper.ts, no energy rental. Pre-fund TRX send is ~free (daily bandwidth allowance) - the funded TRX itself becomes the sweep fee above, not a second cost' },
  { crypto: 'USDT', network: 'trc20 (energy rental)', sweepFeeUsd: 1.485, prefundFeeUsd: 0, note: '~4.5 TRX rented from tronsave/tronzap/tronenergyrent instead of burning 5 TRX directly - replaces the pre-fund step entirely' },
];

// Nigerian bank-transfer payout pricing is not published for Mongoro, so
// this proxies Paystack's public Transfers API schedule (same rail class -
// NIP bank transfer) plus the NTA 2025 stamp duty. Swap for Mongoro's real
// number if/when they publish one, or once payment_sessions.settlement_fee
// has enough real rows to average instead.
function estimateSettlementFeeNgn(amountNgn) {
  const tierFee = amountNgn <= 5_000 ? 10 : amountNgn <= 50_000 ? 25 : 50;
  const stampDuty = amountNgn >= 10_000 ? 50 : 0; // Nigeria Tax Act 2025 levy
  return tierFee + stampDuty;
}

// Africa's Talking Nigeria SMS pricing, captured 2026-08-02 (market range
// NGN 2.50-6/SMS depending on volume). Only phone-OTP login incurs this -
// wallet (SIWE) and Google login are free. One SMS per login
// (africastalking.provider.ts sends exactly one per otp.request), and
// JWT_REFRESH_EXPIRES_IN_DAYS=30 (.env) means a session can outlive many
// transactions - but low-frequency remittance users may re-auth on every
// visit in practice, so this defaults to the conservative one-SMS-per-
// transaction case. Override the amortization with --sms-txns-per-login.
const AUTH_SMS_FEE_NGN = 4;

function runEstimate() {
  const ngnPerUsd = Number(getArg('--ngn-rate', DEFAULT_NGN_PER_USD));
  const smsTxnsPerLogin = Number(getArg('--sms-txns-per-login', '1'));
  const exportCsv = hasFlag('--csv');

  const authSmsFeeNgn = AUTH_SMS_FEE_NGN / smsTxnsPerLogin;

  console.log('Estimated Cost Per Transaction (no database - reference figures)');
  console.log(`USD/NGN rate: ${ngnPerUsd} (override with --ngn-rate)`);
  console.log(
    `Auth SMS fee: ${formatMoney(AUTH_SMS_FEE_NGN, 'NGN')}/login amortized over ${smsTxnsPerLogin} txn(s)/login = ${formatMoney(authSmsFeeNgn, 'NGN')}/txn (override with --sms-txns-per-login; phone-OTP logins only, wallet/Google login are free)`
  );
  console.log('');

  const csvRows = [];

  for (const tier of FEE_TIERS) {
    const settlementFeeNgn = estimateSettlementFeeNgn(tier.exampleAmount);
    console.log(
      `${tier.name.toUpperCase()} tier (up to ${formatMoney(tier.maxAmount, 'NGN')}, charge ${formatMoney(tier.feeAmount, 'NGN')}, settlement fee ~${formatMoney(settlementFeeNgn, 'NGN')} on a ${formatMoney(tier.exampleAmount, 'NGN')} example)`
    );

    for (const combo of NETWORK_FEE_COMBOS) {
      const sweepFeeNgn = combo.sweepFeeUsd * ngnPerUsd;
      const prefundFeeNgn = combo.prefundFeeUsd * ngnPerUsd;
      const networkFeeNgn = sweepFeeNgn + prefundFeeNgn;
      const totalCost = networkFeeNgn + settlementFeeNgn + authSmsFeeNgn;
      const netMargin = tier.feeAmount - totalCost;
      const marginPct = (netMargin / tier.feeAmount) * 100;
      const flag = netMargin < 0 ? '  <-- LOSS' : '';

      console.log(
        `  ${combo.crypto.padEnd(11)} ${combo.network.padEnd(17)} sweep ${formatMoney(sweepFeeNgn, 'NGN').padStart(11)}  prefund ${formatMoney(prefundFeeNgn, 'NGN').padStart(9)}  net ${formatMoney(netMargin, 'NGN').padStart(12)} (${marginPct.toFixed(0)}%)${flag}`
      );

      csvRows.push({
        tier: tier.name,
        crypto: combo.crypto,
        network: combo.network,
        charge_amount_ngn: tier.feeAmount,
        sweep_fee_usd: combo.sweepFeeUsd,
        sweep_fee_ngn: Number(sweepFeeNgn.toFixed(2)),
        sweep_fee_display: formatDual(sweepFeeNgn, ngnPerUsd),
        prefund_fee_usd: combo.prefundFeeUsd,
        prefund_fee_ngn: Number(prefundFeeNgn.toFixed(2)),
        prefund_fee_display: combo.prefundFeeUsd > 0 ? formatDual(prefundFeeNgn, ngnPerUsd) : '-',
        network_fee_ngn: Number(networkFeeNgn.toFixed(2)),
        settlement_fee_ngn: settlementFeeNgn,
        settlement_fee_display: formatDual(settlementFeeNgn, ngnPerUsd),
        auth_sms_fee_ngn: Number(authSmsFeeNgn.toFixed(2)),
        auth_sms_fee_display: formatDual(authSmsFeeNgn, ngnPerUsd),
        net_margin_ngn: Number(netMargin.toFixed(2)),
        net_margin_display: formatDual(netMargin, ngnPerUsd),
        net_margin_pct: Number(marginPct.toFixed(1)),
        note: combo.note,
      });
    }
    console.log('');
  }

  console.log('These are reference figures, not measured data - see docs/TRANSACTION_OVERHEAD.md.');
  console.log('Network fee USD figures are fixed reference values (edit NETWORK_FEE_COMBOS to adjust); --ngn-rate overrides the USD/NGN conversion.');

  if (exportCsv) {
    const csvPath = path.resolve(__dirname, '..', getArg('--csv-path', 'reports/transaction-cost-estimate.csv'));
    fs.mkdirSync(path.dirname(csvPath), { recursive: true });
    fs.writeFileSync(csvPath, toCsv(csvRows));
    console.log('');
    console.log(`Estimate CSV written to: ${csvPath}`);
  }
}

async function main() {
  const database = getArg('--db', process.env.DB_NAME || 'settle_db_test');
  const host = getArg('--host', process.env.DB_HOST || '127.0.0.1');
  const port = Number(getArg('--port', process.env.DB_PORT || '3306'));
  const user = getArg('--user', process.env.DB_USER || 'root');
  const password = getArg('--password', process.env.DB_PASSWORD || '');
  const pullAll = hasFlag('--all');
  const months = Number(getArg('--months', '3'));
  const exportCsv = hasFlag('--csv');

  if (!pullAll && (!Number.isInteger(months) || months <= 0)) {
    throw new Error(`Invalid --months value: must be a positive integer`);
  }

  assertDatabaseName(database);

  const nativePrices = {
    bitcoin: Number(getArg('--btc-price', DEFAULT_NATIVE_PRICES_USD.bitcoin)),
    ethereum: Number(getArg('--eth-price', DEFAULT_NATIVE_PRICES_USD.ethereum)),
    bsc: Number(getArg('--bnb-price', DEFAULT_NATIVE_PRICES_USD.bsc)),
    tron: Number(getArg('--trx-price', DEFAULT_NATIVE_PRICES_USD.tron)),
  };

  const connection = await mysql.createConnection({ host, port, user, password, database });

  try {
    const dateFilterClause = pullAll ? '' : 'AND ps.created_at >= DATE_SUB(NOW(), INTERVAL ? MONTH)';
    const dateFilterParams = pullAll ? [] : [months];

    const [rows] = await connection.query(
      `
        SELECT
          ps.reference,
          ps.type,
          ps.fiat_currency,
          ps.charge_amount,
          ps.settlement_fee,
          ps.crypto,
          ps.network,
          ps.rate,
          ps.created_at,
          ps.settled_at,
          st.chain,
          st.gas_used,
          st.gas_price
        FROM payment_sessions ps
        LEFT JOIN sweep_transactions st
          ON st.session_id = ps.id COLLATE utf8mb4_unicode_ci AND st.status = 'confirmed'
        WHERE ps.status = 'settled'
          ${dateFilterClause}
        ORDER BY ps.created_at DESC
      `,
      dateFilterParams
    );

    // A session can have more than one confirmed sweep leg (e.g. a native
    // gas top-up plus the token sweep itself), so group and sum by reference.
    const sessions = new Map();
    for (const row of rows) {
      if (!sessions.has(row.reference)) {
        sessions.set(row.reference, {
          reference: row.reference,
          type: row.type,
          fiatCurrency: row.fiat_currency,
          chargeAmount: Number(row.charge_amount || 0),
          settlementFee: row.settlement_fee !== null ? Number(row.settlement_fee) : null,
          rate: row.rate !== null ? Number(row.rate) : null,
          crypto: row.crypto,
          network: row.network,
          createdAt: row.created_at,
          settledAt: row.settled_at,
          networkFeeUsd: 0,
          hasSweepRecord: false,
        });
      }
      const session = sessions.get(row.reference);
      if (row.chain) {
        session.hasSweepRecord = true;
        const feeNative = computeNetworkFeeNative(row.chain, row.gas_used, row.gas_price);
        session.networkFeeUsd += feeNative * (nativePrices[row.chain] || 0);
      }
    }

    const results = [...sessions.values()].map((s) => {
      const networkFeeFiat = s.hasSweepRecord && s.rate ? s.networkFeeUsd * s.rate : null;
      const knownCost = (networkFeeFiat || 0) + (s.settlementFee || 0);
      return {
        reference: s.reference,
        type: s.type,
        fiat_currency: s.fiatCurrency,
        charge_amount: s.chargeAmount,
        settlement_fee: s.settlementFee,
        network_fee_usd: s.hasSweepRecord ? Number(s.networkFeeUsd.toFixed(4)) : null,
        network_fee: networkFeeFiat !== null ? Number(networkFeeFiat.toFixed(2)) : null,
        net_margin: Number((s.chargeAmount - knownCost).toFixed(2)),
        has_sweep_record: s.hasSweepRecord,
        has_settlement_fee: s.settlementFee !== null,
        crypto: s.crypto,
        network: s.network,
        created_at: s.createdAt,
        settled_at: s.settledAt,
      };
    });

    const endDate = new Date();
    const startDate = new Date(endDate);
    if (!pullAll) startDate.setMonth(startDate.getMonth() - months);
    const windowLabel = pullAll ? 'All Time' : months === 1 ? '1 Month' : `${months} Months`;

    if (results.length === 0) {
      console.log(`No settled payments found for ${windowLabel}.`);
      return;
    }

    const byCurrency = new Map();
    let missingSweep = 0;
    let missingSettlementFee = 0;

    for (const r of results) {
      if (!byCurrency.has(r.fiat_currency)) {
        byCurrency.set(r.fiat_currency, { revenue: 0, networkFee: 0, settlementFee: 0, margin: 0, count: 0 });
      }
      const bucket = byCurrency.get(r.fiat_currency);
      bucket.revenue += r.charge_amount;
      bucket.networkFee += r.network_fee || 0;
      bucket.settlementFee += r.settlement_fee || 0;
      bucket.margin += r.net_margin;
      bucket.count += 1;
      if (!r.has_sweep_record) missingSweep += 1;
      if (!r.has_settlement_fee) missingSettlementFee += 1;
    }

    console.log(`Transaction Overhead — ${windowLabel}`);
    console.log(`${formatDate(startDate)} to ${formatDate(endDate)}`);
    console.log('');
    console.log(
      `Native prices used (USD): BTC ${nativePrices.bitcoin} · ETH ${nativePrices.ethereum} · BNB ${nativePrices.bsc} · TRX ${nativePrices.tron}`
    );
    console.log('');

    for (const [currency, bucket] of byCurrency) {
      console.log(`${currency} (${bucket.count} transactions)`);
      console.log(`  Revenue (charge_amount):     ${formatMoney(bucket.revenue, currency)}`);
      console.log(`  - Network fee (blockchain):  ${formatMoney(bucket.networkFee, currency)}`);
      console.log(`  - Settlement fee (payout):   ${formatMoney(bucket.settlementFee, currency)}`);
      console.log(`  = Net margin:                ${formatMoney(bucket.margin, currency)}`);
      console.log('');
    }

    if (missingSweep > 0) {
      console.log(`Note: ${missingSweep}/${results.length} transactions have no confirmed sweep record (network_fee unknown, treated as 0 in margin above).`);
    }
    if (missingSettlementFee > 0) {
      console.log(`Note: ${missingSettlementFee}/${results.length} transactions have no settlement_fee on record (older rows predate migration 015, or were self/manually settled).`);
    }

    if (exportCsv) {
      const baseName = pullAll
        ? `transaction-overhead-all-time_to_${formatDate(endDate)}`
        : `transaction-overhead-${formatDate(startDate)}_to_${formatDate(endDate)}`;
      const csvPath = path.resolve(__dirname, '..', getArg('--csv-path', `reports/${baseName}.csv`));
      fs.mkdirSync(path.dirname(csvPath), { recursive: true });
      fs.writeFileSync(csvPath, toCsv(results));
      console.log('');
      console.log(`Detail CSV (${results.length} rows) written to: ${csvPath}`);
    }
  } finally {
    await connection.end();
  }
}

if (hasFlag('--estimate')) {
  runEstimate();
} else {
  main().catch((error) => {
    console.error(`Failed to generate report: ${error.message}`);
    process.exit(1);
  });
}
