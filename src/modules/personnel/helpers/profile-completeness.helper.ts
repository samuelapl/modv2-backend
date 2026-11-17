import { ProfileStatus } from '@prisma/client';

/**
 * Fields a driver must have before applying for a permit. One list, used by the
 * self-service endpoints, admin edits, and the application gate.
 * The photo is deliberately not here: it is uploaded with the application itself
 * (a 3 x 4 photo for the permit), not during onboarding.
 */
export const REQUIRED_PROFILE_FIELDS = [
  'dateOfBirth',
  'gender',
  'nationalIdNumber',
  'bloodGroup',
  'emergencyContactName',
  'emergencyContactPhone',
] as const;

export type RequiredProfileField = (typeof REQUIRED_PROFILE_FIELDS)[number];

export const MIN_DRIVER_AGE = 18;

export function calculateAge(dob: Date, today: Date = new Date()): number {
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
  return age;
}

type ProfileLike = Partial<Record<RequiredProfileField, unknown>>;

function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  return typeof value === 'string' && value.trim() === '';
}

/** Required fields that are still empty (a blank string counts as empty). */
export function missingProfileFields(profile: ProfileLike): RequiredProfileField[] {
  return REQUIRED_PROFILE_FIELDS.filter((field) => isBlank(profile[field]));
}

/**
 * Fields the driver cannot change themselves: filled in, and not typed in by
 * the driver (so an administrator supplied them, e.g. at registration).
 */
export function lockedProfileFields(
  profile: ProfileLike & { selfEnteredFields?: string[] | null },
): RequiredProfileField[] {
  const own = new Set(profile.selfEnteredFields ?? []);
  return REQUIRED_PROFILE_FIELDS.filter(
    (field) => !isBlank(profile[field]) && !own.has(field),
  );
}

/** Does the incoming value equal what is stored? (trimmed, case-insensitive for IDs, dates by day) */
export function sameProfileValue(
  field: RequiredProfileField,
  stored: unknown,
  incoming: unknown,
): boolean {
  if (field === 'dateOfBirth') {
    const a = stored ? new Date(stored as string | Date) : null;
    const b = incoming ? new Date(incoming as string) : null;
    if (!a || !b || Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return false;
    return a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);
  }
  const norm = (v: unknown) => String(v ?? '').trim().toUpperCase();
  return norm(stored) === norm(incoming);
}

export function isProfileComplete(profile: ProfileLike): boolean {
  return missingProfileFields(profile).length === 0;
}

export function profileStatusFor(profile: ProfileLike): ProfileStatus {
  return isProfileComplete(profile) ? ProfileStatus.COMPLETE : ProfileStatus.INCOMPLETE;
}
