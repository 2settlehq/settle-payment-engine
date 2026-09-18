/**
 * Print a WhatsApp-ready summary of settled ("successful") payments
 * over a trailing window, grouped by fiat currency and payment type.
 * Pass --csv, --xlsx, and/or --pdf to also export one row per payment
 * (all relevant fields) to a file for the same window.
 *
 * Pass --all to pull every settled payment from day one instead of a
 * trailing window (overrides --months).
 *
 * Settled payments are pulled from both the payment engine
 * (payment_sessions) and the legacy tables (transfers/gifts/requests via
 * summaries, for records that predate/bypassed payment_sessions - see
 * src/routes/history.routes.ts for the same pattern). Detail exports get a
 * `source` column (payment_engine | legacy_transfer | legacy_gift |
 * legacy_request) so rows stay traceable. Pass --exclude-legacy to report
 * on payment_sessions only.
 *
 * Sample commands:
 *   pnpm run report:successful-payments
 *   pnpm run report:successful-payments -- --months 1
 *   pnpm run report:successful-payments -- --csv
 *   pnpm run report:successful-payments -- --csv --csv-path ./reports/june.csv
 *   pnpm run report:successful-payments -- --xlsx
 *   pnpm run report:successful-payments -- --pdf
 *   pnpm run report:successful-payments -- --csv --xlsx --pdf
 *   pnpm run report:successful-payments -- --all --csv --xlsx --pdf
 *   pnpm run report:successful-payments -- --exclude-legacy --csv
 *   pnpm run report:successful-payments -- --host YOUR_HOST --user YOUR_USER --password YOUR_PASSWORD --db YOUR_DB
 */

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

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

function toPlainText(message) {
  return message.replace(/[*_]/g, '');
}

async function writeXlsx({ filePath, summaryRows, detailRows }) {
  const workbook = new ExcelJS.Workbook();

  const summarySheet = workbook.addWorksheet('Summary');
  summarySheet.columns = [
    { header: 'Currency', key: 'fiat_currency', width: 12 },
    { header: 'Type', key: 'type', width: 14 },
    { header: 'Count', key: 'count', width: 10 },
    { header: 'Total', key: 'total', width: 16 },
  ];
  summarySheet.getRow(1).font = { bold: true };
  summarySheet.addRows(summaryRows);

  const detailSheet = workbook.addWorksheet('Details');
  if (detailRows.length > 0) {
    detailSheet.columns = Object.keys(detailRows[0]).map((key) => ({
      header: key,
      key,
      width: 18,
    }));
    detailSheet.getRow(1).font = { bold: true };
    detailSheet.addRows(detailRows);
  }

  await workbook.xlsx.writeFile(filePath);
}

const PDF_DETAIL_COLUMNS = [
  { key: 'reference', label: 'Reference', width: 70 },
  { key: 'type', label: 'Type', width: 45 },
  { key: 'status', label: 'Status', width: 45 },
  { key: 'fiat_currency', label: 'Ccy', width: 30 },
  { key: 'fiat_amount', label: 'Fiat Amt', width: 55 },
  { key: 'settled_fiat_amount', label: 'Settled Amt', width: 55 },
  { key: 'crypto', label: 'Crypto', width: 40 },
  { key: 'crypto_amount', label: 'Crypto Amt', width: 55 },
  { key: 'network', label: 'Network', width: 45 },
  { key: 'payer_phone', label: 'Payer', width: 50 },
  { key: 'receiver_account_number', label: 'Acct #', width: 50 },
  { key: 'created_at', label: 'Created', width: 50 },
  { key: 'settled_at', label: 'Settled', width: 50 },
  { key: 'source', label: 'Source', width: 50 },
];

function drawPdfTableHeader(doc, startX, y) {
  doc.font('Helvetica-Bold').fontSize(7);
  let x = startX;
  for (const column of PDF_DETAIL_COLUMNS) {
    doc.text(column.label, x, y, { width: column.width, ellipsis: true });
    x += column.width;
  }
  doc.font('Helvetica').fontSize(7);
  return y + 12;
}

