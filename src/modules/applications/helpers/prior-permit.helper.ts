import {
  AppBadRequestException,
  AppConflictException,
} from '../../../common/errors';
import { ApplicationStatus, ApplicationType } from '@prisma/client';
import { calculateDriverAge, formatStageLabel } from './application-state.helper';

/** Raw prior-permit details as submitted by the registrar (single form or CSV row). */
export interface PriorPermitInput {
  categoryCodes: string[];
  permitNumber: string;
  issueDate: string;
  expiryDate: string;
  trainingReference?: string;
  documentUrl?: string;
}

/** Prior-permit details after validation, ready to persist. */
export interface ResolvedPriorPermit {
  categoryIds: string[];
  categoryCodes: string[];
  permitNumber: string;
  issueDate: Date;
  expiryDate: Date;
  trainingReference: string | null;
  documentUrl: string | null;
}

export interface PriorPermitLookup {
  /** Active vehicle categories keyed by upper-case code. */
  categoriesByCode: Map<string, { id: string; code: string; minAgeRequired: number }>;
  /** Permit numbers on record for a non-rejected application (upper-case). */
  takenPermitNumbers: Set<string>;
}

export function normalizePermitNumber(raw: string): string {
  return raw.trim().toUpperCase();
}

function normalizeCodes(codes: string[]): string[] {
  return Array.from(
    new Set(codes.map((c) => c.trim().toUpperCase()).filter(Boolean)),
  );
}

/**
 * Loads everything needed to validate one or many prior permits in a
 * single round-trip: the referenced categories and any permit numbers
 * that are already on record.
 */
export async function loadPriorPermitLookup(
  client: any,
  inputs: PriorPermitInput[],
  /** When correcting an application, its own permit number isn't a conflict. */
  excludeApplicationId?: string,
): Promise<PriorPermitLookup> {
  const codes = normalizeCodes(inputs.flatMap((i) => i.categoryCodes || []));
  const permitNumbers = Array.from(
    new Set(inputs.map((i) => normalizePermitNumber(i.permitNumber || '')).filter(Boolean)),
  );

  const [categories, existing] = await Promise.all([
    codes.length
      ? client.vehicleCategory.findMany({
          where: { code: { in: codes }, isActive: true },
          select: { id: true, code: true, minAgeRequired: true },
        })
      : Promise.resolve([]),
    permitNumbers.length
      ? client.priorPermit.findMany({
          // A rejected case frees its permit number so it can be recorded again.
          where: {
            permitNumber: { in: permitNumbers },
            application: { status: { not: ApplicationStatus.REJECTED } },
            ...(excludeApplicationId
              ? { applicationId: { not: excludeApplicationId } }
              : {}),
          },
          select: { permitNumber: true },
        })
      : Promise.resolve([]),
  ]);

  return {
    categoriesByCode: new Map(
      categories.map((c: any) => [c.code.toUpperCase(), c]),
    ),
    takenPermitNumbers: new Set(existing.map((p: any) => p.permitNumber)),
  };
}

/**
 * Validates prior-permit details. Rules:
 *  - at least one active category, and the driver meets each minimum age
 *  - permit number not already recorded
 *  - issue date is a real date, not in the future
 *  - expiry date is after the issue date and has NOT already passed
 *    (expired permits cannot be imported as pre-trained authorizations)
 */
