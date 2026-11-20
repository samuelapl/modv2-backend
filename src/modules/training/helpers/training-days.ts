/** yyyy-mm-dd for a Date, in UTC (dates are stored as plain calendar dates). */
export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Midnight UTC for a yyyy-mm-dd string. */
export function toDateOnly(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

/**
 * The training days of a session: every Monday to Friday from the start date
 * to the end date, inclusive. Returned as yyyy-mm-dd strings, oldest first.
 */
export function trainingDaysBetween(start: Date, end: Date): string[] {
  const days: string[] = [];
  const last = toDateOnly(isoDate(end)).getTime();
  const cursor = toDateOnly(isoDate(start));
  // A session is at most a few months; the cap just guards against bad data.
  for (let i = 0; i < 400 && cursor.getTime() <= last; i++) {
    const dow = cursor.getUTCDay(); // 0 = Sunday, 6 = Saturday
    if (dow !== 0 && dow !== 6) days.push(isoDate(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}
