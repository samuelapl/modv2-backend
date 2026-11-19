import type { CardData } from './card-data.builder';
import { formatEthiopian, formatGregorian } from './ethiopian-date.util';

const cardDate = (iso: string) => ({
  ec: formatEthiopian(new Date(iso)),
  gc: formatGregorian(new Date(iso)),
});

/** 1x1 PNG. Real QR generation is ~1.5 s per call inside jest, so tests use a stand-in. */
const PLACEHOLDER_QR =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/** Realistic card data for tests (and for previewing the template by hand). */
export async function sampleCardData(overrides: Partial<CardData> = {}): Promise<CardData> {
  return {
    serviceId: 'MOD-DEMO-006',
    nameEn: 'Kidist Mengistu Zewdie',
    nameAm: 'ክድስት መንግስቱ ዘውዴ',
    dateOfBirth: cardDate('1999-09-25T09:00:00Z'),
    bloodGroup: 'O+',
    directorate: 'MED-CORPS — Military Health & Ambulance Directorate',
    permitNumber: 'MOD-AUTH-2026-0006',
    issueDate: cardDate('2026-10-19T09:00:00Z'),
    expiryDate: cardDate('2029-10-19T09:00:00Z'),
    categories: [{ code: 'CAT-HV', name: 'Heavy Vehicle' }],
    serial: 'SN-MOD-2026-279BF8',
    issuingAuthority: {
      en: 'MoND Transport & Logistics Main Department',
      am: 'የመከላከያ ሚኒስቴር የትራንስፖርትና ሎጂስቲክስ ዋና መምሪያ',
    },
    qrDataUrl: PLACEHOLDER_QR,
    photoDataUri: null,
    ...overrides,
  };
}
