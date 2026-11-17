import {
  AppBadRequestException,
  type ErrorCode,
  type ErrorParams,
} from '../../../common/errors';
import { CredentialStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { findRenewablePermit } from './renewal.helper';

type Client = PrismaService | Prisma.TransactionClient;

const fmt = (d: Date) => d.toISOString().slice(0, 10);

/**
 * A card can only be replaced while the permit behind it is in force:
 * active and not yet expired. A suspended permit is excluded — issuing a
 * fresh ACTIVE card would sidestep the suspension.
 */
export function evaluateReplacement(
  permit: Awaited<ReturnType<typeof findRenewablePermit>>,
  now: Date = new Date(),
): { eligible: boolean; message: string; code?: ErrorCode; params?: ErrorParams } {
  if (!permit) {
    return {
      eligible: false,
      code: 'REPLACEMENT_NO_PERMIT',
      params: {},
      message:
        'The driver has no MoD permit to replace. Use New Authorization (or Pre-trained for an existing permit).',
    };
  }
  if (permit.status === CredentialStatus.SUSPENDED) {
    return {
      eligible: false,
      code: 'REPLACEMENT_PERMIT_SUSPENDED',
      params: { permit: permit.credentialNumber },
      message: `Permit ${permit.credentialNumber} is suspended. Lift the suspension before replacing the card.`,
    };
  }
  if (permit.status === CredentialStatus.REVOKED) {
    return {
      eligible: false,
      code: 'REPLACEMENT_PERMIT_REVOKED',
      params: { permit: permit.credentialNumber },
      message: `Permit ${permit.credentialNumber} was revoked and cannot be replaced.`,
    };
  }
  if (permit.status === CredentialStatus.EXPIRED || permit.expiryDate <= now) {
    return {
      eligible: false,
      code: 'REPLACEMENT_PERMIT_EXPIRED',
      params: {
        permit: permit.credentialNumber,
        expiryDate: permit.expiryDate.toISOString(),
      },
      message: `Permit ${permit.credentialNumber} expired on ${fmt(permit.expiryDate)}. Use Renewal instead of Replacement.`,
    };
  }
  return {
    eligible: true,
    message: `Replacement card for permit ${permit.credentialNumber}: same categories, valid until ${fmt(permit.expiryDate)}.`,
  };
}

/**
 * Resolve the permit a replacement copies. Throws when there is nothing
 * replaceable. The replacement's categories are always the permit's own.
 */
export async function resolveReplacementPermit(
  client: Client,
  driverProfileId: string,
  now?: Date,
) {
  const permit = await findRenewablePermit(client, driverProfileId);
  const verdict = evaluateReplacement(permit, now);
  if (!verdict.eligible) {
    throw new AppBadRequestException(
      verdict.code!,
      verdict.params ?? {},
      verdict.message,
    );
  }
  return {
    permit: permit!,
    categoryIds: permit!.categories.map((c) => c.category.id),
    verdict,
  };
}
