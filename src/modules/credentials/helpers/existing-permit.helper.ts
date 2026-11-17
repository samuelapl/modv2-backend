import * as crypto from 'crypto';
import { ApplicationStatus, CredentialStatus } from '@prisma/client';
import {
  AppBadRequestException,
  AppConflictException,
} from '../../../common/errors';

/**
 * Records the permit a driver held BEFORE this system as an authorized
 * credential WITHOUT a card (`cardIssued = false`): original number, dates and
 * categories, no printable card and no QR. A real card only appears when a
 * replacement / renewal / added category issues one that supersedes it.
 *
 * Must run inside a transaction. `app` is an APPROVED PRE_TRAINED application
 * loaded with `priorPermit` and `requestedCategories`.
 */
export async function createExistingPermitCredentialInTx(
  tx: any,
  params: {
    app: {
      id: string;
      driverProfileId: string;
      priorPermit: {
        permitNumber: string;
        issueDate: Date;
        expiryDate: Date;
      } | null;
      requestedCategories: { categoryId: string }[];
    };
    issuerUserId: string;
  },
) {
  const { app, issuerUserId } = params;
  const prior = app.priorPermit;
  if (!prior) {
    throw new AppBadRequestException(
      'CREDENTIAL_PRETRAINED_NO_PRIOR_PERMIT',
      {},
      'Pre-trained application has no existing permit record; cannot determine permit dates.',
    );
  }
  if (new Date(prior.expiryDate) <= new Date()) {
    const expiredDate = new Date(prior.expiryDate).toISOString().slice(0, 10);
    throw new AppBadRequestException(
      'CREDENTIAL_PRIOR_PERMIT_EXPIRED',
      { permit: prior.permitNumber, expiredDate },
      `Existing permit ${prior.permitNumber} expired on ${expiredDate}. An expired permit cannot be recorded; use the standard authorization workflow.`,
    );
  }

  // The permit's own number identifies the record, so it must be free.
  const clash = await tx.issuedCredential.findUnique({
    where: { credentialNumber: prior.permitNumber },
    select: { id: true },
  });
  if (clash) {
    throw new AppConflictException(
      'CREDENTIAL_PERMIT_NUMBER_IN_USE',
      { permit: prior.permitNumber },
      `Permit number ${prior.permitNumber} is already used by another credential.`,
    );
  }

  const credential = await tx.issuedCredential.create({
    data: {
      credentialNumber: prior.permitNumber,
      driverProfileId: app.driverProfileId,
      // Not a physical card: unique placeholders, never a signed QR payload.
      serialNumber: `EXISTING-${prior.permitNumber}`,
      qrHashSignature: `NO-CARD-${crypto.randomUUID()}`,
      cardIssued: false,
      issueDate: prior.issueDate,
      expiryDate: prior.expiryDate,
      status: CredentialStatus.ACTIVE,
      issuerUserId,
      activeRestrictions: [],
      categories: {
        create: app.requestedCategories.map((c) => ({
          categoryId: c.categoryId,
        })),
      },
    },
    select: { id: true, credentialNumber: true },
  });

  await tx.application.update({
    where: { id: app.id },
    data: {
      status: ApplicationStatus.APPROVED,
      currentStage: `Credential Issued — existing permit ${prior.permitNumber} (no card)`,
    },
  });

  await tx.auditLog.create({
    data: {
      userId: issuerUserId,
      action: 'RECORD_EXISTING_PERMIT',
      entityType: 'IssuedCredential',
      entityId: credential.id,
      newValue: {
        permitNumber: prior.permitNumber,
        applicationId: app.id,
        cardIssued: false,
        issueDate: prior.issueDate.toISOString(),
        expiryDate: prior.expiryDate.toISOString(),
      },
    },
  });

  return credential;
}
