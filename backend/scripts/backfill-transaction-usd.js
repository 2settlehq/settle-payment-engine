/**
 * Backfill transaction_usd for manual payment_sessions rows where it's NULL.
 *
 * Scoped to settlement_provider = 'manual' — the raw-UPDATE branch in
 * payment.routes.ts (autoSettle on a live key) used to skip transaction_usd.
 * Computes transaction_usd = fiat_amount / rate, matching how it's computed
 * for new sessions (see session-manager.ts). Only touches rows that have
 * both fiat_amount and a non-zero rate — rows without a locked rate
 * (e.g. unfulfilled requests) are left untouched.
 *
 * Sample commands:
 *   pnpm run backfill:transaction-usd
 *   pnpm run backfill:transaction-usd -- --apply
 *   pnpm run backfill:transaction-usd -- --host YOUR_HOST --user YOUR_USER --password YOUR_PASSWORD --db YOUR_DB --apply
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

async function main() {
  const database = getArg('--db', process.env.DB_NAME || 'settle_db_test');
  const host = getArg('--host', process.env.DB_HOST || '127.0.0.1');
  const port = Number(getArg('--port', process.env.DB_PORT || '3306'));
  const user = getArg('--user', process.env.DB_USER || 'root');
  const password = getArg('--password', process.env.DB_PASSWORD || '');
  const apply = hasFlag('--apply');

  assertDatabaseName(database);

  const connection = await mysql.createConnection({
    host,
    port,
    user,
    password,
    database,
  });

  try {
    const [rows] = await connection.query(
      `
        SELECT id, reference, status, fiat_amount, rate, transaction_usd
        FROM payment_sessions
        WHERE settlement_provider = 'manual'
          AND transaction_usd IS NULL
          AND fiat_amount IS NOT NULL
          AND rate IS NOT NULL
          AND rate > 0
        ORDER BY created_at DESC
      `
    );

    console.log(`Database: ${database}`);
    console.log(`Rows to backfill: ${rows.length}`);
    if (rows.length > 0) {
      console.table(
        rows.slice(0, 10).map((r) => ({
          ...r,
          computed_transaction_usd: Number(r.fiat_amount) / Number(r.rate),
        }))
      );
    }

    const [[{ skippedCount }]] = await connection.query(
      `
        SELECT COUNT(*) AS skippedCount
        FROM payment_sessions
        WHERE settlement_provider = 'manual'
          AND transaction_usd IS NULL
          AND (fiat_amount IS NULL OR rate IS NULL OR rate = 0)
      `
    );
    if (skippedCount > 0) {
      console.log(
        `Skipping ${skippedCount} row(s) with no locked rate — these never had a rate to compute from (e.g. unfulfilled requests).`
      );
    }

    if (!apply) {
      console.log('Dry run only. Re-run with --apply to update these rows.');
      return;
    }

    const [result] = await connection.query(
      `
        UPDATE payment_sessions
        SET transaction_usd = fiat_amount / rate
        WHERE settlement_provider = 'manual'
          AND transaction_usd IS NULL
          AND fiat_amount IS NOT NULL
          AND rate IS NOT NULL
          AND rate > 0
      `
    );

    console.log(`Updated rows: ${result.affectedRows}`);
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(`Failed to backfill transaction_usd: ${error.message}`);
  process.exit(1);
});
