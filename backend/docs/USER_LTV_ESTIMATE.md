# Expected User Lifetime Value (LTV) — Industry-Benchmark Estimate

There is currently no way to compute a real, measured LTV for 2Settle: the
end-user auth system (`users` / `user_identities`) has no link to the
transaction system (`payers` / `payment_sessions.payer_id`), so individual
users' repeat transactions can't be traced yet. Everything below is an
estimate built from public industry benchmarks for comparable platforms,
combined with 2Settle's own per-transaction margins from
[TRANSACTION_OVERHEAD.md](./TRANSACTION_OVERHEAD.md).

## Table of Contents

- [The Formula](#the-formula)
- [Inputs](#inputs)
- [Scenarios](#scenarios)
- [The Finding](#the-finding)
- [What Would Replace This Estimate](#what-would-replace-this-estimate)

---

## The Formula

```
LTV = avg net margin per transaction  x  transactions per year  x  expected lifespan (years)
```

## Inputs

**Expected lifespan.** 2Settle is a single-product tool (crypto-to-fiat payout
only, no savings/lending/cards). Single-product fintech apps see roughly 35%
annual attrition — multi-product "super apps" get down to ~5%, which is why
African fintechs are racing to bundle products.

```
lifespan = 1 / annual_churn_rate = 1 / 0.35 ~= 2.9 years
```

**Transaction frequency.** Remittance-sending households average ~6–7
transfers per year, but the distribution is bimodal: 54% send 1–4x/year, 30%
send 10+x/year (power senders).

**Net margin per transaction.** Taken from the basic-tier row of
`TRANSACTION_OVERHEAD.md`'s per-chain table (₦500 charge), since most
gifts/transfers are likely modest amounts:

| Chain | Net margin at basic tier |
|---|---:|
| BTC / bitcoin | -₦461 |
| ETH / ethereum | +₦186 |
| USDT-USDC / erc20 | -₦291 |
| BNB / bsc | +₦424 |
| USDT-USDC / bep20 | +₦422 |
| TRX / tron | +₦357 |
| USDT / trc20 | -₦1,824 |

## Scenarios

Using 2.9-year lifespan x 6.5 transactions/year:

| Scenario | Chain mix assumption | Avg margin/txn | Estimated LTV |
|---|---|---:|---:|
| Optimistic | Mostly BNB / ETH-native | +₦300 | **+₦5,655** |
| Blended | Even split across all 7 chains | -₦170 | **-₦3,204** |
| TRC20-heavy (realistic) | 60% TRC20, rest cheap chains | -₦972 | **-₦18,313** |

## The Finding

Unless the average user leans toward BNB / ETH / native-TRX rather than
TRC20, LTV is likely **negative** — the platform would be paying to serve its
most loyal users, not profiting from them. Under a TRC20-heavy mix, user
growth would be growing the loss, not the business. Fixing TRC20 pricing
(flagged in `TRANSACTION_OVERHEAD.md`) is a precondition for LTV to be
positive at all, not just a margin optimization.

## What Would Replace This Estimate

Linking `users.id` to `payer_id` / transaction history so real per-user
repeat-usage and retention can be measured directly, rather than assumed from
outside benchmarks that may not reflect how 2Settle's specific user base
actually behaves.

---

Sources:
[FinTech LTV / attrition benchmarks](https://jahandarpour.com/benchmarks/ltv-fintech-series-a) ·
[Remittance frequency data](https://www.migrationdataportal.org/themes/remittances-overview) ·
[Churn-to-lifespan formula](https://www.clv-calculator.com/using-the-retention-rate-to-calculate-average-lifetime-period/)

Captured 2026-08-02. Re-derive if the underlying per-transaction margins in
`TRANSACTION_OVERHEAD.md` change (e.g. after a TRC20 pricing fix).
