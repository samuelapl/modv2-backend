import { isoDate, toDateOnly, trainingDaysBetween } from './training-days';

describe('training-days helper', () => {
  it('formats Date as yyyy-mm-dd in UTC with isoDate', () => {
    const d = new Date('2026-11-20T15:30:00.000Z');
    expect(isoDate(d)).toBe('2026-11-20');
  });

  it('creates midnight UTC Date from yyyy-mm-dd with toDateOnly', () => {
    const d = toDateOnly('2026-11-20');
    expect(d.toISOString()).toBe('2026-11-20T00:00:00.000Z');
  });

  it('returns Monday to Friday dates inclusive, skipping weekends', () => {
    // 2026-11-16 is Monday, 2026-11-22 is Sunday
    const start = new Date('2026-11-16T08:00:00.000Z');
    const end = new Date('2026-11-22T17:00:00.000Z');
    const days = trainingDaysBetween(start, end);

    expect(days).toEqual([
      '2026-11-16', // Mon
      '2026-11-17', // Tue
      '2026-11-18', // Wed
      '2026-11-19', // Thu
      '2026-11-20', // Fri
    ]);
  });

  it('handles single weekday start and end', () => {
    const start = new Date('2026-11-18T00:00:00.000Z');
    const end = new Date('2026-11-18T23:59:59.000Z');
    expect(trainingDaysBetween(start, end)).toEqual(['2026-11-18']);
  });

  it('returns empty array when range is entirely on weekend', () => {
    // 2026-11-21 is Sat, 2026-11-22 is Sun
    const start = new Date('2026-11-21T00:00:00.000Z');
    const end = new Date('2026-11-22T00:00:00.000Z');
    expect(trainingDaysBetween(start, end)).toEqual([]);
  });
});
