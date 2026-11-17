import { ProfileStatus } from '@prisma/client';

/**
 * Fields a driver must have before applying for a permit. One list, used by the
 * self-service endpoints, admin edits, and the application gate.
 */
export const REQUIRED_PROFILE_FIELDS = [
  'dateOfBirth',
  'gender',
  'nationalIdNumber',
  'bloodGroup',
  'emergencyContactName',
  'emergencyContactPhone',
  'photoUrl',
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

/** Required fields that are still empty (a blank string counts as empty). */
export function missingProfileFields(profile: ProfileLike): RequiredProfileField[] {
  return REQUIRED_PROFILE_FIELDS.filter((field) => {
    const value = profile[field];
    if (value === null || value === undefined) return true;
    if (typeof value === 'string' && value.trim() === '') return true;
    return false;
  });
}

export function isProfileComplete(profile: ProfileLike): boolean {
  return missingProfileFields(profile).length === 0;
}

export function profileStatusFor(profile: ProfileLike): ProfileStatus {
  return isProfileComplete(profile) ? ProfileStatus.COMPLETE : ProfileStatus.INCOMPLETE;
}
