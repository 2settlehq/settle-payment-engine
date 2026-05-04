import pool from '../lib/mysql';
import { updateRateJob } from '../services/payment-engine/rate/update-rate-job';

async function main() {
  const rateIdRaw = process.env.RATE_ROW_ID;
  const rateId = rateIdRaw ? Number(rateIdRaw) : 1;

  if (!Number.isInteger(rateId) || rateId <= 0) {
    throw new Error(`Invalid RATE_ROW_ID value: ${rateIdRaw}`);
  }

  const result = await updateRateJob(rateId);

  console.log(
    `[RateUpdateJob] Success rateId=${result.rateId} current_rate=${result.currentRate} merchant_rate=${result.merchantRate} profit_rate=${result.profitRate}`
  );
}

main()
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[RateUpdateJob] Failed: ${message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