function writePdf({ filePath, message, detailRows }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 36, layout: 'landscape', size: 'letter' });
    const stream = fs.createWriteStream(filePath);
    stream.on('finish', resolve);
    stream.on('error', reject);
    doc.pipe(stream);

    doc.font('Helvetica').fontSize(10).text(toPlainText(message));

    if (detailRows.length > 0) {
      doc.moveDown();
      const startX = doc.page.margins.left;
      const bottomY = doc.page.height - doc.page.margins.bottom;
      let y = doc.y;

      if (y + 20 > bottomY) {
        doc.addPage();
        y = doc.page.margins.top;
      }
      y = drawPdfTableHeader(doc, startX, y);

      for (const row of detailRows) {
        if (y + 12 > bottomY) {
          doc.addPage();
          y = drawPdfTableHeader(doc, startX, doc.page.margins.top);
        }
        let x = startX;
        for (const column of PDF_DETAIL_COLUMNS) {
          const value = row[column.key];
          const text = value instanceof Date ? value.toISOString() : String(value ?? '');
          doc.text(text, x, y, { width: column.width, ellipsis: true });
          x += column.width;
        }
        y += 12;
      }
    }

    doc.end();
  });
}

const TYPE_LABELS = {
  transfer: 'Transfers',
  gift: 'Gifts',
  request: 'Requests',
  merchant: 'Merchant',
};

