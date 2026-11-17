import {
  AppBadRequestException,
  type ErrorCode,
  type ErrorParams,
} from '../../../common/errors';
import { CredentialStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

/** A permit can be renewed from 5 months before expiry until 5 months after. */
export const RENEWAL_WINDOW_MONTHS_BEFORE = 5;
export const RENEWAL_WINDOW_MONTHS_AFTER = 5;

export type RenewalState =
  | 'OPEN' // inside the window — can submit
  | 'NOT_YET' // window has not opened — a draft can be saved
  | 'CLOSED' // grace period over — needs a new authorization
  | 'NO_PERMIT' // never held a permit
  | 'BLOCKED'; // latest permit is suspended or revoked

type Client = PrismaService | Prisma.TransactionClient;

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  // Clamp to the last day of the target month (e.g. 31 Aug − 6 → 28/29 Feb).
  const lastDay = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
  ).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

export function renewalWindow(expiryDate: Date) {
  return {
    opensAt: addMonths(expiryDate, -RENEWAL_WINDOW_MONTHS_BEFORE),
    closesAt: addMonths(expiryDate, RENEWAL_WINDOW_MONTHS_AFTER),
  };
}

const fmt = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The driver's current permit for renewal purposes: the most recently issued
 * one that has not been superseded by a later issue.
 */
export async function findRenewablePermit(client: Client, driverProfileId: string) {
  return client.issuedCredential.findFirst({
    where: {
      driverProfileId,
      status: { not: CredentialStatus.SUPERSEDED },
    },
    orderBy: { issueDate: 'desc' },
    select: {
      id: true,
      credentialNumber: true,
      status: true,
      issueDate: true,
      expiryDate: true,
      categories: {
        select: { category: { select: { id: true, code: true, name: true } } },
      },
    },
  });
}

export type RenewablePermit = NonNullable<
  Awaited<ReturnType<typeof findRenewablePermit>>
>;

/** Where a permit stands relative to its renewal window. */
export function evaluateRenewal(
  permit: RenewablePermit | null,
  now: Date = new Date(),
): {
  state: RenewalState;
  message: string;
  code?: ErrorCode;
  params?: ErrorParams;
  opensAt?: Date;
  closesAt?: Date;
} {
  if (!permit) {
    return {
      state: 'NO_PERMIT',
      code: 'RENEWAL_NO_PERMIT',
      params: {},
      message:
        'The driver has no MoD permit to renew. Use New Authorization (or Pre-trained for an existing permit).',
    };
  }
  if (permit.status === CredentialStatus.REVOKED) {
    return {
      state: 'BLOCKED',
      code: 'RENEWAL_PERMIT_REVOKED',
      params: { permit: permit.credentialNumber },
      message: `Permit ${permit.credentialNumber} was revoked and cannot be renewed. A new authorization is required.`,
    };
  }
  if (permit.status === CredentialStatus.SUSPENDED) {
    return {
      state: 'BLOCKED',
      code: 'RENEWAL_PERMIT_SUSPENDED',
      params: { permit: permit.credentialNumber },
      message: `Permit ${permit.credentialNumber} is suspended. Lift the suspension before renewing.`,
    };
  }

  const { opensAt, closesAt } = renewalWindow(permit.expiryDate);
  if (now < opensAt) {
    return {
      state: 'NOT_YET',
      opensAt,
      closesAt,
      code: 'RENEWAL_NOT_YET_OPEN',
      params: {
        permit: permit.credentialNumber,
        opensDate: opensAt.toISOString(),
        months: RENEWAL_WINDOW_MONTHS_BEFORE,
        expiryDate: permit.expiryDate.toISOString(),
      },
      message: `Renewal for permit ${permit.credentialNumber} opens on ${fmt(opensAt)} (${RENEWAL_WINDOW_MONTHS_BEFORE} months before it expires on ${fmt(permit.expiryDate)}).`,
    };
  }
  if (now > closesAt) {
    return {
      state: 'CLOSED',
      opensAt,
      closesAt,
      code: 'RENEWAL_GRACE_PERIOD_ENDED',
      params: {
        permit: permit.credentialNumber,
        expiryDate: permit.expiryDate.toISOString(),
        months: RENEWAL_WINDOW_MONTHS_AFTER,
        closesDate: closesAt.toISOString(),
      },
      message: `Permit ${permit.credentialNumber} expired on ${fmt(permit.expiryDate)} and the ${RENEWAL_WINDOW_MONTHS_AFTER}-month renewal grace period ended on ${fmt(closesAt)}. A new authorization is required.`,
    };
  }
  return {
    state: 'OPEN',
    opensAt,
    closesAt,
    message:
      permit.expiryDate < now
        ? `Permit ${permit.credentialNumber} expired on ${fmt(permit.expiryDate)}; renewal is allowed until ${fmt(closesAt)}.`
        : `Permit ${permit.credentialNumber} expires on ${fmt(permit.expiryDate)}; renewal is open until ${fmt(closesAt)}.`,
  };
}

/**
 * Enforce renewal rules. The permit and its categories are always checked;
 * the date window only on submission, so a draft can be prepared early.
 */
export async function assertRenewalAllowed(
  client: Client,
  params: {
    driverProfileId: string;
    categoryIds: string[];
    checkWindow: boolean;
    now?: Date;
  },
) {
  const permit = await findRenewablePermit(client, params.driverProfileId);
  const verdict = evaluateRenewal(permit, params.now);

  if (verdict.state === 'NO_PERMIT' || verdict.state === 'BLOCKED') {
    throw new AppBadRequestException(
      verdict.code!,
      verdict.params ?? {},
      verdict.message,
    );
  }
  if (params.checkWindow && verdict.state !== 'OPEN') {
    throw new AppBadRequestException(
      verdict.code!,
      verdict.params ?? {},
      verdict.message,
    );
  }

  const held = new Map(
    permit!.categories.map((c) => [c.category.id, c.category.code]),
  );
  const notHeld = params.categoryIds.filter((id) => !held.has(id));
  if (notHeld.length > 0) {
    const codes = await client.vehicleCategory.findMany({
      where: { id: { in: notHeld } },
      select: { code: true },
    });
    throw new AppBadRequestException(
      'RENEWAL_CATEGORIES_NOT_ON_PERMIT',
      {
        permit: permit!.credentialNumber,
        heldCategories: [...held.values()].join(', '),
        missingCategories: codes.map((c) => c.code).join(', ') || 'unknown category',
      },
      `Renewal can only include categories on permit ${permit!.credentialNumber} (${[...held.values()].join(', ')}). Not on the permit: ${codes.map((c) => c.code).join(', ') || 'unknown category'}. Use Additional Category to add new ones.`,
    );
  }

  return { permit: permit!, verdict };
}
