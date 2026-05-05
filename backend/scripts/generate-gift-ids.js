const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
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

function assertDatabaseName(name, label) {
  if (!/^[A-Za-z0-9_]+$/.test(name)) {
    throw new Error(`Invalid ${label}: ${name}`);
  }
}

function generateGiftId(length = 6) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';

  while (id.length < length) {
    const bytes = crypto.randomBytes(length);
    for (const byte of bytes) {
      id += alphabet[byte % alphabet.length];
      if (id.length === length) {
        break;
      }
    }
  }

  return id;
}

async function giftIdExists(connection, database, giftId) {
  const [rows] = await connection.query(
    `SELECT 1 FROM \`${database}\`.gifts WHERE gift_id = ? LIMIT 1`,
    [giftId]
  );

  return rows.length > 0;
}

async function generateUniqueGiftId(connection, database, seen) {
  while (true) {
    const giftId = generateGiftId(6);
    if (seen.has(giftId)) {
      continue;
    }

    if (!connection) {
      seen.add(giftId);
      return giftId;
    }

    const exists = await giftIdExists(connection, database, giftId);
    if (!exists) {
      seen.add(giftId);
      return giftId;
    }
  }
}

async function main() {
  const count = Number(getArg('--count', '1'));
  const amount = Number(getArg('--amount', '0'));
  const totalDollar = Number(getArg('--total-dollar', String(amount)));
  const database = getArg('--db', process.env.DB_NAME || 'settle_db_test');
  const host = getArg('--host', process.env.DB_HOST || '127.0.0.1');
  const port = Number(getArg('--port', process.env.DB_PORT || '3306'));
  const user = getArg('--user', process.env.DB_USER || 'root');
  const password = getArg('--password', process.env.DB_PASSWORD || '');
  const cryptoAsset = getArg('--crypto', 'USDT');
  const network = getArg('--network', 'TRC20');
  const apply = hasFlag('--apply');

  if (!Number.isInteger(count) || count <= 0) {
    throw new Error('--count must be a positive integer.');
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('--amount must be a positive number.');
  }

  if (!Number.isFinite(totalDollar) || totalDollar <= 0) {
    throw new Error('--total-dollar must be a positive number.');
  }

  assertDatabaseName(database, 'database name');

  let connection = null;
  if (apply) {
    connection = await mysql.createConnection({
      host,
      port,
      user,
      password,
      database,
    });
  }

  const seen = new Set();
  const gifts = [];

  try {
    for (let index = 0; index < count; index += 1) {
      const giftId = await generateUniqueGiftId(connection, database, seen);
      gifts.push({
        gift_id: giftId,
        amount_payable: amount,
        total_dollar: totalDollar,
        status: 'Successful',
        gift_status: 'Not claimed',
      });
    }

    console.log(`Generated ${count} paid gift(s).`);
    console.table(gifts);

    if (!apply) {
      console.log('Dry run only. Re-run with --apply to insert gifts and summaries.');
      console.log(JSON.stringify(gifts, null, 2));
      console.log('Gift ID array:');
      console.log(JSON.stringify(gifts.map((gift) => gift.gift_id), null, 2));
      return;
    }

    await connection.beginTransaction();

    for (const gift of gifts) {
      const [giftResult] = await connection.query(
        `
          INSERT INTO gifts (
            gift_id, gift_status, crypto, network, estimate_asset,
            amount_payable, estimate_amount, charges, crypto_amount,
            date, current_rate, merchant_rate, profit_rate,
            wallet_address, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?, ?, ?)
        `,
        [
          gift.gift_id,
          'Not claimed',
          cryptoAsset,
          network,
          cryptoAsset,
          amount,
          amount,
          0,
          null,
          null,
          null,
          0,
          null,
          'Successful',
        ]
      );

      await connection.query(
        `
          INSERT INTO summaries (
            transaction_type, total_dollar, total_naira, effort,
            merchant_id, transaction_id, ref_code, asset_price, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          'gift',
          totalDollar,
          amount,
          0,
          null,
          giftResult.insertId,
          gift.gift_id,
          null,
          'Successful',
        ]
      );
    }

    await connection.commit();

    console.log(`Inserted ${gifts.length} paid gifts into ${database}.`);
    console.log(JSON.stringify(gifts, null, 2));
    console.log('Gift ID array:');
    console.log(JSON.stringify(gifts.map((gift) => gift.gift_id), null, 2));
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch (_) {
        // Ignore rollback failure when no transaction is active.
      }
    }
    throw error;
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

main().catch((error) => {
  console.error(`Failed to generate gift ids: ${error.message}`);
  process.exit(1);
});