function buildWhatsAppMessage({ windowLabel, startDate, endDate, rows }) {
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

  const lines = [];
  lines.push(`*💰 Payment Report — ${windowLabel}*`);
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

function dateFilterSql(pullAll, columnRef) {
  return pullAll ? '' : `AND ${columnRef} >= DATE_SUB(NOW(), INTERVAL ? MONTH)`;
}

// Legacy settled transactions are rows in transfers/gifts/requests (joined via
// summaries, status = 'Successful') that have no matching payment_sessions
// row - see src/routes/history.routes.ts for the same NOT EXISTS pattern.
const LEGACY_BRANCHES = [
  { type: 'transfer', table: 'transfers', alias: 't', idColumn: 'transfer_id' },
  { type: 'gift', table: 'gifts', alias: 'g', idColumn: 'gift_id' },
  { type: 'request', table: 'requests', alias: 'r', idColumn: 'request_id' },
];

async function getTableColumns(connection, table) {
  const [rows] = await connection.query(`SHOW COLUMNS FROM \`${table}\``);
  return new Set(rows.map((row) => row.Field));
}

// Deployed schemas can drift from the migration files (see
// migrations/004_fix_receivers_table.sql for a documented example of this
// happening before), so informational legacy-table columns are looked up at
// runtime and substituted with NULL when absent instead of failing the query.
function col(columns, alias, column) {
  return columns.has(column) ? `${alias}.${column}` : 'NULL';
}

async function main() {
  const database = getArg('--db', process.env.DB_NAME || 'settle_db_test');
  const host = getArg('--host', process.env.DB_HOST || '127.0.0.1');
  const port = Number(getArg('--port', process.env.DB_PORT || '3306'));
  const user = getArg('--user', process.env.DB_USER || 'root');
  const password = getArg('--password', process.env.DB_PASSWORD || '');
  const pullAll = hasFlag('--all');
  const months = Number(getArg('--months', '3'));
  const includeLegacy = !hasFlag('--exclude-legacy');
  const exportCsv = hasFlag('--csv');
  const exportXlsx = hasFlag('--xlsx');
  const exportPdf = hasFlag('--pdf');

  if (!pullAll && (!Number.isInteger(months) || months <= 0)) {
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
    const legacyColumns = {};
    if (includeLegacy) {
      for (const { table } of LEGACY_BRANCHES) {
        legacyColumns[table] = await getTableColumns(connection, table);
      }
    }

    const dateFilterClause = dateFilterSql(pullAll, 'created_at');
    const dateFilterParams = pullAll ? [] : [months];

    const legacySummaryUnion = includeLegacy
      ? LEGACY_BRANCHES.map(
          ({ type, table, alias, idColumn }) => `
        UNION ALL

        SELECT 'NGN' AS fiat_currency, '${type}' AS type, ${alias}.amount_payable AS amount
        FROM summaries s
        INNER JOIN ${table} ${alias} ON s.transaction_id = ${alias}.id
        WHERE s.transaction_type = '${type}' AND s.status = 'Successful'
          AND NOT EXISTS (SELECT 1 FROM payment_sessions WHERE reference = ${alias}.${idColumn})
          ${dateFilterSql(pullAll, `${alias}.date`)}
      `
        ).join('\n')
      : '';
    const legacySummaryParams = includeLegacy
      ? LEGACY_BRANCHES.flatMap(() => dateFilterParams)
      : [];

    const [rows] = await connection.query(
      `
        SELECT fiat_currency, type, COUNT(*) AS count, SUM(amount) AS total
        FROM (
          SELECT fiat_currency, type, settled_fiat_amount AS amount
          FROM payment_sessions
          WHERE status = 'settled'
            ${dateFilterClause}
          ${legacySummaryUnion}
        ) combined
        GROUP BY fiat_currency, type
        ORDER BY fiat_currency, type
      `,
      [...dateFilterParams, ...legacySummaryParams]
    );

    const endDate = new Date();
    let startDate = new Date(endDate);
    startDate.setMonth(startDate.getMonth() - months);

    if (pullAll) {
      const earliestDates = [];

      const [[{ earliest: engineEarliest }]] = await connection.query(
        `SELECT MIN(created_at) AS earliest FROM payment_sessions WHERE status = 'settled'`
      );
      if (engineEarliest) earliestDates.push(new Date(engineEarliest));

      if (includeLegacy) {
        const legacyEarliestUnion = LEGACY_BRANCHES.map(
          ({ type, table, alias, idColumn }) => `
            SELECT ${alias}.date AS d
            FROM summaries s
            INNER JOIN ${table} ${alias} ON s.transaction_id = ${alias}.id
            WHERE s.transaction_type = '${type}' AND s.status = 'Successful'
              AND NOT EXISTS (SELECT 1 FROM payment_sessions WHERE reference = ${alias}.${idColumn})
          `
        ).join('\nUNION ALL\n');

        const [[{ earliest: legacyEarliest }]] = await connection.query(
          `SELECT MIN(d) AS earliest FROM (${legacyEarliestUnion}) legacy_dates`
        );
        if (legacyEarliest) earliestDates.push(new Date(legacyEarliest));
      }

      startDate =
        earliestDates.length > 0
          ? new Date(Math.min(...earliestDates.map((date) => date.getTime())))
          : endDate;
    }

    const windowLabel = pullAll ? 'All Time' : months === 1 ? '1 Month' : `${months} Months`;

    const message =
      rows.length === 0
        ? pullAll
          ? 'No settled payments found.'
          : `No settled payments in the last ${months} month(s).`
        : buildWhatsAppMessage({ windowLabel, startDate, endDate, rows });
    console.log(message);

    if (exportCsv || exportXlsx || exportPdf) {
      const legacyDetailUnion = includeLegacy
        ? LEGACY_BRANCHES.map(
            ({ type, table, alias, idColumn }) => `
        UNION ALL

        SELECT
          ${alias}.${idColumn} AS reference,
          '${type}' AS type,
          'settled' AS status,
          ${alias}.amount_payable AS fiat_amount,
          'NGN' AS fiat_currency,
          ${alias}.amount_payable AS settled_fiat_amount,
          ${col(legacyColumns[table], alias, 'crypto')} AS crypto,
          ${col(legacyColumns[table], alias, 'crypto_amount')} AS crypto_amount,
          ${col(legacyColumns[table], alias, 'network')} AS network,
          ${col(legacyColumns[table], alias, 'current_rate')} AS rate,
          NULL AS asset_price,
          ${col(legacyColumns[table], alias, 'charges')} AS charge_amount,
          NULL AS charge_from,
          ${col(legacyColumns[table], alias, 'wallet_address')} AS deposit_address,
          NULL AS tx_hash,
          NULL AS confirmations,
          NULL AS received_amount,
          NULL AS settlement_reference,
          NULL AS settlement_provider,
          NULL AS merchant_id,
          NULL AS merchant_reference,
          lp.chat_id AS payer_chat_id,
          lp.phone AS payer_phone,
          lr.bank_code AS receiver_bank_code,
          lr.bank_name AS receiver_bank_name,
          lr.bank_account AS receiver_account_number,
          lr.account_name AS receiver_account_name,
          ${alias}.date AS created_at,
          NULL AS confirmed_at,
          ${alias}.date AS settled_at,
          'legacy_${type}' AS source
        FROM summaries s
        INNER JOIN ${table} ${alias} ON s.transaction_id = ${alias}.id
        LEFT JOIN payers lp ON lp.id = ${alias}.payer_id
        LEFT JOIN receivers lr ON lr.id = ${alias}.receiver_id
        WHERE s.transaction_type = '${type}' AND s.status = 'Successful'
          AND NOT EXISTS (SELECT 1 FROM payment_sessions WHERE reference = ${alias}.${idColumn})
          ${dateFilterSql(pullAll, `${alias}.date`)}
      `
          ).join('\n')
        : '';
      const legacyDetailParams = includeLegacy
        ? LEGACY_BRANCHES.flatMap(() => dateFilterParams)
        : [];

      const [detailRows] = await connection.query(
        `
        SELECT * FROM (
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
            ps.settled_at,
            'payment_engine' AS source
          FROM payment_sessions ps
          LEFT JOIN payers p ON p.id = ps.payer_id
          LEFT JOIN receivers r ON r.id = ps.receiver_id
          WHERE ps.status = 'settled'
            ${dateFilterSql(pullAll, 'ps.created_at')}
          ${legacyDetailUnion}
        ) combined
        ORDER BY created_at DESC
        `,
        [...dateFilterParams, ...legacyDetailParams]
      );

      const baseName = pullAll
        ? `successful-payments-all-time_to_${formatDate(endDate)}`
        : `successful-payments-${formatDate(startDate)}_to_${formatDate(endDate)}`;
      console.log('');

      if (exportCsv) {
        const csvPath = path.resolve(__dirname, '..', getArg('--csv-path', `reports/${baseName}.csv`));
        fs.mkdirSync(path.dirname(csvPath), { recursive: true });
        fs.writeFileSync(csvPath, toCsv(detailRows));
        console.log(`Detail CSV (${detailRows.length} rows) written to: ${csvPath}`);
      }

      if (exportXlsx) {
        const xlsxPath = path.resolve(__dirname, '..', getArg('--xlsx-path', `reports/${baseName}.xlsx`));
        fs.mkdirSync(path.dirname(xlsxPath), { recursive: true });
        await writeXlsx({ filePath: xlsxPath, summaryRows: rows, detailRows });
        console.log(`Detail XLSX (${detailRows.length} rows) written to: ${xlsxPath}`);
      }

      if (exportPdf) {
        const pdfPath = path.resolve(__dirname, '..', getArg('--pdf-path', `reports/${baseName}.pdf`));
        fs.mkdirSync(path.dirname(pdfPath), { recursive: true });
        await writePdf({ filePath: pdfPath, message, detailRows });
        console.log(`Detail PDF (${detailRows.length} rows) written to: ${pdfPath}`);
      }
    }
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(`Failed to generate report: ${error.message}`);
  process.exit(1);
});
