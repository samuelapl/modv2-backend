import {
  Injectable,
  Optional,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  AppBadRequestException,
  AppConflictException,
  AppForbiddenException,
  AppNotFoundException,
  AppUnprocessableException,
} from '../../common/errors';
import { ConfigService } from '@nestjs/config';
import {
  ApplicationStatus,
  ApplicationType,
  CredentialStatus,
  MedicalFitnessOutcome,
  PersonnelStatus,
} from '@prisma/client';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/paginated-result.dto';
import { Permission } from '../../common/enums/permissions.enum';
import { RequestUserContext } from '../personnel/services/drivers.service';
import { IssueCredentialDto } from './dto/issue-credential.dto';
import { QueryCredentialsDto } from './dto/query-credentials.dto';
import { QueryPendingIssuanceDto } from './dto/query-pending-issuance.dto';
import {
  credentialStatusWhere,
  effectiveCredentialStatus,
} from './helpers/credential-status.helper';
import { createExistingPermitCredentialInTx } from './helpers/existing-permit.helper';
import { resolveIssuingAuthority } from './helpers/issuing-authority';
import {
  getMissingCardFields,
  missingCardFieldsLabel,
} from './helpers/issuance-readiness.helper';

const DAY_MS = 24 * 60 * 60 * 1000;
const EXPIRING_SOON_DAYS = 90;
import {
  generateQrDataUrl,
  resolveQrSecret,
  signCredentialPayload,
  verifySignedQrToken,
} from './helpers/qr-signer.helper';
import { getEd25519PublicKeyInfo } from './helpers/ed25519.keys';

const INELIGIBLE_PERSONNEL: PersonnelStatus[] = [
  PersonnelStatus.SUSPENDED,
  PersonnelStatus.SEPARATED,
  PersonnelStatus.RETIRED,
];

const CREDENTIAL_INCLUDE = {
  driverProfile: {
    select: {
      id: true,
      userId: true,
      serviceNumber: true,
      fullName: true,
      fullNameAm: true,
      rank: true,
      bloodGroup: true,
      dateOfBirth: true,
      photoUrl: true,
      personnelStatus: true,
      unit: { select: { id: true, code: true, name: true } },
    },
  },
  categories: {
    include: {
      category: {
        select: { id: true, code: true, name: true, validityYears: true },
      },
    },
  },
  issuer: {
    select: { id: true, serviceNumber: true, fullName: true },
  },
  printedBy: {
    select: { id: true, serviceNumber: true, fullName: true },
  },
};

