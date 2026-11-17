import {
  ApplicationStatus,
  ApplicationType,
  CredentialStatus,
} from '@prisma/client';

/**
 * Where a driver stands with respect to an MoD driving permit. Drives which
 * choices the client offers. Always derived from records, never from a flag the
 * driver controls.
 */
export type PermitState =
  | 'NONE'
  | 'PENDING_VERIFICATION'
  | 'RETURNED'
  | 'EXISTING_PERMIT'
  | 'CARD_ISSUED';

export interface PermitStateResult {
  permitState: PermitState;
  /** The driver's current permit, when there is one. */
  permit: {
    id: string;
    credentialNumber: string;
    cardIssued: boolean;
    status: CredentialStatus;
    issueDate: Date;
    expiryDate: Date;
    categories: { id: string; code: string; name: string }[];
  } | null;
  /** The existing-permit application still in flight (declared or recorded). */
  declaration: {
    applicationId: string;
    applicationNumber: string;
    status: ApplicationStatus;
    declaredByDriver: boolean;
    reason: string | null;
  } | null;
}

/** Statuses of a PRE_TRAINED application that is still in flight. */
export const PENDING_PERMIT_STATUSES: ApplicationStatus[] = [
  ApplicationStatus.PENDING_VERIFICATION,
  ApplicationStatus.RETURNED_FOR_CORRECTION,
  ApplicationStatus.SUBMITTED,
  ApplicationStatus.SCREENING,
  ApplicationStatus.READY_FOR_APPROVAL,
];

export async function resolvePermitState(
  client: any,
  driver: { id: string; userId: string },
): Promise<PermitStateResult> {
  // Current permit: latest one not superseded by a later issue (else latest).
  const credentials = await client.issuedCredential.findMany({
    where: { driverProfileId: driver.id },
    orderBy: { issueDate: 'desc' },
    select: {
      id: true,
      credentialNumber: true,
      cardIssued: true,
      status: true,
      issueDate: true,
      expiryDate: true,
      categories: {
        select: { category: { select: { id: true, code: true, name: true } } },
      },
    },
  });
  const current =
    credentials.find((c: any) => c.status !== CredentialStatus.SUPERSEDED) ??
    credentials[0] ??
    null;

  if (current) {
    return {
      permitState: current.cardIssued ? 'CARD_ISSUED' : 'EXISTING_PERMIT',
      permit: {
        id: current.id,
        credentialNumber: current.credentialNumber,
        cardIssued: current.cardIssued,
        status: current.status,
        issueDate: current.issueDate,
        expiryDate: current.expiryDate,
        categories: current.categories.map((c: any) => c.category),
      },
      declaration: null,
    };
  }

  const pending = await client.application.findFirst({
    where: {
      driverProfileId: driver.id,
      type: ApplicationType.PRE_TRAINED,
      status: { in: PENDING_PERMIT_STATUSES },
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      applicationNumber: true,
      status: true,
      createdById: true,
      rejectionReason: true,
    },
  });
  if (!pending) return { permitState: 'NONE', permit: null, declaration: null };

  const declaredByDriver = pending.createdById === driver.userId;
  const returned = pending.status === ApplicationStatus.RETURNED_FOR_CORRECTION;
  return {
    // A returned officer-recorded case is the officer's to fix, not the driver's.
    permitState:
      returned && declaredByDriver ? 'RETURNED' : 'PENDING_VERIFICATION',
    permit: null,
    declaration: {
      applicationId: pending.id,
      applicationNumber: pending.applicationNumber,
      status: pending.status,
      declaredByDriver,
      reason: returned ? pending.rejectionReason : null,
    },
  };
}
