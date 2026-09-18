# Information Security Policy: 2Settle Payment Engine

**Document owner:** Nyikwagh Moses, CTO
**Information Security Officer (ISO):** Nyikwagh Moses, CTO
**Backup ISO:** Iyanu Kayode, CEO, Certified Cybersecurity Investigator (CCI)
**Approved by:** Nyikwagh Moses, CTO or Iyanu Kayode, CEO
**Effective date:** 2026-02-20 (date this repository was created)
**Review cycle:** Revised on every material architectural change to the platform, or annually if no such change has occurred
**Version:** 1.0

---

## 1. Purpose & Scope

This policy governs the security of all systems, data, and infrastructure that make up the 2Settle Payment Engine, the platform handling crypto-to-fiat transfers, gifts, payment requests, merchant payments, HD wallet custody, and end-user accounts (the `payment-engine` codebase and its production deployment).

It applies to:
- All source code, infrastructure configuration, and databases operated under this platform
- Anyone with access to production systems, secrets, or customer/merchant data: employees, contractors, and third-party integrators
- All third-party integrations (API partners, settlement providers, wallet infrastructure)

It does not currently cover:
- Corporate email and internal HR/office systems
- Personal devices used for non-production work
- Any other 2Settle/Sirfi product lines outside this repository

---

## 2. Ownership & Roles

| Role | Responsibility | Assigned to |
|---|---|---|
| Information Security Officer (ISO) | Owns this policy, approves security-relevant architecture decisions, is the point of contact for security incidents and vendor/partner due diligence questionnaires | Nyikwagh Moses, CTO |
| Backup ISO | Acts in the ISO's place during unavailability; must be empowered to make the same decisions | Iyanu Kayode, CEO, Certified Cybersecurity Investigator (CCI) |
| Engineering | Implements and maintains the technical controls described in this policy | Nyikwagh Moses, CTO |
| Policy approval authority | Approves changes to this document | Nyikwagh Moses, CTO or Iyanu Kayode, CEO |

This policy and any material change to it must be approved in writing by the above authority before taking effect.

---

## 3. Access Control

Access to production systems and secrets is limited to personnel who require it for their role.

- **Merchant/API-partner access** is scoped per API key with three components: a public key ID, a secret key (given to the partner once, never stored server-side in raw form), and a per-key permission list and rate-limit tier. Keys can be individually created, updated, or revoked by an administrator (`POST/GET/PATCH/DELETE /v1/admin/api-keys`).
- **Admin access** (key management, manual settlement) requires a bearer secret (`ADMIN_SECRET`) held only by authorized operators. [FILL IN: who holds this secret today, and the process for rotating it if someone with access leaves.]
- **End-user access** to their own account/data is via short-lived JWT access tokens (default 15-minute expiry) plus rotating, individually-revocable refresh tokens; no standing credentials are held client-side beyond the token pair.
- IP whitelisting (CIDR-aware) can be applied per API key to restrict which source IPs may use a given credential.

Access reviews: admin and API-key access is reviewed quarterly (who holds the `ADMIN_SECRET`, which API keys/merchants are active, and whether IP whitelists still match current infrastructure).

---

## 4. Authentication & Credential Management

- **End users** authenticate passwordlessly; no passwords are ever collected, transmitted, or stored for the end-user app. Supported methods: one-time codes over email/SMS, wallet-signature login (SIWE-style nonce + signature), and Google Sign-In (server-side ID token verification).
- **OTP codes** are single-use, expire after a configurable window (default 5 minutes), are rate-limited against resend abuse, are capped at a maximum verification-attempt count, and are stored only as a SHA-256 hash, never in plaintext.
- **Merchant/API credentials** use HMAC-SHA256 request signing. The server stores only `SHA256(secretKey)`; the raw secret is shown to the partner once at key creation and never persisted server-side. Every request must include a signed timestamp, and requests outside a 5-minute tolerance window are rejected (replay protection).
- **Refresh tokens** are opaque random values; only their SHA-256 hash is stored. Each refresh rotates the token (single-use) and old tokens are explicitly revoked. Users can revoke a single session (`logout`) or all sessions (`logout-all`).
- **No 2FA is applicable to passwords**, because no passwords exist on the end-user surface. Machine-to-machine (merchant) authentication is functionally two-factor in effect: possession of the secret key *and* the ability to compute a valid time-bound signature.

---

## 5. Data Classification & Handling

| Tier | Examples | Handling |
|---|---|---|
| **Secret material (never stored raw)** | API secret keys, OTP codes, refresh tokens, HD wallet seed phrase | Hashed (SHA-256) or encrypted (AES-256) at rest. The HD wallet seed is decrypted only in-memory at process start, using a separate encryption key (`HD_SEED_ENCRYPTION_KEY`) that is never stored alongside the encrypted seed, and is zeroed from memory on service shutdown. |
| **Financial/transactional data** | Payment sessions, fiat amounts/currency, crypto amounts/network, deposit addresses, exchange rates, settlement status | Stored in MySQL with parameterized queries throughout (no dynamic SQL construction); access limited to the application's DB credentials. |
| **Personal/counterparty data** | Payer identifiers, receiver bank name/account number/account name, user email/phone (hashed identity linkage), IP addresses in audit logs | Retained in line with the financial-record retention period in Section 7 (5 years), since this data is tied to the transaction records it supports. |
| **Card data** | N/A | Card payments are not supported. This platform processes crypto-to-fiat bank payouts only; no cardholder data (PAN, CVV, etc.) is collected or stored. PCI DSS is not applicable. |

