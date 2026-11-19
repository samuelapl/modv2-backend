import { Prisma } from '@prisma/client';
import { formatEthiopian, formatGregorian } from './ethiopian-date.util';

/** What the card needs from the database, nothing more. */
export const CARD_CREDENTIAL_INCLUDE = {
  driverProfile: {
    select: {
      serviceNumber: true,
      rank: true,
      fullName: true,
      fullNameAm: true,
      dateOfBirth: true,
      bloodGroup: true,
      photoUrl: true,
      unit: { select: { code: true, name: true } },
    },
  },
  categories: {
    include: { category: { select: { code: true, name: true } } },
  },
} satisfies Prisma.IssuedCredentialInclude;

export type CardCredential = Prisma.IssuedCredentialGetPayload<{
  include: typeof CARD_CREDENTIAL_INCLUDE;
}>;

export interface CardDate {
  ec: string;
  gc: string;
}

/** Plain, render-ready data for the printed card. No behaviour, no database. */
export interface CardData {
  serviceId: string;
  nameEn: string;
  nameAm: string;
  dateOfBirth: CardDate;
  bloodGroup: string;
  directorate: string;
  permitNumber: string;
  issueDate: CardDate;
  expiryDate: CardDate;
  categories: { code: string; name: string }[];
  serial: string;
  issuingAuthority: { en: string; am: string };
  /** Signed token image (data URI). */
  qrDataUrl: string;
  /** Holder photo (data URI) or null → silhouette placeholder. */
  photoDataUri: string | null;
}

export interface CardExtras {
  qrDataUrl: string;
  photoDataUri: string | null;
  issuingAuthority: { en: string; am: string };
}

function cardDate(date: Date): CardDate {
  return { ec: formatEthiopian(date), gc: formatGregorian(date) };
}

/**
 * Credential → card data. Expects the statutory fields to be present (the
 * print flow checks `getMissingCardFields` first); blanks are never invented.
 */
export function buildCardData(cred: CardCredential, extras: CardExtras): CardData {
  const p = cred.driverProfile;
  const dob = p.dateOfBirth ? cardDate(p.dateOfBirth) : { ec: '', gc: '' };
  const unit = p.unit ? `${p.unit.code} — ${p.unit.name}` : '';

  return {
    serviceId: p.serviceNumber,
    nameEn: p.fullName,
    nameAm: p.fullNameAm?.trim() ?? '',
    dateOfBirth: dob,
    bloodGroup: p.bloodGroup ?? '',
    directorate: unit,
    permitNumber: cred.credentialNumber,
    issueDate: cardDate(cred.issueDate),
    expiryDate: cardDate(cred.expiryDate),
    categories: cred.categories.map((c) => ({
      code: c.category.code,
      name: c.category.name,
    })),
    serial: cred.serialNumber,
    issuingAuthority: extras.issuingAuthority,
    qrDataUrl: extras.qrDataUrl,
    photoDataUri: extras.photoDataUri,
  };
}
