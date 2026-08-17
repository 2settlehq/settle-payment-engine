# Transaction Overhead

What it actually costs the platform to process a settled transaction, as distinct
from `charge_amount` (the fee charged *to the user*, i.e. revenue). This is the
model behind `pnpm run report:transaction-overhead`.

## Table of Contents

- [Revenue vs. Cost](#revenue-vs-cost)
- [Cost Components](#cost-components)
- [Estimated Cost Per Transaction](#estimated-cost-per-transaction)
- [Reference Network Fees by Blockchain](#reference-network-fees-by-blockchain)
- [Where Each Number Comes From](#where-each-number-comes-from)
- [Running the Report](#running-the-report)
- [Known Gaps](#known-gaps)

---

## Revenue vs. Cost

`charge-calculator.ts` computes `charge_amount` — a flat tiered fee (plus an
optional percentage) charged to the payer or deducted from the receiver's payout.
That's revenue. It says nothing about what the platform actually spent moving the
money, which is:

```
net_margin = charge_amount − settlement_fee − network_fee
```

Neither `settlement_fee` nor `network_fee` was tracked per-transaction before this
change — both values existed in memory during processing and were discarded.

## Cost Components

| Component | What it is | Tracked? |
|---|---|---|
| **Settlement fee** | Payout-provider fee (Mongoro's `fee` field) for the fiat bank transfer | Yes — `payment_sessions.settlement_fee` (migration `015_add_settlement_fee.sql`) |
| **Network fee** | Blockchain fee paid to sweep the deposit from its unique HD address to the hot wallet | Yes — derived from `sweep_transactions.gas_used`/`gas_price`, joined on `session_id` |
| **Rate spread** | `rates.buy_rate` vs `sell_rate` — the margin baked into the locked exchange rate | Not a cost; it's margin already, not itemized separately |
| **Price slippage** | Crypto price moving between rate lock (`created_at`) and actual sweep/settlement | Not tracked — usually small over the typical confirm→sweep window, but not zero |
| **Manual settlement fallback** | Telegram-alert → admin manually pays when Mongoro fails | Labor cost, not tracked in dollars |
| **Third-party API/RPC costs** | Infura, Etherscan/BscScan/TronGrid, CoinMarketCap, NUBAN | Fixed/amortized, not per-transaction |

The report below only accounts for settlement fee and network fee — the two that
are both real, per-transaction, and now capturable from data already in the system.

## Estimated Cost Per Transaction

No production database has enough real `settled` + swept history yet for the live
report to say anything meaningful. Until it does, `pnpm run report:transaction-overhead
-- --estimate` computes the same `revenue − network_fee − settlement_fee` model
using 2Settle's own fee tiers against the reference figures below — no database
required. Settlement fee is proxied from Paystack's public NIP transfer pricing
(₦10/₦25/₦50 by amount, +₦50 NTA 2025 stamp duty above ₦10,000) since Mongoro
doesn't publish a fee schedule.

| Tier | Charge | Example amount | Settlement fee (est.) |
|---|---|---|---|
| basic | ₦500 | ₦50,000 | ₦75 |
| standard | ₦1,000 | ₦500,000 | ₦100 |
| premium | ₦1,500 | ₦1,500,000 | ₦100 |

Net margin per tier × crypto/network (USD/NGN @ 1,363, captured 2026-08-02):

| Crypto | Network | Network fee | basic | standard | premium |
|---|---|---:|---:|---:|---:|
| BTC | bitcoin | ₦886 | **-₦461 (loss)** | +₦14 | +₦514 |
| ETH | ethereum | ₦239 | +₦186 | +₦661 | +₦1,161 |
| USDT/USDC | erc20 | ₦716 | **-₦291 (loss)** | +₦184 | +₦684 |
| BNB | bsc | ₦1 | +₦424 | +₦899 | +₦1,399 |
| USDT/USDC | bep20 | ₦3 | +₦422 | +₦897 | +₦1,397 |
| TRX | tron | ₦68 | +₦357 | +₦832 | +₦1,332 |
| USDT | trc20 | ₦2,249 | **-₦1,824 (loss)** | **-₦1,349 (loss)** | **-₦849 (loss)** |

**Headline finding:** USDT-TRC20 — almost certainly the most commonly used option
in a Nigerian remittance context — loses money at every fee tier under this
reference model. The flat network fee (~₦2,249, driven by Tron's 5-TRX bandwidth
reserve in `tron.sweeper.ts`, or $2–4 at market rate without energy rental) exceeds
the flat platform charge at every tier. BTC and ERC20 are marginal-to-losing at the
basic tier and only turn profitable from standard tier up. BSC (BEP20) and native
ETH/TRX/BNB transfers are profitable at every tier by a wide margin.

This changes the calculus for TRC20 specifically: either raise the basic/standard
charge for TRC20 transactions, add a percentage-based fee component
(`calculateCharges` already supports `percentageFeeRate`) so cost scales with
transaction size, or lean harder on Tron's energy rental path (already implemented
in the sweeper) to cut the ~₦2,249 network fee down toward the ~₦68 that a native
TRX transfer costs.

Re-run with `--ngn-rate` to reprice for a different exchange rate; the network fee
USD figures themselves are constants in `NETWORK_FEE_COMBOS` in the script.

## Reference Network Fees by Blockchain

Approximate fees as of **2026-08-02** — these move constantly (especially Ethereum
gas price), so treat them as a starting point, not a live figure. The report script
lets you override the native-asset price used for each chain's fee conversion via
`--btc-price` / `--eth-price` / `--bnb-price` / `--trx-price`.

| Chain | Native asset | Native price (USD) | Typical native transfer fee | Typical token transfer fee (ERC20/BEP20/TRC20) |
|---|---|---|---|---|
| Bitcoin | BTC | ~$63,200 | ~$0.65 / tx | n/a (BTC has no token standard here) |
| Ethereum | ETH | ~$1,850 | ~$0.10–$0.25 | ~$0.30–$0.75 (USDT/USDC ERC20, ~3x native gas) |
| BSC | BNB | ~$583 | <$0.01 (gas price ~0.05 gwei) | <$0.01–$0.02 (BEP20) |
| Tron | TRX | ~$0.33 | <$0.10 | ~$1.65 (5 TRX) — `tron.sweeper.ts`'s own bandwidth reserve when energy rental isn't active; $2–$4 if burned directly at market rate; near $0 with energy rental active |

Sources: [Blockchair BTC fee chart](https://blockchair.com/bitcoin/charts/average-transaction-fee-usd), [Ethereum gas fee guides](https://www.spydra.app/blog/ethereum-gas), [BscScan gas tracker](https://bscscan.com/gastracker), [TRON fee calculator](https://chaingateway.io/tools/tron-fee-calculator/), spot prices via CoinMarketCap/CoinGecko on the date above.

Bitcoin and Tron fees are cheap in USD terms but can be a meaningfully larger
percentage of a small NGN transfer than Ethereum or BSC fees are — worth watching
if `basic`-tier (₦100,000 and under) transfers skew toward those chains.

## Where Each Number Comes From

**Settlement fee** — persisted the moment a Mongoro webhook confirms settlement:

```ts
// settlement.service.ts — handleWebhook()
if (status === 'success') {
  await this.markSessionSettled(session.id, payload.fee);
  ...
}
```

`markSessionSettled` writes it straight to `payment_sessions.settlement_fee`.
Sandbox, self-settlement, and manual-admin settlement paths call
`markSessionSettled(sessionId)` with no fee — those rows keep `settlement_fee = NULL`
rather than a fabricated 0, since no real payout fee was charged in those flows.

**Network fee** — computed from `sweep_transactions`, not stored as a single
column, because the raw columns mean different things per chain (see each
chain's `sweeper/chains/*.sweeper.ts`):

- **Bitcoin**: `gas_used` already holds the *total fee in satoshis*; `gas_price`
  (sat/vByte) is informational only. `fee_BTC = gas_used / 1e8`.
- **Ethereum / BSC**: `gas_used` is gas units, `gas_price` is gwei.
  `fee_native = (gas_used × gas_price) / 1e9`.
- **Tron**: `gas_used` already holds the fee/reserve *in SUN*.
  `fee_TRX = gas_used / 1e6`.

The native fee is converted to USD using the chain's native-asset price, then to
the transaction's own `fiat_currency` using `payment_sessions.rate` — which is
fiat-per-USD for that transaction (the same relationship `charge-calculator.ts`
uses to derive `chargeUsd = fiatCharge / rate`).

A session can have more than one confirmed sweep leg (e.g. a native gas top-up
plus the token sweep itself), so the report sums fees across every `status =
'confirmed'` row for a given `session_id`.

## Running the Report

No database, pure reference calculator (see [Estimated Cost Per Transaction](#estimated-cost-per-transaction)):

```bash
pnpm run report:transaction-overhead -- --estimate
pnpm run report:transaction-overhead -- --estimate --csv
pnpm run report:transaction-overhead -- --estimate --ngn-rate 1400
```

Against real settled/swept data:

```bash
pnpm run report:transaction-overhead
pnpm run report:transaction-overhead -- --months 1 --csv
pnpm run report:transaction-overhead -- --all --csv --csv-path ./reports/overhead.csv
pnpm run report:transaction-overhead -- --btc-price 65000 --eth-price 1900 --bnb-price 600 --trx-price 0.34
pnpm run report:transaction-overhead -- --host YOUR_HOST --user YOUR_USER --password YOUR_PASSWORD --db YOUR_DB
```

Console output groups by `fiat_currency` and shows revenue, network fee,
settlement fee, and net margin. `--csv` exports one row per transaction with a
`has_sweep_record` / `has_settlement_fee` flag on each row — check those before
trusting a row's margin, since a missing record is reported as `null`, not
silently folded into the total as zero.

## Known Gaps

- **Pre-migration-015 rows** have `settlement_fee = NULL` — that fee was never
  captured for transactions settled before this change shipped.
- **Sessions without a confirmed sweep record** (sweeper disabled, legacy wallet
  pool in use, or sweep still pending/failed) report `network_fee = null`. The
  report calls this out in its summary notes rather than treating it as $0 cost.
- **Rate spread and price slippage are not itemized** — they're real but much
  smaller/harder to isolate than settlement and network fees, so they're
  documented above as context, not computed by the script.
