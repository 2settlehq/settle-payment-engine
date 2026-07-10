/**
 * Phone number normalization.
 *
 * Numbers reach this codebase from several uncoordinated sources - OTP login
 * (whatever a client sends to /v1/users/auth/otp/request) and payment
 * creation (whatever a client sends as payer.phone/receiver.phone) - with no
 * shared format, so the same real-world number can be stored as
 * "08012345678", "+2348012345678", or "2348012345678" depending on which
 * flow wrote it.
 *
 * This app supports four markets (payment.schemas.ts FIAT_CURRENCIES: NGN,
 * GHS, KES, ZAR), and a bare local number (leading 0, no country code) is
 * structurally identical across all of them - "0801234567" could be
 * Nigerian, Ghanaian, Kenyan, or South African. There is no way to guess
 * which without an explicit country signal, so this module deliberately does
 * NOT guess a country for a bare local number - doing so would silently
 * cross-match one country's number to another's. It only reconciles
 * *formatting* differences (spaces/dashes/leading "+") for numbers that
 * already carry an explicit, recognized country code, and only derives a
 * local ("0"-prefixed) form from such a number - never the other direction.
 */

// Calling codes for this app's currently supported markets.
const KNOWN_CALLING_CODES = ['234', '233', '254', '27'];

/**
 * Loose E.164 shape: optional "+", first digit 1-9 (rejects a bare local
 * leading "0"), 7-15 digits total. Shared by OTP login and payment
 * payer/receiver phone fields so both require an explicit country code at
 * the point of input - the only real fix for the ambiguity described above,
 * since it prevents new bare-local numbers from entering the DB at all.
 */
export const PHONE_REGEX = /^\+?[1-9]\d{6,14}$/;

/**
 * Strips formatting to a plain digit string. Does not add or guess a
 * country code - a bare local number stays a bare local number.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  return digits || null;
}

/**
 * Expands a phone number into the formats it's plausibly stored as
 * elsewhere in the DB, for use in a SQL `IN (...)` match against columns we
 * can't normalize in-place. Only derives a local "0"-prefixed variant when
 * the input already carries a recognized country code (safe direction);
 * bare local input is returned as-is, unexpanded. Deduplicated.
 */
export function phoneVariants(raw: string | null | undefined): string[] {
  const normalized = normalizePhone(raw);
  if (!normalized) return [];

  const variants = new Set<string>([raw as string, normalized, `+${normalized}`]);

  const knownCode = KNOWN_CALLING_CODES.find((code) => normalized.startsWith(code));
  if (knownCode) {
    variants.add(`0${normalized.slice(knownCode.length)}`);
  }

  return [...variants];
}
