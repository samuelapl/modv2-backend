/**
 * Statutory card fields (Proclamation No. 1074/2018). A card is never issued or
 * printed while any of these is missing. One list, used by issuing, the
 * readiness endpoint and the print flow.
 */
export const REQUIRED_CARD_FIELDS = [
  'serviceNumber',
  'rank',
  'bloodGroup',
  'dateOfBirth',
  'fullNameAm',
] as const;

export type RequiredCardField = (typeof REQUIRED_CARD_FIELDS)[number];

/** English labels used in error messages. */
export const CARD_FIELD_LABELS: Record<RequiredCardField, string> = {
  serviceNumber: 'Military Service ID',
  rank: 'Military Rank',
  bloodGroup: 'Blood Group',
  dateOfBirth: 'Date of Birth',
  fullNameAm: 'Amharic Full Name',
};

type ProfileLike = Partial<Record<RequiredCardField, unknown>>;

function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  return typeof value === 'string' && value.trim() === '';
}

/** Required card fields that are still empty (a blank string counts as empty). */
export function getMissingCardFields(profile: ProfileLike): RequiredCardField[] {
  return REQUIRED_CARD_FIELDS.filter((field) => isBlank(profile[field]));
}

export function missingCardFieldsLabel(fields: RequiredCardField[]): string {
  return fields.map((f) => CARD_FIELD_LABELS[f]).join(', ');
}