export function resolvePriorPermit(
  input: PriorPermitInput,
  dateOfBirth: Date,
  lookup: PriorPermitLookup,
): ResolvedPriorPermit {
  const codes = normalizeCodes(input.categoryCodes || []);
  if (codes.length === 0) {
    throw new AppBadRequestException(
      'PRIOR_PERMIT_CATEGORY_REQUIRED',
      {},
      'Select at least one vehicle category held on the existing permit.',
    );
  }

  const unknown = codes.filter((c) => !lookup.categoriesByCode.has(c));
  if (unknown.length) {
    throw new AppBadRequestException(
      'PRIOR_PERMIT_UNKNOWN_CATEGORIES',
      { categories: unknown.join(', ') },
      `Unknown or inactive vehicle category: ${unknown.join(', ')}.`,
    );
  }

  const age = calculateDriverAge(dateOfBirth);
  const categories = codes.map((c) => lookup.categoriesByCode.get(c)!);
  for (const cat of categories) {
    if (age < cat.minAgeRequired) {
      throw new AppBadRequestException(
        'APPLICATION_DRIVER_BELOW_MIN_AGE',
        { age, minAge: cat.minAgeRequired, category: cat.code },
        `Driver age (${age}) is below minimum required age (${cat.minAgeRequired}) for ${cat.code}.`,
      );
    }
  }

  const permitNumber = normalizePermitNumber(input.permitNumber || '');
  if (!permitNumber) {
    throw new AppBadRequestException(
      'PRIOR_PERMIT_NUMBER_REQUIRED',
      {},
      'Existing permit number is required.',
    );
  }
  if (lookup.takenPermitNumbers.has(permitNumber)) {
    throw new AppConflictException(
      'PRIOR_PERMIT_ALREADY_RECORDED',
      { permit: permitNumber },
      `Existing permit ${permitNumber} is already recorded in the system.`,
    );
  }

  const issueDate = new Date(input.issueDate);
  const expiryDate = new Date(input.expiryDate);
  if (Number.isNaN(issueDate.getTime())) {
    throw new AppBadRequestException(
      'PRIOR_PERMIT_ISSUE_DATE_INVALID',
      {},
      'Invalid permit issue date (use YYYY-MM-DD).',
    );
  }
  if (Number.isNaN(expiryDate.getTime())) {
    throw new AppBadRequestException(
      'PRIOR_PERMIT_EXPIRY_DATE_INVALID',
      {},
      'Invalid permit expiry date (use YYYY-MM-DD).',
    );
  }

  const now = new Date();
  if (issueDate > now) {
    throw new AppBadRequestException(
      'PRIOR_PERMIT_ISSUE_DATE_IN_FUTURE',
      {},
      'Permit issue date cannot be in the future.',
    );
  }
  if (expiryDate <= issueDate) {
    throw new AppBadRequestException(
      'PRIOR_PERMIT_EXPIRY_BEFORE_ISSUE',
      {},
      'Permit expiry date must be after the issue date.',
    );
  }
  if (expiryDate <= now) {
    throw new AppBadRequestException(
      'PRIOR_PERMIT_EXPIRED',
      { permit: permitNumber, expiryDate: expiryDate.toISOString() },
      `Existing permit ${permitNumber} expired on ${expiryDate
        .toISOString()
        .slice(0, 10)}. Expired permits cannot be imported; use the standard authorization workflow.`,
    );
  }

  return {
    categoryIds: categories.map((c) => c.id),
    categoryCodes: categories.map((c) => c.code),
    permitNumber,
    issueDate,
    expiryDate,
    trainingReference: input.trainingReference?.trim() || null,
    documentUrl: input.documentUrl?.trim() || null,
  };
}

export async function generateApplicationNumber(
  client: any,
  offset = 0,
): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `APP-${year}-`;
  const latest = await client.application.findFirst({
    where: { applicationNumber: { startsWith: prefix } },
    orderBy: { applicationNumber: 'desc' },
    select: { applicationNumber: true },
  });

  const lastSeq = latest
    ? Number.parseInt(latest.applicationNumber.replace(prefix, ''), 10) || 0
    : 0;

  return `${prefix}${String(lastSeq + 1 + offset).padStart(5, '0')}`;
}

/** True when a Prisma unique violation was caused by the application number. */
export function isApplicationNumberCollision(err: any): boolean {
  if (err?.code !== 'P2002') return false;
  const target = err?.meta?.target;
  return String(Array.isArray(target) ? target.join(',') : target ?? '').includes(
    'applicationNumber',
  );
}

/**
 * Creates the PRE_TRAINED application (straight to READY_FOR_APPROVAL)
 * together with its prior-permit record. Must run inside a transaction.
 */
export async function createPreTrainedApplicationInTx(
  tx: any,
  params: {
    driverProfileId: string;
    createdById: string;
    prior: ResolvedPriorPermit;
    applicationNumber: string;
    /**
     * Driver self-declaration: the case waits for an officer to verify the
     * permit scan before it can go to command approval.
     */
    declaredByDriver?: boolean;
  },
) {
  const declared = params.declaredByDriver === true;
  const status = declared
    ? ApplicationStatus.PENDING_VERIFICATION
    : ApplicationStatus.READY_FOR_APPROVAL;
  const app = await tx.application.create({
    data: {
      applicationNumber: params.applicationNumber,
      driverProfileId: params.driverProfileId,
      type: ApplicationType.PRE_TRAINED,
      status,
      currentStage: `${formatStageLabel(status)} — ${declared ? 'declared' : 'existing'} permit ${params.prior.permitNumber}`,
      createdById: params.createdById,
      requestedCategories: {
        create: params.prior.categoryIds.map((categoryId) => ({ categoryId })),
      },
      priorPermit: {
        create: {
          permitNumber: params.prior.permitNumber,
          issueDate: params.prior.issueDate,
          expiryDate: params.prior.expiryDate,
          trainingReference: params.prior.trainingReference,
          documentUrl: params.prior.documentUrl,
        },
      },
    },
    select: {
      id: true,
      applicationNumber: true,
      status: true,
      type: true,
    },
  });

  await tx.auditLog.create({
    data: {
      userId: params.createdById,
      action: declared
        ? 'DECLARE_EXISTING_PERMIT'
        : 'CREATE_PRE_TRAINED_APPLICATION',
      entityType: 'Application',
      entityId: app.id,
      newValue: {
        applicationNumber: app.applicationNumber,
        driverProfileId: params.driverProfileId,
        permitNumber: params.prior.permitNumber,
        issueDate: params.prior.issueDate.toISOString(),
        expiryDate: params.prior.expiryDate.toISOString(),
        categories: params.prior.categoryCodes,
        trainingReference: params.prior.trainingReference,
      },
    },
  });

  return app;
}
