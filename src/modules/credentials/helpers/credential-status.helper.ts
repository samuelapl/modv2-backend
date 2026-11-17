import { CredentialStatus } from '@prisma/client';

/**
 * The status a permit should be *shown* with right now.
 *
 * The nightly expiry sweep updates the stored status, but between the
 * moment a permit's expiry date passes and the next sweep the database
 * still says ACTIVE. This closes that gap so every response is correct
 * immediately.
 */
export function effectiveCredentialStatus(
  status: CredentialStatus,
  expiryDate: Date | string,
  now: Date = new Date(),
): CredentialStatus {
  if (status === CredentialStatus.ACTIVE && new Date(expiryDate) <= now) {
    return CredentialStatus.EXPIRED;
  }
  return status;
}

/** Prisma filter matching permits whose *effective* status equals `status`. */
export function credentialStatusWhere(status: CredentialStatus, now: Date = new Date()) {
  if (status === CredentialStatus.ACTIVE) {
    return { status: CredentialStatus.ACTIVE, expiryDate: { gt: now } };
  }
  if (status === CredentialStatus.EXPIRED) {
    return {
      OR: [
        { status: CredentialStatus.EXPIRED },
        { status: CredentialStatus.ACTIVE, expiryDate: { lte: now } },
      ],
    };
  }
  return { status };
}
