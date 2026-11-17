import {
  PASSWORD_PATTERN,
  TEMP_PASSWORD_TTL_DAYS,
  generateTempPassword,
  tempPasswordExpiry,
} from './password.util';

describe('password utilities', () => {
  it('generated passwords always satisfy the password policy', () => {
    for (let i = 0; i < 200; i++) {
      const pw = generateTempPassword();
      expect(pw).toHaveLength(12);
      expect(PASSWORD_PATTERN.test(pw)).toBe(true);
    }
  });

  it('never produces look-alike characters (0 O 1 l I)', () => {
    for (let i = 0; i < 200; i++) {
      expect(generateTempPassword()).not.toMatch(/[0O1lI]/);
    }
  });

  it('is not repeatable', () => {
    const set = new Set(Array.from({ length: 100 }, () => generateTempPassword()));
    expect(set.size).toBe(100);
  });

  it('enforces a minimum length', () => {
    expect(generateTempPassword(3).length).toBeGreaterThanOrEqual(8);
  });

  it('policy needs a letter and a number', () => {
    expect(PASSWORD_PATTERN.test('abcdefgh')).toBe(false);
    expect(PASSWORD_PATTERN.test('12345678')).toBe(false);
    expect(PASSWORD_PATTERN.test('abcd1234')).toBe(true);
  });

  it('temporary passwords expire after the configured number of days', () => {
    const from = new Date('2026-01-01T00:00:00Z');
    expect(tempPasswordExpiry(from).getTime() - from.getTime()).toBe(
      TEMP_PASSWORD_TTL_DAYS * 24 * 60 * 60 * 1000,
    );
  });
});