Data is transmitted over TLS in production, via a Let's Encrypt certificate on the production endpoint (`api.2settle.io`) with auto-renewal configured.

---

## 6. Network & Infrastructure Security

- **Application layer:** every request passes through mandatory middleware: HMAC signature verification, rate limiting (100/1,000/10,000 req/min by tier, sliding window), IP whitelist enforcement, audit logging, and security headers (`X-Content-Type-Options`, `X-Frame-Options: DENY`, restrictive CSP, HSTS in production, no-cache directives, `X-Powered-By` removed).
- **Infrastructure layer:** the production API sits behind a reverse proxy (Apache) running `mod_evasive` (DoS/threshold-based IP blocking) and `mod_security2` (WAF that blocks SQLi/XSS/known scanner user agents), with a request body size cap and TLS termination via a Let's Encrypt certificate with auto-renewal.
- **Patching:** Host OS is AlmaLinux 9.8 ("Olive Jaguar"), RHEL-compatible, vendor-supported through 2032-06-01. Security patches are applied via `yum`/`dnf`. [FILL IN: confirm actual cadence, e.g., monthly maintenance window or applied on release of a security advisory.]

---

## 7. Monitoring & Logging

- Every API request (except health checks) is written to an audit log: request ID, derived action, resource type/ID, HTTP method/path, client IP, user agent, a hash of the request body (not the raw body, to avoid storing sensitive payloads), response status code, response time, and, where authenticated, the API key ID and merchant ID. Errors are captured with code and message.
- Logging is asynchronous and does not block the response path.
- The deposit watcher independently monitors on-chain activity per network (Bitcoin via Blockstream, Ethereum via Etherscan, BSC via BscScan, Tron via TronGrid) and applies fraud checks: zero-confirmation rejection, replace-by-fee (RBF) detection, fake-token filtering, dust filtering, and amount-tolerance validation.
- Failed settlements trigger automated Telegram alerts for manual intervention.
- **Log review:** High-priority events (failed settlements, deposit-watcher fraud flags) are alerted in real time via Telegram. The full audit log is manually reviewed weekly by the ISO for anomalies not caught by automated alerts (e.g., unusual rate-limit/IP-whitelist rejection patterns).
- **Retention:** Financial/transactional records (payment sessions, settlement data) are retained for a minimum of 5 years, consistent with standard AML/CFT and financial recordkeeping expectations for payment businesses. Technical audit logs (request-level: IPs, timestamps, response codes) are retained for 12 months on a rolling basis, extended if a record is relevant to an open investigation. [FILL IN: confirm against your legal/compliance counsel, this is a reasonable default, not a regulatory citation.]

---

## 8. Incident Response

1. **Detection:** automated failed-settlement Telegram alerts, deposit-watcher fraud flags, rate-limit/IP-whitelist rejections visible in audit logs.
2. **Triage & containment:** owned by the ISO (Nyikwagh Moses, CTO), the only holder of production access. Target response: within 1 hour of confirming a real incident during business hours, best-effort outside business hours. Containment actions available in practice: revoke/rotate the affected API key via the admin API, rotate `ADMIN_SECRET`, add/remove IP whitelist entries, or take the affected credential/endpoint offline.
3. **Internal notification:** the engineering function is currently one person (the ISO), so there is no internal team beyond the ISO to notify. The ISO notifies the Backup ISO (Iyanu Kayode, CEO), as the first stakeholder outside the person handling triage, directly (call/message, not just a written report) as soon as an incident is confirmed, same day, especially where funds or partner/customer data are affected.
4. **External notification:**
   - **Affected partners/integrators** (any partner whose data or integration is impacted): notified within 24 hours of confirmed impact.
   - **Data subjects / regulator (NDPR)**: notified within 72 hours of becoming aware, where the incident is likely to pose risk to individuals' rights or data.
   - **Law enforcement**: contacted only where theft, fraud, or unauthorized fund movement is suspected, reported jointly by the ISO and Backup ISO.
   All external notifications and the reasoning behind them are documented as part of the post-incident review below.
5. **Post-incident review:** within 5 business days of an incident being resolved, the ISO documents a short written retrospective covering root cause, timeline, what was affected, remediation taken, and any policy/control changes needed. It is reviewed by the approval authority (Section 2) and any resulting control changes are rolled into this policy at the next revision.

A minimum-viable version of this section is enough to honestly answer any partner due-diligence question about incident escalation procedures; it doesn't need to be elaborate, but it does need real names/thresholds rather than placeholders before this document is shared externally.

---

## 9. Third-Party / Vendor Risk

- Inbound integrations (merchants/partners) are only granted access via scoped, individually-revocable API keys with per-key rate limits and optional IP whitelisting; no shared or standing credentials.
- Outbound integrations (settlement, exchange-rate/price providers, blockchain explorer APIs) are called over authenticated HTTPS; credentials for these are held as environment configuration, not committed to source.
- New third-party integrations are expected to go through a due-diligence exchange like this one before data or API access is granted.

---

## 10. Policy Review

This policy is revised on every material change to the platform's architecture, authentication model, or infrastructure; if no such change has occurred, it is reviewed at least annually. The ISO is responsible for initiating the review and routing approved changes to the approval authority in Section 2 (CTO or CEO).

---
