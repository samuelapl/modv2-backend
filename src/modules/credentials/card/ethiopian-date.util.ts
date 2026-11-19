/**
 * Dates for the printed card: Ethiopian calendar in Amharic (normal digits,
 * Amharic month name, "ዓ.ም") with the Gregorian date as plain digits.
 * The card never depends on the user's interface language.
 *
 * Conversion uses Julian Day Numbers, same algorithm as
 * frontend/src/lib/ethiopian-calendar/convert.ts. Dates are read as Addis Ababa
 * calendar days (UTC+3, no daylight saving).
 */

const ETHIOPIAN_EPOCH = 1724221;
const ADDIS_OFFSET_MS = 3 * 60 * 60 * 1000;

const EC_MONTHS_AM = [
  "መስከረም",
  "ጥቅምት",
  "ኅዳር",
  "ታኅሣሥ",
  "ጥር",
  "የካቲት",
  "መጋቢት",
  "ሚያዝያ",
  "ግንቦት",
  "ሰኔ",
  "ሐምሌ",
  "ነሐሴ",
  "ጳጉሜን",
];

/** ዓ.ም = Ethiopian era (Amete Mihret); እ.ኤ.አ = Gregorian era. */
export const EC_ERA = "ዓ.ም";
export const GC_ERA = "እ.ኤ.አ";

export interface CalendarDate {
  year: number;
  month: number; // 1-based
  day: number;
}

function addisParts(date: Date): CalendarDate {
  const d = new Date(date.getTime() + ADDIS_OFFSET_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  };
}

function gregorianToJdn({ year, month, day }: CalendarDate): number {
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  return (
    day +
    Math.floor((153 * m + 2) / 5) +
    365 * y +
    Math.floor(y / 4) -
    Math.floor(y / 100) +
    Math.floor(y / 400) -
    32045
  );
}

function ethiopianToJdn({ year, month, day }: CalendarDate): number {
  return (
    ETHIOPIAN_EPOCH -
    1 +
    365 * (year - 1) +
    Math.floor(year / 4) +
    30 * (month - 1) +
    day
  );
}

export function toEthiopian(date: Date): CalendarDate {
  const jdn = gregorianToJdn(addisParts(date));
  const year = Math.floor((4 * (jdn - ETHIOPIAN_EPOCH) + 1463) / 1461);
  const month =
    Math.floor((jdn - ethiopianToJdn({ year, month: 1, day: 1 })) / 30) + 1;
  const day = jdn - ethiopianToJdn({ year, month, day: 1 }) + 1;
  return { year, month, day };
}

/** "9 ጥቅምት 2019 ዓ.ም" */
export function formatEthiopian(date: Date): string {
  const { year, month, day } = toEthiopian(date);
  return `${day} ${EC_MONTHS_AM[month - 1]} ${year} ${EC_ERA}`;
}

/** "19/10/2026 እ.ኤ.አ" (day/month/year) */
export function formatGregorian(date: Date): string {
  const { year, month, day } = addisParts(date);
  const dd = String(day).padStart(2, "0");
  const mm = String(month).padStart(2, "0");
  return `${dd}/${mm}/${year} ${GC_ERA}`;
}
