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
 * Categories are added to the driver's current permit, which must be in
 * force (active, not expired). The upgraded card replaces it.
 */
export function evaluateAdditionalCategory(
  permit: Awaited<ReturnType<typeof findRenewablePermit>>,
  now: Date = new Date(),
): { eligible: boolean; message: string; code?: ErrorCode; params?: ErrorParams } {
  if (!permit) {
    return {
      eligible: false,
      code: 'ADDITIONAL_CATEGORY_NO_PERMIT',
      params: {},
      message:
        'The driver has no MoD permit to add a category to. Use New Authorization.',
    };
  }
  if (permit.status === CredentialStatus.SUSPENDED) {
    return {
      eligible: false,
      code: 'ADDITIONAL_CATEGORY_PERMIT_SUSPENDED',
      params: { permit: permit.credentialNumber },
      message: `Permit ${permit.credentialNumber} is suspended. Lift the suspension before adding a category.`,
    };
  }
  if (permit.status === CredentialStatus.REVOKED) {
    return {
      eligible: false,
      code: 'ADDITIONAL_CATEGORY_PERMIT_REVOKED',
      params: { permit: permit.credentialNumber },
      message: `Permit ${permit.credentialNumber} was revoked. A new authorization is required.`,
    };
  }
  if (permit.status === CredentialStatus.EXPIRED || permit.expiryDate <= now) {
    return {
      eligible: false,
      code: 'ADDITIONAL_CATEGORY_PERMIT_EXPIRED',
      params: {
        permit: permit.credentialNumber,
        expiryDate: permit.expiryDate.toISOString(),
      },
      message: `Permit ${permit.credentialNumber} expired on ${fmt(permit.expiryDate)}. Renew it before adding a category.`,
    };
  }
  return {
    eligible: true,
    message: `New categories are added to permit ${permit.credentialNumber}. The upgraded card gets a new full validity period and replaces the current one.`,
  };
}

/**
 * Resolve the permit being upgraded and check the requested categories are
 * new ones. Throws when the upgrade isn't allowed.
 */
export async function resolveAdditionalCategoryPermit(
  client: Client,
  driverProfileId: string,
  requestedCategoryIds: string[],
  now?: Date,
) {
  const permit = await findRenewablePermit(client, driverProfileId);
  const verdict = evaluateAdditionalCategory(permit, now);
  if (!verdict.eligible) {
    throw new AppBadRequestException(
      verdict.code!,
      verdict.params ?? {},
      verdict.message,
    );
  }

  const held = new Map(
    permit!.categories.map((c) => [c.category.id, c.category.code]),
  );
  const alreadyHeld = requestedCategoryIds
    .filter((id) => held.has(id))
    .map((id) => held.get(id));
  if (alreadyHeld.length > 0) {
    throw new AppBadRequestException(
      'ADDITIONAL_CATEGORY_ALREADY_ON_PERMIT',
      {
        categories: alreadyHeld.join(', '),
        count: alreadyHeld.length,
        permit: permit!.credentialNumber,
      },
      `${alreadyHeld.join(', ')} ${alreadyHeld.length > 1 ? 'are' : 'is'} already on permit ${permit!.credentialNumber}. Request only new categories.`,
    );
  }

  return { permit: permit!, verdict };
}

/**
 * Categories that decide whether a medical is needed. For an upgrade the
 * whole merged card counts: its validity is reset, so the driver's fitness
 * must be re-checked for every category it will carry.
 */
export function categoriesForMedical<T extends { requiresMedical: boolean }>(
  requested: T[],
  heldOnUpgradedPermit: T[] = [],
): T[] {
  return [...requested, ...heldOnUpgradedPermit];
}