@Injectable()
export class CredentialsService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly configService?: ConfigService,
    @Optional() private readonly eventEmitter?: EventEmitter2,
  ) {}

  getStatus() {
    return {
      module: 'credentials',
      description: 'MoD Permit Issuance, Serials & Cryptographic QR',
      status: 'READY',
    };
  }

  private getQrSecret(): string {
    return resolveQrSecret(this.configService);
  }

  async getStats() {
    const now = new Date();
    const soon = new Date(now.getTime() + EXPIRING_SOON_DAYS * DAY_MS);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [awaiting, active, expiringSoon, inactive, issuedThisMonth] =
      await Promise.all([
        this.prisma.application.count({
          where: {
            status: ApplicationStatus.APPROVED,
            NOT: { currentStage: { startsWith: 'Credential Issued' } },
          },
        }),
        this.prisma.issuedCredential.count({
          where: { status: CredentialStatus.ACTIVE, expiryDate: { gte: now } },
        }),
        this.prisma.issuedCredential.count({
          where: {
            status: CredentialStatus.ACTIVE,
            expiryDate: { gte: now, lte: soon },
          },
        }),
        this.prisma.issuedCredential.count({
          where: {
            status: {
              in: [CredentialStatus.SUSPENDED, CredentialStatus.REVOKED],
            },
          },
        }),
        this.prisma.issuedCredential.count({
          where: { createdAt: { gte: monthStart } },
        }),
      ]);

    return {
      awaitingIssuance: awaiting,
      active,
      expiringSoon,
      suspendedOrRevoked: inactive,
      issuedThisMonth,
    };
  }

  async findPendingIssuance(query: QueryPendingIssuanceDto) {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    const where: any = {
      status: ApplicationStatus.APPROVED,
      NOT: {
        currentStage: { startsWith: 'Credential Issued' },
      },
    };

    if (query.type) where.type = query.type;
    if (query.categoryCode) {
      where.requestedCategories = {
        some: { category: { code: query.categoryCode.trim().toUpperCase() } },
      };
    }
    if (query.batchId) {
      where.trainingEnrollments = {
        some: { batchSession: { batchId: query.batchId } },
      };
    }

    if (query.search) {
      where.OR = [
        { applicationNumber: { contains: query.search, mode: 'insensitive' } },
        {
          driverProfile: {
            serviceNumber: { contains: query.search, mode: 'insensitive' },
          },
        },
        {
          driverProfile: {
            fullName: { contains: query.search, mode: 'insensitive' },
          },
        },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.application.findMany({
        where,
        include: {
          driverProfile: {
            select: {
              id: true,
              userId: true,
              serviceNumber: true,
              fullName: true,
              photoUrl: true,
              unit: { select: { id: true, code: true, name: true } },
            },
          },
          requestedCategories: {
            include: {
              category: {
                select: { id: true, code: true, name: true, validityYears: true },
              },
            },
          },
          medicalReviews: {
            orderBy: { assessmentDate: 'desc' },
            take: 1,
            select: {
              outcome: true,
              operationalRestrictions: true,
              reviewDueDate: true,
            },
          },
          approvals: {
            where: { action: 'APPROVED' },
            orderBy: { decisionDate: 'desc' },
            take: 1,
            select: {
              decisionDate: true,
              officer: {
                select: { serviceNumber: true, fullName: true },
              },
            },
          },
          priorPermit: {
            select: {
              permitNumber: true,
              issueDate: true,
              expiryDate: true,
            },
          },
          trainingEnrollments: {
            where: { batchSessionId: { not: null } },
            select: {
              categoryCode: true,
              batchSession: {
                select: { batch: { select: { id: true, batchCode: true } } },
              },
            },
          },
        },
        skip,
        take: limit,
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.application.count({ where }),
    ]);

    return new PaginatedResult(items, total, page, limit);
  }

  async findAll(query: QueryCredentialsDto, user: RequestUserContext) {
    const perms = new Set(user.resolvedPermissions || []);
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    const canViewAll =
      perms.has(Permission.CREDENTIALS_ISSUE) ||
      perms.has(Permission.CREDENTIALS_VERIFY_QR) ||
      perms.has(Permission.DRIVERS_VIEW_ALL);

    const where: any = {};
    if (!canViewAll) {
      where.driverProfile = { userId: user.id };
    }
    const andFilters: any[] = [];
    if (query.status) andFilters.push(credentialStatusWhere(query.status));
    if (query.driverProfileId) where.driverProfileId = query.driverProfileId;
    if (query.categoryCode) {
      where.categories = {
        some: { category: { code: query.categoryCode.trim().toUpperCase() } },
      };
    }
    if (query.expiry) {
      const now = new Date();
      const soon = new Date(now.getTime() + EXPIRING_SOON_DAYS * DAY_MS);
      where.expiryDate =
        query.expiry === 'EXPIRED'
          ? { lt: now }
          : query.expiry === 'EXPIRING_SOON'
            ? { gte: now, lte: soon }
            : { gt: soon };
    }
    if (query.restrictions === 'RESTRICTED') {
      where.activeRestrictions = { isEmpty: false };
    } else if (query.restrictions === 'UNRESTRICTED') {
      where.activeRestrictions = { isEmpty: true };
    }

    if (query.search) {
      where.OR = [
        { credentialNumber: { contains: query.search, mode: 'insensitive' } },
        { serialNumber: { contains: query.search, mode: 'insensitive' } },
        {
          driverProfile: {
            serviceNumber: { contains: query.search, mode: 'insensitive' },
          },
        },
        {
          driverProfile: {
            fullName: { contains: query.search, mode: 'insensitive' },
          },
        },
      ];
    }
    if (andFilters.length) where.AND = andFilters;

    const [rows, total] = await Promise.all([
      this.prisma.issuedCredential.findMany({
        where,
        include: CREDENTIAL_INCLUDE,
        skip,
        take: limit,
        orderBy: { issueDate: 'desc' },
      }),
      this.prisma.issuedCredential.count({ where }),
    ]);

    const items = await Promise.all(
      rows.map(async (row) => ({
        ...row,
        status: effectiveCredentialStatus(row.status, row.expiryDate),
        issuingAuthority: resolveIssuingAuthority(this.configService),
        // An existing permit has no card, hence no QR.
        qrDataUrl: row.cardIssued
          ? await generateQrDataUrl(row.qrHashSignature)
          : null,
      })),
    );

    return new PaginatedResult(items, total, page, limit);
  }

  async findOne(id: string, user: RequestUserContext) {
    const cred = await this.prisma.issuedCredential.findUnique({
      where: { id },
      include: CREDENTIAL_INCLUDE,
    });

    if (!cred) {
      throw new AppNotFoundException(
        'CREDENTIAL_NOT_FOUND',
        {},
        'Issued credential not found.',
      );
    }

    const perms = new Set(user.resolvedPermissions || []);
    const allowed =
      perms.has(Permission.CREDENTIALS_ISSUE) ||
      perms.has(Permission.CREDENTIALS_VERIFY_QR) ||
      perms.has(Permission.DRIVERS_VIEW_ALL) ||
      cred.driverProfile.userId === user.id;

    if (!allowed) {
      throw new AppForbiddenException(
        'CREDENTIAL_ACCESS_DENIED',
        {},
        'Access denied to this credential.',
      );
    }

    const qrDataUrl = cred.cardIssued
      ? await generateQrDataUrl(cred.qrHashSignature)
      : null;
    return {
      ...cred,
      status: effectiveCredentialStatus(cred.status, cred.expiryDate),
      issuingAuthority: resolveIssuingAuthority(this.configService),
      qrDataUrl,
    };
  }

  async issueFromApplication(
    dto: IssueCredentialDto,
    issuer: RequestUserContext,
  ) {
    const app = await this.prisma.application.findUnique({
      where: { id: dto.applicationId },
      include: {
        driverProfile: {
          include: {
            medicalReviews: {
              orderBy: { assessmentDate: 'desc' },
              take: 1,
            },
            suspensions: {
              where: { isActive: true },
            },
          },
        },
        requestedCategories: {
          include: { category: true },
        },
        priorPermit: true,
        replacesCredential: {
          include: { categories: { include: { category: true } } },
        },
      },
    });

    if (!app) {
      throw new AppNotFoundException(
        'CREDENTIAL_APPROVED_APPLICATION_NOT_FOUND',
        {},
        'Approved application not found.',
      );
    }

    // An upgrade adds categories to the permit it was opened against; that
    // permit must still be in force when the upgraded card is issued.
    const upgradedFrom =
      app.type === ApplicationType.ADDITIONAL_CATEGORY
        ? app.replacesCredential
        : null;
    if (
      upgradedFrom &&
      (upgradedFrom.status !== CredentialStatus.ACTIVE ||
        upgradedFrom.expiryDate <= new Date())
    ) {
      const state =
        upgradedFrom.expiryDate <= new Date() ? 'expired' : upgradedFrom.status;
      throw new AppBadRequestException(
        'CREDENTIAL_PERMIT_INACTIVE_CANNOT_ADD_CATEGORIES',
        { permit: upgradedFrom.credentialNumber, state },
        `Permit ${upgradedFrom.credentialNumber} is no longer active (${state}); categories can't be added to it. Renew or resolve the permit first.`,
      );
    }

    // A replacement re-issues the replaced permit as-is; it must still be in force.
    const replaced =
      app.type === ApplicationType.REPLACEMENT ? app.replacesCredential : null;
    if (app.type === ApplicationType.REPLACEMENT) {
      if (!replaced) {
        throw new AppBadRequestException(
          'CREDENTIAL_REPLACEMENT_NOT_LINKED_TO_PERMIT',
          {},
          'Replacement application is not linked to an existing permit.',
        );
      }
      if (
        replaced.status !== CredentialStatus.ACTIVE ||
        replaced.expiryDate <= new Date()
      ) {
        const state =
          replaced.expiryDate <= new Date() ? 'expired' : replaced.status;
        throw new AppBadRequestException(
          'CREDENTIAL_PERMIT_INACTIVE_CANNOT_REPLACE',
          { permit: replaced.credentialNumber, state },
          `Permit ${replaced.credentialNumber} is no longer active (${state}); it cannot be replaced. Use Renewal or resolve the permit status first.`,
        );
      }
    }

    if (app.status !== ApplicationStatus.APPROVED) {
      throw new AppBadRequestException(
        'CREDENTIAL_APPLICATION_NOT_APPROVED',
        { status: app.status },
        `Application must be APPROVED before credential issuance (current: ${app.status}).`,
      );
    }

    if (app.currentStage?.startsWith('Credential Issued')) {
      throw new AppConflictException(
        'CREDENTIAL_ALREADY_ISSUED_FOR_APPLICATION',
        {},
        'A credential has already been issued for this application.',
      );
    }

    if (app.driverProfile.userId === issuer.id) {
      throw new AppForbiddenException(
        'CREDENTIAL_ISSUER_SELF_ISSUE',
        {},
        'Separation of Duties: An issuer cannot issue a credential to themselves.',
      );
    }

    if (INELIGIBLE_PERSONNEL.includes(app.driverProfile.personnelStatus)) {
      throw new AppBadRequestException(
        'CREDENTIAL_DRIVER_STATUS_INELIGIBLE',
        { status: app.driverProfile.personnelStatus },
        `Cannot issue credential for driver with status ${app.driverProfile.personnelStatus}.`,
      );
    }

    if (app.driverProfile.suspensions.length > 0) {
      throw new AppBadRequestException(
        'CREDENTIAL_DRIVER_SUSPENDED',
        {},
        'Cannot issue credential while driver has an active suspension.',
      );
    }

    const latestMedical = app.driverProfile.medicalReviews[0];
    if (
      app.requestedCategories.some((rc) => rc.category.requiresMedical) &&
      latestMedical &&
      (latestMedical.outcome === MedicalFitnessOutcome.UNFIT ||
        latestMedical.outcome === MedicalFitnessOutcome.TEMPORARILY_UNFIT)
    ) {
      throw new AppBadRequestException(
        'CREDENTIAL_MEDICAL_CLEARANCE_BLOCKED',
        { outcome: latestMedical.outcome },
        `Driver medical clearance is ${latestMedical.outcome}. Issuance blocked.`,
      );
    }

    // Pre-trained drivers keep the permit they already hold: it is recorded as
    // an authorization with its original number and dates, but no card is
    // issued. (Normally done at command approval; this covers cases approved
    // before that change.)
    if (app.type === ApplicationType.PRE_TRAINED) {
      const recorded = await this.prisma.$transaction((tx) =>
        createExistingPermitCredentialInTx(tx, {
          app,
          issuerUserId: issuer.id,
        }),
      );
      const full = await this.prisma.issuedCredential.findUniqueOrThrow({
        where: { id: recorded.id },
        include: CREDENTIAL_INCLUDE,
      });
      return { ...full, qrDataUrl: null };
    }

    // From here a physical card will be issued: the statutory fields must exist.
    const missingFields = getMissingCardFields(app.driverProfile);
    if (missingFields.length > 0) {
      const fields = missingCardFieldsLabel(missingFields);
      throw new AppUnprocessableException(
        'CREDENTIAL_ISSUANCE_BLOCKED_MISSING_FIELDS',
        { fields },
        `Cannot issue the card: required driver details are missing (${fields}).`,
      );
    }

    // A renewal also replaces a permit that lapsed inside the grace period.
    const activeCreds = await this.prisma.issuedCredential.findMany({
      where: {
        driverProfileId: app.driverProfileId,
        status:
          app.type === ApplicationType.RENEWAL
            ? { in: [CredentialStatus.ACTIVE, CredentialStatus.EXPIRED] }
            : CredentialStatus.ACTIVE,
      },
      include: {
        categories: { include: { category: true } },
      },
    });

    const categoryMap = new Map<
      string,
      { id: string; code: string; validityYears: number }
    >();
    if (app.type === ApplicationType.ADDITIONAL_CATEGORY) {
      // Merge onto the permit being upgraded (older applications without a
      // link fall back to every active permit).
      const base = upgradedFrom ? [upgradedFrom] : activeCreds;
      for (const ac of base) {
        for (const item of ac.categories) {
          categoryMap.set(item.categoryId, item.category);
        }
      }
    }
    if (replaced) {
      for (const item of replaced.categories) {
        categoryMap.set(item.categoryId, item.category);
      }
    } else {
      for (const rc of app.requestedCategories) {
        categoryMap.set(rc.categoryId, rc.category);
      }
    }

    const endorsedCategories = Array.from(categoryMap.values());
    const minValidityYears =
      dto.validityYearsOverride ??
      (endorsedCategories.length > 0
        ? Math.min(...endorsedCategories.map((c) => c.validityYears))
        : 3);

    let issueDate = new Date();
    let expiryDate = new Date(issueDate);
    expiryDate.setFullYear(expiryDate.getFullYear() + minValidityYears);

    // Replacement: same validity as the permit it replaces — only the
    // number, serial and QR change.
    if (replaced) {
      issueDate = new Date(replaced.issueDate);
      expiryDate = new Date(replaced.expiryDate);
    }

    const activeRestrictions = replaced
      ? replaced.activeRestrictions
      : latestMedical?.operationalRestrictions || [];
    const secret = this.getQrSecret();
    // Numbering follows the year the credential is recorded in the system.
    const year = new Date().getFullYear();

    for (let attempt = 0; attempt < 5; attempt++) {
      const credentialNumber = await this.generateCredentialNumber(year, attempt);
      const serialNumber =
        dto.serialNumber?.trim().toUpperCase() ||
        `SN-MOD-${year}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

      const qrHashSignature = signCredentialPayload(
        {
          cred: credentialNumber,
          serial: serialNumber,
          drv: app.driverProfile.serviceNumber,
          name: app.driverProfile.fullName || undefined,
          nameAm: app.driverProfile.fullNameAm || undefined,
          rank: app.driverProfile.rank || undefined,
          cats: endorsedCategories.map((c) => c.code),
          iss: issueDate.toISOString(),
          exp: expiryDate.toISOString(),
        },
        secret,
      );

      try {
        const created = await this.prisma.$transaction(async (tx) => {
          if (activeCreds.length > 0) {
            await tx.issuedCredential.updateMany({
              where: { id: { in: activeCreds.map((c) => c.id) } },
              data: { status: CredentialStatus.SUPERSEDED },
            });
          }

          const cred = await tx.issuedCredential.create({
            data: {
              credentialNumber,
              driverProfileId: app.driverProfileId,
              serialNumber,
              issueDate,
              expiryDate,
              status: CredentialStatus.ACTIVE,
              qrHashSignature,
              issuerUserId: issuer.id,
              activeRestrictions,
              categories: {
                create: endorsedCategories.map((c) => ({ categoryId: c.id })),
              },
            },
            include: CREDENTIAL_INCLUDE,
          });

          await tx.application.update({
            where: { id: app.id },
            data: {
              currentStage: `Credential Issued — ${credentialNumber}`,
            },
          });

          await tx.auditLog.create({
            data: {
              userId: issuer.id,
              action: 'ISSUE_CREDENTIAL',
              entityType: 'IssuedCredential',
              entityId: cred.id,
              newValue: {
                credentialNumber,
                serialNumber,
                applicationId: app.id,
                categories: endorsedCategories.map((c) => c.code),
                ...(app.priorPermit
                  ? {
                      priorPermitNumber: app.priorPermit.permitNumber,
                      originalIssueDate: issueDate.toISOString(),
                      originalExpiryDate: expiryDate.toISOString(),
                    }
                  : {}),
                ...(replaced
                  ? {
                      replacesCredentialNumber: replaced.credentialNumber,
                      replacementReason: app.replacementReason,
                    }
                  : {}),
                ...(upgradedFrom
                  ? {
                      upgradedFromCredentialNumber: upgradedFrom.credentialNumber,
                      addedCategories: app.requestedCategories.map(
                        (rc) => rc.category.code,
                      ),
                    }
                  : {}),
              },
            },
          });

          return cred;
        });

        this.eventEmitter?.emit('credential.issued', {
          driverUserId: app.driverProfile.userId,
          credentialNumber: created.credentialNumber,
          categories: endorsedCategories.map((c) => c.code),
        });

        const qrDataUrl = await generateQrDataUrl(created.qrHashSignature);
        return { ...created, qrDataUrl };
      } catch (err: any) {
        if (err?.code === 'P2002' && attempt < 4) {
          continue;
        }
        throw err;
      }
    }
  }

  /**
   * Issues permits for many approved applications. Each one goes through the
   * full single-issue path (separation of duties, suspension / medical checks,
   * original dates for pre-trained permits), so a failure on one case is
   * reported without blocking the rest. Default validity and generated serial
   * numbers are used; cases needing a custom serial or validity override are
   * issued one at a time.
   */
  async bulkIssue(applicationIds: string[], issuer: RequestUserContext) {
    const ids = Array.from(new Set(applicationIds));
    const results: {
      applicationId: string;
      status: 'ISSUED' | 'FAILED';
      credentialId?: string;
      credentialNumber?: string;
      error?: string;
    }[] = [];

    // Sequential on purpose: credential numbers are allocated per issue.
    for (const applicationId of ids) {
      try {
        const cred = await this.issueFromApplication({ applicationId }, issuer);
        results.push({
          applicationId,
          status: 'ISSUED',
          credentialId: cred?.id,
          credentialNumber: cred?.credentialNumber,
        });
      } catch (err: any) {
        results.push({
          applicationId,
          status: 'FAILED',
          error: err?.response?.message
            ? String(err.response.message)
            : err?.message || 'Issuance failed.',
        });
      }
    }

    const issuedCount = results.filter((r) => r.status === 'ISSUED').length;
    return {
      totalRequested: ids.length,
      issuedCount,
      failedCount: ids.length - issuedCount,
      results,
    };
  }

  /** Which statutory card fields are still missing for this driver. */
  async getIssuanceReadiness(driverProfileId: string) {
    const profile = await this.prisma.driverProfile.findUnique({
      where: { id: driverProfileId },
      select: {
        serviceNumber: true,
        rank: true,
        bloodGroup: true,
        dateOfBirth: true,
        fullNameAm: true,
      },
    });
    if (!profile) {
      throw new AppNotFoundException(
        'CREDENTIAL_NOT_FOUND',
        {},
        'Driver profile not found.',
      );
    }
    const missing = getMissingCardFields(profile);
    return { ready: missing.length === 0, missing };
  }

  async verifyQrToken(token: string) {
    const secret = this.getQrSecret();
    const signatureCheck = verifySignedQrToken(token, secret);

    if (!signatureCheck.valid) {
      return {
        cryptographicValid: false,
        valid: false,
        status: 'INVALID_SIGNATURE',
        reason: 'Cryptographic QR signature check failed or token tampered.',
        credential: null,
      };
    }

    // Only real cards carry a QR; existing-permit records are never matched.
    const credential = await this.prisma.issuedCredential.findFirst({
      where: { qrHashSignature: token.trim(), cardIssued: true },
      include: CREDENTIAL_INCLUDE,
    });

    if (!credential) {
      // A genuine signature on a serial that was swapped by a supervisor
      // reprint: the physical card was replaced and this one is dead.
      const replaced = signatureCheck.payload?.serial
        ? await this.prisma.cardReprint.findUnique({
            where: { oldSerial: signatureCheck.payload.serial },
            select: { createdAt: true, reasonCode: true },
          })
        : null;
      if (replaced) {
        return {
          cryptographicValid: true,
          valid: false,
          status: 'CARD_REPLACED',
          reason: 'This card was replaced by a newer card and is no longer valid.',
          replacedAt: replaced.createdAt,
          credential: null,
        };
      }
      return {
        cryptographicValid: true,
        valid: false,
        status: 'NOT_FOUND',
        reason: 'Signed token does not match any registered credential.',
        credential: null,
      };
    }

    const isExpired = new Date(credential.expiryDate) <= new Date();
    const isActive = credential.status === CredentialStatus.ACTIVE && !isExpired;

    return {
      cryptographicValid: true,
      algorithm: signatureCheck.algorithm,
      version: signatureCheck.version,
      valid: isActive,
      status: isExpired ? CredentialStatus.EXPIRED : credential.status,
      isExpired,
      reason: isActive
        ? 'Valid active MoD driving authorization.'
        : `Credential is ${isExpired ? 'EXPIRED' : credential.status}.`,
      credential,
    };
  }

  getPublicKeyInfo() {
    return getEd25519PublicKeyInfo(this.configService);
  }

  private async generateCredentialNumber(
    year: number,
    offset = 0,
  ): Promise<string> {
    const prefix = `MOD-AUTH-${year}-`;
    const latest = await this.prisma.issuedCredential.findFirst({
      where: { credentialNumber: { startsWith: prefix } },
      orderBy: { credentialNumber: 'desc' },
      select: { credentialNumber: true },
    });

    const lastSeq = latest
      ? Number.parseInt(latest.credentialNumber.replace(prefix, ''), 10) || 0
      : 0;

    return `${prefix}${String(lastSeq + 1 + offset).padStart(4, '0')}`;
  }
}
