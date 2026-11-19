import { formatEthiopian, formatGregorian, toEthiopian } from './ethiopian-date.util';

describe('card dates', () => {
  it('writes 19 Oct 2026 as "9 ጥቅምት 2019 ዓ.ም" with the Gregorian date beside it', () => {
    const d = new Date('2026-10-19T09:00:00Z');
    expect(toEthiopian(d)).toEqual({ year: 2019, month: 2, day: 9 });
    expect(formatEthiopian(d)).toBe('9 ጥቅምት 2019 ዓ.ም');
    expect(formatGregorian(d)).toBe('19/10/2026 እ.ኤ.አ');
  });

  it('puts New Year on 11 Sep (12 Sep before a Gregorian leap year)', () => {
    expect(formatEthiopian(new Date('2026-09-11T09:00:00Z'))).toBe('1 መስከረም 2019 ዓ.ም');
    expect(formatEthiopian(new Date('2026-09-10T09:00:00Z'))).toBe('5 ጳጉሜን 2018 ዓ.ም');
    expect(formatEthiopian(new Date('2027-09-12T09:00:00Z'))).toBe('1 መስከረም 2020 ዓ.ም');
  });

  it('reads the date as an Addis Ababa day (UTC+3), not UTC', () => {
    // 22:00 UTC on 18 Oct is already 19 Oct in Addis Ababa.
    expect(formatGregorian(new Date('2026-10-18T22:00:00Z'))).toBe('19/10/2026 እ.ኤ.አ');
  });

  it('pads single-digit days and months in the Gregorian line', () => {
    expect(formatGregorian(new Date('2026-03-05T09:00:00Z'))).toBe('05/03/2026 እ.ኤ.አ');
  });
});
