/**
 * Whoever the identity check is attributed to when it is approved automatically
 * (at registration, at first sign-in, and by the seeds) instead of by an officer.
 * Shown in the UI as "Verified by SYSTEM".
 */
export const AUTO_IDENTITY_VERIFIER = 'SYSTEM';

/**
 * The identity-check stamp for a newly created driver profile. Every place that creates
 * a driver profile spreads this in, so a new driver starts with the identity check approved.
 * To go back to manual verification, make this return an empty object.
 */
export function autoVerifiedIdentity(now: Date = new Date()): {
  identityVerifiedAt: Date;
  identityVerifiedBy: string;
} {
  return { identityVerifiedAt: now, identityVerifiedBy: AUTO_IDENTITY_VERIFIER };
}
