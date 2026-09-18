# Cryptographic Controls Policy: 2Settle Payment Engine

**Document owner:** Nyikwagh Moses, CTO
**Approved by:** Nyikwagh Moses, CTO or Iyanu Kayode, CEO
**Effective date:** 2026-02-20 (date this repository was created)
**Review cycle:** Revised on every material change to how data is encrypted, hashed, or signed, or annually if no such change has occurred
**Version:** 1.0

---

## 1. Purpose & Scope

This policy defines the required cryptographic standards for protecting data across the 2Settle Payment Engine, at rest, in transit, and in authentication. It applies uniformly to all data processed by the platform, including data introduced by any third-party integration, with no separate or weaker standard applied to partner-sourced data than to the platform's own data.

The standards in this policy (Section 3) are language-agnostic and apply regardless of implementation. The current platform (v1) is built in Node.js/TypeScript, and the "where implemented" file references below reflect that. **v2 of the platform is being rebuilt in Go**; once v2 is in production, this policy will be revised so those references point to the Go implementation, the algorithm choices themselves are not expected to change.

---

## 2. Roles & Responsibilities

| Role | Responsibility |
|---|---|
| Information Security Officer (Nyikwagh Moses, CTO) | Approves any change to an algorithm, key length, or cryptographic library used in production |
| Backup ISO (Iyanu Kayode, CEO) | Co-approval authority for policy changes, per the Information Security Policy |

No custom-built cryptographic primitives are used anywhere in the platform. All cryptographic operations use the runtime's standard cryptography library (currently Node.js's built-in `crypto` module, OpenSSL-backed) or well-established, audited packages (e.g., `jsonwebtoken`); the same rule applies to the v2 Go implementation, using Go's standard `crypto` package or equivalently audited libraries. Rolling a custom cipher, hash, or signature scheme is prohibited, in either implementation.

---

## 3. Approved Algorithms & Standards

| Use case | Algorithm | Where implemented |
|---|---|---|
| Encryption at rest (reversible) | AES-256-GCM (authenticated encryption, random 96-bit IV per operation, 128-bit auth tag) | `backend/src/utils/crypto.ts`, used for the HD wallet seed phrase |
| One-way hashing (secrets, tokens, codes) | SHA-256 | `backend/src/security/utils/crypto.ts`, used for API secret keys, OTP codes, refresh tokens |
| Request authentication (message integrity) | HMAC-SHA256 | `backend/src/security/services/hmac.service.ts`, merchant/API request signing |
| Session tokens | JWT, HMAC-SHA256 signed (HS256) | `backend/src/services/user-auth/services/token.service.ts`, short-lived access tokens |
| Random value generation | CSPRNG (`crypto.randomBytes`, `crypto.randomInt`) | API key/secret generation, OTP code generation, refresh token generation |
| Comparison of secret values | Constant-time comparison (`crypto.timingSafeEqual` / manual constant-time XOR) | Signature verification, to prevent timing attacks |
| Data in transit | TLS (production endpoint certificate via Let's Encrypt, auto-renewing) | Infrastructure layer, `api.2settle.io` |

**Prohibited:** MD5, SHA-1, DES/3DES, ECB mode, or any home-grown encoding presented as encryption. None of these are present in the codebase as of this policy's effective date; this line exists to keep it that way.

---

## 4. Encryption vs. Hashing: Why Each Is Used Where

- **Hashing (SHA-256)** is used wherever the original value never needs to be recovered, only verified: API secret keys, OTP codes, refresh tokens. The server stores only the hash; even a full database breach does not expose the original secret.
- **Encryption (AES-256-GCM)** is used only where the original value must be recoverable: the HD wallet seed phrase, which the service needs to decrypt in memory at startup to derive deposit addresses and sign sweep transactions. GCM mode is used specifically because it provides authenticated encryption, tampering with the ciphertext is detected, not just blocked from decrypting cleanly.
- **HMAC-SHA256** is used for authentication, not confidentiality: it proves a request came from someone holding the shared secret and wasn't altered in transit, without encrypting the request body itself (the request body is protected separately by TLS).

---

## 5. Key Management

| Key | Storage | Generation |
|---|---|---|
| `HD_SEED_ENCRYPTION_KEY` (encrypts the wallet seed) | Environment variable, stored separately from the encrypted seed itself so a leak of one does not expose the other | 32 random bytes (64 hex chars), via `generateEncryptionKey()` |
| `JWT_ACCESS_SECRET` (signs access tokens) | Environment variable | Generated with the platform's own `generateSecureToken()` helper (CSPRNG, `crypto.randomBytes`), not a guessed or reused value |
| `ADMIN_SECRET` (admin bearer auth) | Environment variable | Generated with the platform's own `generateEncryptionKey()`/`generateSecureToken()` helper (CSPRNG, `crypto.randomBytes`) |
| Merchant API secret keys | Server stores only `SHA256(secretKey)`; the raw secret is shown to the merchant once at creation and never persisted | `crypto.randomBytes`, via `generateApiKeyPair()` |

**Current state:** keys and secrets are held as environment variables (`.env` in development, environment configuration in production), not in a dedicated secrets manager or HSM. This is a reasonable starting point for the current scale, but is the main gap between "strong algorithms" (which this platform genuinely has) and "mature key management" (which is still basic).

**Key rotation:**
- Merchant API secrets: rotatable per-key by an administrator at any time (revoke and reissue).
- Refresh tokens: rotate automatically on every use (built into the auth flow, not a manual process).
- `HD_SEED_ENCRYPTION_KEY`, `JWT_ACCESS_SECRET`, `ADMIN_SECRET`: rotated on suspected compromise; there is no fixed calendar rotation schedule for these master secrets today.

---

## 6. Application to Third-Party Data

Any data received from or transmitted to a third-party integration (outbound calls to a partner's API, or inbound webhooks notifying of results) is subject to the same standards in this policy: transmitted only over TLS, and if persisted, protected using the same hashing/encryption rules in Sections 3 and 4 based on its classification (see the Information Security Policy, Section 5, for data classification tiers). No exception is made for the sensitivity or source of the data, or for which partner it belongs to.

---

## 7. Policy Review

This policy is revised on every material change to how data is encrypted, hashed, or signed (e.g., a new algorithm, a new integration introducing a new data flow, a key management change); if no such change has occurred, it is reviewed at least annually, on the same cycle as the Information Security Policy.

---

