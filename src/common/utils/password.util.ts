import { randomInt } from 'crypto';

/** Temporary (admin-issued) passwords stop working this many days after issue. */
export const TEMP_PASSWORD_TTL_DAYS = 7;

export const PASSWORD_MIN_LENGTH = 8;
/** At least one letter and one digit. Kept in one place so DTOs and tests agree. */
export const PASSWORD_PATTERN = /^(?=.*[A-Za-z])(?=.*\d).+$/;
export const PASSWORD_POLICY_MESSAGE = `Password must be at least ${PASSWORD_MIN_LENGTH} characters and contain a letter and a number.`;

// No look-alike characters (0/O, 1/l/I) because temp passwords are read out / printed.
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnpqrstuvwxyz';
const DIGITS = '23456789';
const SYMBOLS = '@#$%&*!?';

function pick(chars: string): string {
  return chars[randomInt(chars.length)];
}

/** Cryptographically random temporary password (length >= 8), always passing the policy. */
export function generateTempPassword(length = 12): string {
  const size = Math.max(length, PASSWORD_MIN_LENGTH);
  const all = UPPER + LOWER + DIGITS + SYMBOLS;
  const chars = [pick(UPPER), pick(LOWER), pick(DIGITS), pick(SYMBOLS)];
  while (chars.length < size) chars.push(pick(all));
  // Fisher-Yates shuffle so the guaranteed characters are not always first.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

export function tempPasswordExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + TEMP_PASSWORD_TTL_DAYS * 24 * 60 * 60 * 1000);
}
