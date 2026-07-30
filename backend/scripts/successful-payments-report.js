/**
 * Print a WhatsApp-ready summary of settled ("successful") payments
 * over a trailing window, grouped by fiat currency and payment type.
 * Pass --csv to also export one row per payment (all relevant fields)
 * to a CSV file for the same window.
 *
 * Sample commands:
 *   pnpm run report:successful-payments
 *   pnpm run report:successful-payments -- --months 1
 *   pnpm run report:successful-payments -- --csv
 *   pnpm run report:successful-payments -- --csv --csv-path ./reports/june.csv
 *   pnpm run report:successful-payments -- --host YOUR_HOST --user YOUR_USER --password YOUR_PASSWORD --db YOUR_DB
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

function formatAmount(value, currency) {
  const number = Number(value || 0);
  return `${currency} ${number.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
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

const TYPE_LABELS = {
  transfer: 'Transfers',
  gift: 'Gifts',
  request: 'Requests',
  merchant: 'Merchant',
};

function buildWhatsAppMessage({ months, startDate, endDate, rows }) {
  const byCurrency = new Map();

  for (const row of rows) {
    const currency = row.fiat_currency;
    if (!byCurrency.has(currency)) {
      byCurrency.set(currency, { total: 0, count: 0, byType: [] });
    }
    const bucket = byCurrency.get(currency);
    bucket.total += Number(row.total || 0);
    bucket.count += row.count;
    bucket.byType.push(row);
  }

  const totalCount = rows.reduce((sum, row) => sum + row.count, 0);
  const windowLabel = months === 1 ? '1 Month' : `${months} Months`;

  const lines = [];
  lines.push(`*💰 Payment Report — Last ${windowLabel}*`);
  lines.push(`_${formatDate(startDate)} to ${formatDate(endDate)}_`);
  lines.push('');
  lines.push(`✅ *Successful Payments:* ${totalCount}`);

  for (const [currency, bucket] of byCurrency) {
    lines.push(`💵 *Total Settled (${currency}):* ${formatAmount(bucket.total, currency)}`);
  }

  lines.push('');
  lines.push('*Breakdown by type:*');
  for (const [currency, bucket] of byCurrency) {
    for (const row of bucket.byType) {
      const label = TYPE_LABELS[row.type] || row.type;
      lines.push(`• ${label} (${currency}): ${row.count} — ${formatAmount(row.total, currency)}`);
    }
  }

  lines.push('');
  lines.push(`_Generated ${formatDate(new Date())}_`);

  return lines.join('\n');
}

async function main() {
  const database = getArg('--db', process.env.DB_NAME || 'settle_db_test');
  const host = getArg('--host', process.env.DB_HOST || '127.0.0.1');
  const port = Number(getArg('--port', process.env.DB_PORT || '3306'));
  const user = getArg('--user', process.env.DB_USER || 'root');
  const password = getArg('--password', process.env.DB_PASSWORD || '');
  const months = Number(getArg('--months', '3'));
  const exportCsv = hasFlag('--csv');

  if (!Number.isInteger(months) || months <= 0) {
    throw new Error(`Invalid --months value: must be a positive integer`);
  }

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
        SELECT
          fiat_currency,
          type,
          COUNT(*) AS count,
          SUM(settled_fiat_amount) AS total
        FROM payment_sessions
        WHERE status = 'settled'
          AND created_at >= DATE_SUB(NOW(), INTERVAL ? MONTH)
        GROUP BY fiat_currency, type
        ORDER BY fiat_currency, type
      `,
      [months]
    );

    const endDate = new Date();
    const startDate = new Date(endDate);
    startDate.setMonth(startDate.getMonth() - months);

    if (rows.length === 0) {
      console.log(`No settled payments in the last ${months} month(s).`);
      return;
    }

    const message = buildWhatsAppMessage({ months, startDate, endDate, rows });
    console.log(message);

    if (exportCsv) {
      const [detailRows] = await connection.query(
        `
          SELECT
            ps.reference,
            ps.type,
            ps.status,
            ps.fiat_amount,
            ps.fiat_currency,
            ps.settled_fiat_amount,
            ps.crypto,
            ps.crypto_amount,
            ps.network,
            ps.rate,
            ps.asset_price,
            ps.charge_amount,
            ps.charge_from,
            ps.deposit_address,
            ps.tx_hash,
            ps.confirmations,
            ps.received_amount,
            ps.settlement_reference,
            ps.settlement_provider,
            ps.merchant_id,
            ps.merchant_reference,
            p.chat_id AS payer_chat_id,
            p.phone AS payer_phone,
            r.bank_code AS receiver_bank_code,
            r.bank_name AS receiver_bank_name,
            r.bank_account AS receiver_account_number,
            r.account_name AS receiver_account_name,
            ps.created_at,
            ps.confirmed_at,
            ps.settled_at
          FROM payment_sessions ps
          LEFT JOIN payers p ON p.id = ps.payer_id
          LEFT JOIN receivers r ON r.id = ps.receiver_id
          WHERE ps.status = 'settled'
            AND ps.created_at >= DATE_SUB(NOW(), INTERVAL ? MONTH)
          ORDER BY ps.created_at DESC
        `,
        [months]
      );

      const csvPath = path.resolve(
        __dirname,
        '..',
        getArg('--csv-path', `reports/successful-payments-${formatDate(startDate)}_to_${formatDate(endDate)}.csv`)
      );

      fs.mkdirSync(path.dirname(csvPath), { recursive: true });
      fs.writeFileSync(csvPath, toCsv(detailRows));

      console.log('');
      console.log(`Detail CSV (${detailRows.length} rows) written to: ${csvPath}`);
    }
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(`Failed to generate report: ${error.message}`);
  process.exit(1);
});
