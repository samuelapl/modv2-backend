import {
  Injectable,
  Inject,
} from '@nestjs/common';
import {
  AppBadRequestException,
  AppConflictException,
  AppForbiddenException,
  AppNotFoundException,
} from '../../common/errors';
import { VerificationStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/paginated-result.dto';
import { Permission } from '../../common/enums/permissions.enum';
import { RequestUserContext } from '../personnel/services/drivers.service';
import {
  INationalLicenseVerifier,
  LICENSE_VERIFIER_TOKEN,
} from './interfaces/license-verifier.interface';
import { RecordLicenseDto } from './dto/record-license.dto';
import { VerifyLicenseDto } from './dto/verify-license.dto';
import { QueryLicensesDto } from './dto/query-licenses.dto';

@Injectable()
export class NationalLicenseService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(LICENSE_VERIFIER_TOKEN)
    private readonly verifier: INationalLicenseVerifier,
  ) {}

  getStatus() {
    return {
      module: 'national-license',
      description: 'National Driving License Capture & Verification',
      status: 'READY',
    };
  }

  /** Row-level scope shared by the list and stats queries. */
  private scopeWhere(user: RequestUserContext, unitId?: string): any | null {
    const perms = new Set(user.resolvedPermissions || []);
    if (
      perms.has(Permission.NATIONAL_DL_VERIFY) ||
      perms.has(Permission.DRIVERS_VIEW_ALL)
    ) {
      return unitId ? { driverProfile: { unitId } } : {};
    }
    if (perms.has(Permission.DRIVERS_VIEW_UNIT)) {
      if (!user.unitId) return null;
      return { driverProfile: { unitId: user.unitId } };
    }
    return { driverProfile: { userId: user.id } };
  }

  async getStats(user: RequestUserContext) {
    const scope = this.scopeWhere(user);
    const zero = { pending: 0, verified: 0, rejected: 0, expiringSoon: 0, expired: 0 };
    if (!scope) return zero;

    const now = new Date();
    const soon = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
    const [pending, verified, rejected, expiringSoon, expired] = await Promise.all([
      this.prisma.nationalLicense.count({
        where: { ...scope, verificationStatus: VerificationStatus.UNVERIFIED },
      }),
      this.prisma.nationalLicense.count({
        where: {
          ...scope,
          verificationStatus: VerificationStatus.VERIFIED,
          expiryDate: { gte: now },
        },
      }),
      this.prisma.nationalLicense.count({
        where: { ...scope, verificationStatus: VerificationStatus.REJECTED },
      }),
      this.prisma.nationalLicense.count({
        where: { ...scope, expiryDate: { gte: now, lte: soon } },
      }),
      this.prisma.nationalLicense.count({
        where: { ...scope, expiryDate: { lt: now } },
      }),
    ]);
    return { pending, verified, rejected, expiringSoon, expired };
  }

  async findAll(query: QueryLicensesDto, user: RequestUserContext) {
    const perms = new Set(user.resolvedPermissions || []);
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (
      perms.has(Permission.NATIONAL_DL_VERIFY) ||
      perms.has(Permission.DRIVERS_VIEW_ALL)
    ) {
      if (query.unitId) {
        where.driverProfile = { unitId: query.unitId };
      }
    } else if (perms.has(Permission.DRIVERS_VIEW_UNIT)) {
      if (!user.unitId) return new PaginatedResult([], 0, page, limit);
      where.driverProfile = { unitId: user.unitId };
    } else {
      where.driverProfile = { userId: user.id };
    }

    if (query.status) {
      where.verificationStatus = query.status;
    }

    if (query.expiringWithinDays) {
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() + query.expiringWithinDays);
      where.expiryDate = { lte: targetDate };
    }

    if (query.expiry) {
      const now = new Date();
      const soon = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
      where.expiryDate =
        query.expiry === 'EXPIRED'
          ? { lt: now }
          : query.expiry === 'EXPIRING_SOON'
            ? { gte: now, lte: soon }
            : { gt: soon };
    }
    if (query.issuingAuthority) {
      where.issuingAuthority = query.issuingAuthority;
    }
    if (query.category) {
      where.categories = { has: query.category };
    }

    if (query.search) {
      where.OR = [
        { licenseNumber: { contains: query.search, mode: 'insensitive' } },
        { issuingAuthority: { contains: query.search, mode: 'insensitive' } },
        {
          driverProfile: {
            OR: [
              { fullName: { contains: query.search, mode: 'insensitive' } },
              { serviceNumber: { contains: query.search, mode: 'insensitive' } },
            ],
          },
        },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.nationalLicense.findMany({
        where,
        include: {
          driverProfile: {
            select: {
              id: true,
              serviceNumber: true,
              fullName: true,
              photoUrl: true,
              unitId: true,
              unit: { select: { id: true, code: true, name: true } },
            },
          },
        },
        skip,
        take: limit,
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.nationalLicense.count({ where }),
    ]);

    // Resolve reviewer names (verifiedByUserId has no relation in the schema).
    const reviewerIds = [
      ...new Set(items.map((i) => i.verifiedByUserId).filter(Boolean) as string[]),
    ];
    const reviewers = reviewerIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: reviewerIds } },
          select: { id: true, serviceNumber: true, fullName: true },
        })
      : [];
    const reviewerById = new Map(reviewers.map((r) => [r.id, r]));
    const withReviewer = items.map((i) => ({
      ...i,
      verifiedBy: i.verifiedByUserId
        ? reviewerById.get(i.verifiedByUserId) ?? null
        : null,
    }));

    return new PaginatedResult(withReviewer, total, page, limit);
  }

  async findByDriverId(driverProfileId: string, user: RequestUserContext) {
    const perms = new Set(user.resolvedPermissions || []);
    const license = await this.prisma.nationalLicense.findUnique({
      where: { driverProfileId },
      include: {
        driverProfile: {
          select: {
            id: true,
            userId: true,
            serviceNumber: true,
            fullName: true,
            unitId: true,
            unit: { select: { id: true, code: true, name: true } },
          },
        },
      },
    });

    if (!license) {
      throw new AppNotFoundException(
        'NATIONAL_LICENSE_NOT_RECORDED',
        {},
        'National driving license not recorded yet.',
      );
    }

    const allowed =
      perms.has(Permission.NATIONAL_DL_VERIFY) ||
      perms.has(Permission.DRIVERS_VIEW_ALL) ||
      (perms.has(Permission.DRIVERS_VIEW_UNIT) &&
        license.driverProfile.unitId === user.unitId) ||
      license.driverProfile.userId === user.id;

    if (!allowed) {
      throw new AppForbiddenException(
        'NATIONAL_LICENSE_ACCESS_DENIED',
        {},
        'Access denied to this license record.',
      );
    }

    return license;
  }

  async upsertForDriver(dto: RecordLicenseDto, user: RequestUserContext) {
    const perms = new Set(user.resolvedPermissions || []);
    const driver = await this.prisma.driverProfile.findUnique({
      where: { id: dto.driverProfileId },
    });

    if (!driver) {
      throw new AppNotFoundException(
        'NATIONAL_LICENSE_DRIVER_NOT_FOUND',
        {},
        'Driver profile not found.',
      );
    }

    const canSubmit =
      perms.has(Permission.DRIVERS_VIEW_ALL) ||
      perms.has(Permission.NATIONAL_DL_VERIFY) ||
      (perms.has(Permission.DRIVERS_VIEW_UNIT) && driver.unitId === user.unitId) ||
      driver.userId === user.id;

    if (!canSubmit) {
throw new AppForbiddenException(
        'NATIONAL_LICENSE_SUBMIT_OUT_OF_SCOPE',
        {},
        'Cannot submit a national license for a driver outside your scope.',
      );
    }

    const issuedDate = new Date(dto.issuedDate);
    const expiryDate = new Date(dto.expiryDate);

    if (
      Number.isNaN(issuedDate.getTime()) ||
      Number.isNaN(expiryDate.getTime()) ||
      expiryDate <= issuedDate
    ) {
      throw new AppBadRequestException(
        'NATIONAL_LICENSE_EXPIRY_BEFORE_ISSUE',
        {},
        'Expiry date must be after issue date.',
      );
    }

    const normalizedNum = dto.licenseNumber.trim().toUpperCase();
    const conflict = await this.prisma.nationalLicense.findFirst({
      where: {
        licenseNumber: normalizedNum,
        driverProfileId: { not: dto.driverProfileId },
      },
    });

    if (conflict) {
throw new AppConflictException(
        'NATIONAL_LICENSE_NUMBER_LINKED_TO_OTHER_DRIVER',
        { number: normalizedNum },
        `National license number ${normalizedNum} is already linked to another driver.`,
      );
    }

    // Anti-tampering reset: any submission or edit forces re-verification
    return this.prisma.nationalLicense.upsert({
      where: { driverProfileId: dto.driverProfileId },
      update: {
        licenseNumber: normalizedNum,
        issuingAuthority: dto.issuingAuthority.trim(),
        categories: dto.categories,
        issuedDate,
        expiryDate,
        documentEvidenceUrl: dto.documentEvidenceUrl,
        verificationStatus: VerificationStatus.UNVERIFIED,
        verifiedAt: null,
        verifiedByUserId: null,
        verificationNotes: null,
      },
      create: {
        driverProfileId: dto.driverProfileId,
        licenseNumber: normalizedNum,
        issuingAuthority: dto.issuingAuthority.trim(),
        categories: dto.categories,
        issuedDate,
        expiryDate,
        documentEvidenceUrl: dto.documentEvidenceUrl,
        verificationStatus: VerificationStatus.UNVERIFIED,
      },
      include: {
        driverProfile: {
          select: {
            id: true,
            serviceNumber: true,
            fullName: true,
            unit: { select: { id: true, code: true, name: true } },
          },
        },
      },
    });
  }

  async verifyLicense(
    id: string,
    dto: VerifyLicenseDto,
    verifierUser: RequestUserContext,
  ) {
    const license = await this.prisma.nationalLicense.findUnique({
      where: { id },
      include: { driverProfile: true },
    });

    if (!license) {
      throw new AppNotFoundException(
        'NATIONAL_LICENSE_RECORD_NOT_FOUND',
        {},
        'National license record not found.',
      );
    }

    if (license.driverProfile.userId === verifierUser.id) {
throw new AppForbiddenException(
        'NATIONAL_LICENSE_SELF_VERIFY',
        {},
        'Separation of Duties: You cannot verify your own national driving license.',
      );
    }

    if (
      dto.status === VerificationStatus.VERIFIED &&
      new Date(license.expiryDate) < new Date()
    ) {
throw new AppBadRequestException(
        'NATIONAL_LICENSE_EXPIRED_CANNOT_VERIFY',
        {},
        'Cannot mark an already expired national license as VERIFIED.',
      );
    }

    if (
      dto.status === VerificationStatus.REJECTED &&
      !dto.verificationNotes?.trim()
    ) {
throw new AppBadRequestException(
        'NATIONAL_LICENSE_REJECTION_NOTES_REQUIRED',
        {},
        'Verification notes are required when rejecting a national license.',
      );
    }

    await this.verifier.verify(license, {
      status: dto.status,
      notes: dto.verificationNotes,
    });

    return this.prisma.nationalLicense.update({
      where: { id },
      data: {
        verificationStatus: dto.status,
        verifiedAt: new Date(),
        verifiedByUserId: verifierUser.serviceNumber,
        verificationNotes: dto.verificationNotes?.trim() || null,
      },
      include: {
        driverProfile: {
          select: {
            id: true,
            serviceNumber: true,
            fullName: true,
            unit: { select: { id: true, code: true, name: true } },
          },
        },
      },
    });
  }
}
