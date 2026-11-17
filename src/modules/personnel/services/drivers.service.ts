import { Injectable } from '@nestjs/common';
import {
  AppBadRequestException,
  AppConflictException,
  AppForbiddenException,
  AppNotFoundException,
} from '../../../common/errors';
import {
  ApplicationStatus,
  CredentialStatus,
  SystemRole,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { generateTempPassword, tempPasswordExpiry } from '../../../common/utils/password.util';
import { composeFullName, normalizeNamePart } from '../../../common/utils/person-name.util';
import {
  MIN_DRIVER_AGE,
  REQUIRED_PROFILE_FIELDS,
  calculateAge,
  lockedProfileFields,
  missingProfileFields,
  profileStatusFor,
  sameProfileValue,
  type RequiredProfileField,
} from '../helpers/profile-completeness.helper';
import { PrismaService } from '../../../prisma/prisma.service';
import { PaginatedResult } from '../../../common/dto/paginated-result.dto';
import { Permission } from '../../../common/enums/permissions.enum';
import { CreateDriverDto } from '../dto/create-driver.dto';
import { BulkCreateDriversDto } from '../dto/bulk-create-drivers.dto';
import { UpdateDriverDto } from '../dto/update-driver.dto';
import { UpdateMyProfileDto } from '../dto/update-my-profile.dto';
import { QueryDriversDto } from '../dto/query-drivers.dto';
import { OPEN_APPLICATION_STATUSES } from '../../applications/helpers/application-state.helper';
import {
  ResolvedPriorPermit,
  createPreTrainedApplicationInTx,
  generateApplicationNumber,
  isApplicationNumberCollision,
  loadPriorPermitLookup,
  resolvePriorPermit,
} from '../../applications/helpers/prior-permit.helper';

export interface RequestUserContext {
  id: string;
  serviceNumber: string;
  unitId: string | null;
  resolvedPermissions?: string[];
}

@Injectable()
export class DriversService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: QueryDriversDto, user: RequestUserContext) {
    const perms = new Set(user.resolvedPermissions || []);
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (perms.has(Permission.DRIVERS_VIEW_ALL)) {
      if (query.unitId) where.unitId = query.unitId;
    } else if (perms.has(Permission.DRIVERS_VIEW_UNIT)) {
      if (!user.unitId) {
        return new PaginatedResult([], 0, page, limit);
      }
      where.unitId = user.unitId;
    } else {
      where.userId = user.id;
    }

    if (query.search) {
      where.OR = [
        { serviceNumber: { contains: query.search, mode: 'insensitive' } },
        { fullName: { contains: query.search, mode: 'insensitive' } },
        { rank: { contains: query.search, mode: 'insensitive' } },
        { nationalIdNumber: { contains: query.search, mode: 'insensitive' } },
        { contactPhone: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.personnelStatus) {
      where.personnelStatus = query.personnelStatus;
    }
    if (query.verifiedOnly) {
      where.identityVerifiedAt = { not: null };
    }

    // ---- Driving authorization class filters ----
    const classCode = query.categoryCode?.trim().toUpperCase();
    const now = new Date();
    const classScope = classCode
      ? { categories: { some: { category: { code: classCode } } } }
      : {};
    const validPermit = {
      status: CredentialStatus.ACTIVE,
      expiryDate: { gt: now },
      ...classScope,
    };
    const suspendedPermit = {
      status: CredentialStatus.SUSPENDED,
      expiryDate: { gt: now },
      ...classScope,
    };
    const openApplication = {
      ...(classCode
        ? { requestedCategories: { some: { category: { code: classCode } } } }
        : {}),
      OR: [
        { status: { in: OPEN_APPLICATION_STATUSES } },
        {
          status: ApplicationStatus.APPROVED,
          NOT: { currentStage: { startsWith: 'Credential Issued' } },
        },
      ],
    };
    const authorization =
      query.authorization ?? (classCode ? 'AUTHORIZED' : undefined);
    if (authorization === 'AUTHORIZED') {
      where.issuedCredentials = { some: validPermit };
    } else if (authorization === 'SUSPENDED') {
      where.issuedCredentials = { some: suspendedPermit };
    } else if (authorization === 'IN_PROGRESS') {
      where.applications = { some: openApplication };
    } else if (authorization === 'NONE') {
      where.issuedCredentials = {
        none: { OR: [validPermit, suspendedPermit] },
      };
    }

    const [items, total] = await Promise.all([
      this.prisma.driverProfile.findMany({
        where,
        include: {
          unit: { select: { id: true, code: true, name: true } },
          user: { select: { id: true, email: true, phone: true } },
          nationalLicense: {
            select: {
              id: true,
              licenseNumber: true,
              verificationStatus: true,
              expiryDate: true,
            },
          },
          issuedCredentials: {
            where: {
              status: {
                in: [CredentialStatus.ACTIVE, CredentialStatus.SUSPENDED],
              },
              expiryDate: { gt: now },
            },
            orderBy: { issueDate: 'desc' },
            take: 1,
            select: {
              id: true,
              credentialNumber: true,
              status: true,
              expiryDate: true,
              categories: {
                select: { category: { select: { code: true, name: true } } },
              },
            },
          },
          applications: {
            where: {
              OR: [
                { status: { in: OPEN_APPLICATION_STATUSES } },
                {
                  status: ApplicationStatus.APPROVED,
                  NOT: { currentStage: { startsWith: 'Credential Issued' } },
                },
              ],
            },
            orderBy: { updatedAt: 'desc' },
            take: 1,
            select: {
              id: true,
              applicationNumber: true,
              status: true,
              requestedCategories: {
                select: { category: { select: { code: true } } },
              },
            },
          },
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.driverProfile.count({ where }),
    ]);

    return new PaginatedResult(items, total, page, limit);
  }

  async findOne(id: string, user: RequestUserContext) {
    const perms = new Set(user.resolvedPermissions || []);
    const driver = await this.prisma.driverProfile.findUnique({
      where: { id },
      include: {
        unit: { select: { id: true, code: true, name: true } },
        user: { select: { id: true, email: true, phone: true } },
        nationalLicense: true,
      },
    });

    if (!driver) {
      throw new AppNotFoundException(
        'DRIVER_NOT_FOUND',
        {},
        'Driver profile not found.',
      );
    }

    const allowed =
      perms.has(Permission.DRIVERS_VIEW_ALL) ||
      (perms.has(Permission.DRIVERS_VIEW_UNIT) &&
        driver.unitId === user.unitId) ||
      (perms.has(Permission.DRIVERS_VIEW_OWN) && driver.userId === user.id);

    if (!allowed) {
      throw new AppForbiddenException(
        'DRIVER_OUTSIDE_UNIT_SCOPE',
        {},
        'Access denied: Driver outside your unit scope.',
      );
    }

    return driver;
  }

  async create(dto: CreateDriverDto, user: RequestUserContext) {
    const perms = new Set(user.resolvedPermissions || []);
    const normalizedService = dto.serviceNumber.trim().toUpperCase();
    const dob = this.parseOptionalDob(dto);

    if (
      !perms.has(Permission.DRIVERS_VIEW_ALL) &&
      user.unitId &&
      dto.unitId !== user.unitId
    ) {
      throw new AppForbiddenException(
        'UNIT_COORDINATOR_OWN_UNIT_ONLY',
        {},
        'Unit Coordinators can only register drivers within their assigned unit.',
      );
    }

    const unit = await this.prisma.organizationalUnit.findUnique({
      where: { id: dto.unitId },
    });
    if (!unit) {
      throw new AppBadRequestException(
        'SELECTED_UNIT_NOT_FOUND',
        {},
        'Selected organizational unit does not exist.',
      );
    }

    const existingProfile = await this.prisma.driverProfile.findUnique({
      where: { serviceNumber: normalizedService },
    });
    if (existingProfile) {
      throw new AppConflictException(
        'DRIVER_SERVICE_NUMBER_EXISTS',
        { serviceNumber: normalizedService },
        `Driver profile already exists for service number ${normalizedService}.`,
      );
    }

    const normalizedNationalId =
      dto.nationalIdNumber?.trim().toUpperCase() || null;
    if (normalizedNationalId) {
      const existingByNationalId = await this.prisma.driverProfile.findUnique({
        where: { nationalIdNumber: normalizedNationalId },
      });
      if (existingByNationalId) {
        throw new AppConflictException(
          'DRIVER_NATIONAL_ID_EXISTS',
          { nationalId: normalizedNationalId },
          `Driver profile already exists for National / Fayda ID ${normalizedNationalId}.`,
        );
      }
    }

    const normalizedEmail = dto.email?.trim().toLowerCase() || null;
    if (normalizedEmail) {
      const existingByEmail = await this.prisma.user.findUnique({
        where: { email: normalizedEmail },
        select: { serviceNumber: true },
      });
      if (
        existingByEmail &&
        existingByEmail.serviceNumber !== normalizedService
      ) {
        throw new AppConflictException(
          'USERS_EMAIL_EXISTS',
          { email: normalizedEmail },
          `User account already exists with email ${normalizedEmail}.`,
        );
      }
    }

    let prior: ResolvedPriorPermit | null = null;
    if (dto.priorPermit) {
      this.assertCanRecordPriorPermits(perms);
      const lookup = await loadPriorPermitLookup(this.prisma, [
        dto.priorPermit,
      ]);
      prior = resolvePriorPermit(dto.priorPermit, dob, lookup);
    }

    // No shared default password: an omitted one is generated and shown once.
    const generated = !dto.initialPassword;
    const temporaryPassword = dto.initialPassword ?? generateTempPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);

    const { driver, accountCreated } = await this.runDriverTransaction(
      prior,
      (tx, attempt) =>
        this.createDriverRecordInTx(
          tx,
          dto,
          normalizedService,
          normalizedNationalId,
          dob,
          passwordHash,
          prior ? { prior, createdById: user.id, attempt } : null,
        ),
    );

    // An existing account (e.g. a staff user now registered as a driver) keeps
    // its own password, so there is no temporary password to hand over.
    return generated && accountCreated ? { ...driver, temporaryPassword } : driver;
  }

  /**
   * Date of birth is entered by the driver during profile completion, so it is
   * optional here. It is mandatory only when an existing permit is recorded,
   * because the permit's age rules need it.
   */
  private parseOptionalDob(dto: CreateDriverDto): Date | null {
    if (!dto.dateOfBirth) {
      if (dto.priorPermit) {
        throw new AppBadRequestException(
          'DRIVER_DOB_REQUIRED_FOR_PRIOR_PERMIT',
          {},
          'Date of birth is required when recording an existing permit.',
        );
      }
      return null;
    }
    const dob = new Date(dto.dateOfBirth);
    if (Number.isNaN(dob.getTime()) || calculateAge(dob) < MIN_DRIVER_AGE) {
      throw new AppBadRequestException(
        'DRIVER_UNDERAGE',
        {},
        'Driver must be at least 18 years old.',
      );
    }
    return dob;
  }

  async bulkCreate(dto: BulkCreateDriversDto, user: RequestUserContext) {
    const perms = new Set(user.resolvedPermissions || []);
    const canAnyUnit = perms.has(Permission.DRIVERS_VIEW_ALL);

    for (const item of dto.drivers) {
      if (!canAnyUnit && user.unitId && item.unitId !== user.unitId) {
        throw new AppForbiddenException(
          'UNIT_COORDINATOR_OWN_UNIT_ONLY',
          {},
          'Unit Coordinators can only register drivers within their assigned unit.',
        );
      }
    }

    const priorInputs = dto.drivers
      .map((d) => d.priorPermit)
      .filter((p): p is NonNullable<typeof p> => Boolean(p));
    if (priorInputs.length > 0) {
      this.assertCanRecordPriorPermits(perms);
    }
    const priorLookup =
      priorInputs.length > 0
        ? await loadPriorPermitLookup(this.prisma, priorInputs)
        : null;

    const uniqueUnitIds = Array.from(new Set(dto.drivers.map((d) => d.unitId)));
    const normalizedServices = dto.drivers.map((d) =>
      d.serviceNumber.trim().toUpperCase(),
    );
    const normalizedNationalIds = dto.drivers
      .map((d) => d.nationalIdNumber?.trim().toUpperCase())
      .filter((v): v is string => Boolean(v));
    const normalizedEmails = dto.drivers
      .map((d) => d.email?.trim().toLowerCase())
      .filter((v): v is string => Boolean(v));

    const [validUnits, existingByService, existingByNationalId, existingByEmail] =
      await Promise.all([
        this.prisma.organizationalUnit.findMany({
          where: { id: { in: uniqueUnitIds } },
          select: { id: true },
        }),
        this.prisma.driverProfile.findMany({
          where: { serviceNumber: { in: normalizedServices } },
          select: { serviceNumber: true },
        }),
        normalizedNationalIds.length > 0
          ? this.prisma.driverProfile.findMany({
              where: { nationalIdNumber: { in: normalizedNationalIds } },
              select: { nationalIdNumber: true },
            })
          : Promise.resolve([]),
        normalizedEmails.length > 0
          ? this.prisma.user.findMany({
              where: { email: { in: normalizedEmails } },
              select: { email: true, serviceNumber: true },
            })
          : Promise.resolve([]),
      ]);

    const validUnitSet = new Set(validUnits.map((u) => u.id));
    const dbServiceSet = new Set(existingByService.map((d) => d.serviceNumber));
    const dbNationalIdSet = new Set(
      existingByNationalId
        .map((d) => d.nationalIdNumber)
        .filter((v): v is string => Boolean(v)),
    );
    const dbEmailMap = new Map<string, string>();
    for (const u of existingByEmail) {
      if (u.email) dbEmailMap.set(u.email, u.serviceNumber);
    }
    const batchServiceSet = new Set<string>();
    const batchNationalIdSet = new Set<string>();
    const batchEmailSet = new Set<string>();
    const passwordHashCache = new Map<string, string>();

    const results: Array<{
      rowIndex: number;
      serviceNumber: string;
      fullName: string;
      status: 'CREATED' | 'FAILED';
      error?: string;
      driver?: any;
      application?: { id: string; applicationNumber: string; status: string };
      /** Only present when the server generated it; shown once, never stored. */
      temporaryPassword?: string;
    }> = [];

    for (let i = 0; i < dto.drivers.length; i++) {
      const item = dto.drivers[i];
      const normalizedService = item.serviceNumber.trim().toUpperCase();
      const normalizedNationalId =
        item.nationalIdNumber?.trim().toUpperCase() || null;
      const normalizedEmail = item.email?.trim().toLowerCase() || null;

      try {
        const dob = this.parseOptionalDob(item);

        if (!validUnitSet.has(item.unitId)) {
          throw new AppBadRequestException(
            'SELECTED_UNIT_NOT_FOUND',
            {},
            'Selected organizational unit does not exist.',
          );
        }

        if (
          dbServiceSet.has(normalizedService) ||
          batchServiceSet.has(normalizedService)
        ) {
          throw new AppConflictException(
            'DRIVER_SERVICE_NUMBER_EXISTS',
            { serviceNumber: normalizedService },
            `Driver profile already exists for service number ${normalizedService}.`,
          );
        }

        if (
          normalizedNationalId &&
          (dbNationalIdSet.has(normalizedNationalId) ||
            batchNationalIdSet.has(normalizedNationalId))
        ) {
          throw new AppConflictException(
            'DRIVER_NATIONAL_ID_EXISTS',
            { nationalId: normalizedNationalId },
            `Driver profile already exists for National / Fayda ID ${normalizedNationalId}.`,
          );
        }

        if (normalizedEmail) {
          const existingOwner = dbEmailMap.get(normalizedEmail);
          if (
            (existingOwner && existingOwner !== normalizedService) ||
            batchEmailSet.has(normalizedEmail)
          ) {
            throw new AppConflictException(
              'USERS_EMAIL_EXISTS',
              { email: normalizedEmail },
              `Email ${normalizedEmail} is already registered to another user.`,
            );
          }
        }

        const prior =
          item.priorPermit && priorLookup && dob
            ? resolvePriorPermit(item.priorPermit, dob, priorLookup)
            : null;

        // Each row without a supplied password gets its own random temporary one.
        const generated = !item.initialPassword;
        const rawPassword = item.initialPassword ?? generateTempPassword();
        let passwordHash = generated
          ? undefined
          : passwordHashCache.get(rawPassword);
        if (!passwordHash) {
          passwordHash = await bcrypt.hash(rawPassword, 10);
          if (!generated) passwordHashCache.set(rawPassword, passwordHash);
        }

        const { driver: created, accountCreated } =
          await this.runDriverTransaction(prior, (tx, attempt) =>
            this.createDriverRecordInTx(
              tx,
              item,
              normalizedService,
              normalizedNationalId,
              dob,
              passwordHash!,
              prior ? { prior, createdById: user.id, attempt } : null,
            ),
          );

        batchServiceSet.add(normalizedService);
        if (prior && priorLookup) {
          priorLookup.takenPermitNumbers.add(prior.permitNumber);
        }
        if (normalizedNationalId) {
          batchNationalIdSet.add(normalizedNationalId);
        }
        if (normalizedEmail) {
          batchEmailSet.add(normalizedEmail);
        }

        results.push({
          rowIndex: i,
          serviceNumber: normalizedService,
          fullName: composeFullName(item.firstName, item.middleName, item.lastName),
          status: 'CREATED',
          driver: created,
          application: created.preTrainedApplication ?? undefined,
          temporaryPassword:
            generated && accountCreated ? rawPassword : undefined,
        });
      } catch (err: any) {
        results.push({
          rowIndex: i,
          serviceNumber: normalizedService,
          fullName: composeFullName(item.firstName, item.middleName, item.lastName),
          status: 'FAILED',
          error: err?.message || 'Failed to register driver.',
        });
      }
    }

    const createdCount = results.filter((r) => r.status === 'CREATED').length;
    return {
      totalRequested: dto.drivers.length,
      createdCount,
      failedCount: dto.drivers.length - createdCount,
      applicationsCreated: results.filter((r) => r.application).length,
      results,
    };
  }

  /** Pre-trained registration also opens an application, so it needs that right too. */
  private assertCanRecordPriorPermits(perms: Set<string>) {
    if (!perms.has(Permission.APPLICATIONS_CREATE)) {
      throw new AppForbiddenException(
        'PRIOR_PERMIT_REQUIRES_APPLICATION_PERMISSION',
        {},
        'Registering already-trained drivers requires permission to submit applications.',
      );
    }
  }

  /**
   * Runs the driver-creation transaction, retrying only when a concurrent
   * registration grabbed the same generated application number.
   */
  private async runDriverTransaction(
    prior: ResolvedPriorPermit | null,
    work: (tx: any, attempt: number) => Promise<any>,
  ) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.$transaction((tx) => work(tx, attempt));
      } catch (err) {
        if (prior && attempt < 4 && isApplicationNumberCollision(err)) {
          continue;
        }
        throw err;
      }
    }
  }

  private async createDriverRecordInTx(
    tx: any,
    dto: CreateDriverDto,
    normalizedService: string,
    normalizedNationalId: string | null,
    dob: Date | null,
    passwordHash: string,
    preTrained: {
      prior: ResolvedPriorPermit;
      createdById: string;
      attempt: number;
    } | null = null,
  ) {
    const normalizedEmail = dto.email?.trim().toLowerCase() || null;
    const names = {
      firstName: normalizeNamePart(dto.firstName),
      middleName: normalizeNamePart(dto.middleName),
      lastName: normalizeNamePart(dto.lastName),
      fullName: composeFullName(dto.firstName, dto.middleName, dto.lastName),
    };
    let existingUser = await tx.user.findUnique({
      where: { serviceNumber: normalizedService },
    });
    const accountCreated = !existingUser;

    if (!existingUser) {
      existingUser = await tx.user.create({
        data: {
          serviceNumber: normalizedService,
          ...names,
          rank: dto.rank?.trim() || null,
          email: normalizedEmail,
          phone: dto.contactPhone?.trim() || null,
          passwordHash,
          roles: [SystemRole.STAFF_DRIVER],
          unitId: dto.unitId,
          isActive: true,
          mustChangePassword: true,
          tempPasswordExpiresAt: tempPasswordExpiry(),
        },
      });
    } else if (normalizedEmail && existingUser.email !== normalizedEmail) {
      existingUser = await tx.user.update({
        where: { id: existingUser.id },
        data: { email: normalizedEmail },
      });
    }

    const profileStatus = profileStatusFor({
      dateOfBirth: dob,
      gender: dto.gender,
      nationalIdNumber: normalizedNationalId,
      bloodGroup: dto.bloodGroup,
      photoUrl: dto.photoUrl,
      emergencyContactName: dto.emergencyContactName?.trim() || null,
      emergencyContactPhone: dto.emergencyContactPhone?.trim() || null,
    });

    const driver = await tx.driverProfile.create({
      data: {
        userId: existingUser.id,
        serviceNumber: normalizedService,
        ...names,
        rank: dto.rank?.trim() || null,
        gender: dto.gender,
        nationalIdNumber: normalizedNationalId,
        dateOfBirth: dob,
        bloodGroup: dto.bloodGroup,
        photoUrl: dto.photoUrl,
        contactPhone: dto.contactPhone?.trim() || null,
        emergencyContactName: dto.emergencyContactName?.trim() || null,
        emergencyContactPhone: dto.emergencyContactPhone?.trim() || null,
        unitId: dto.unitId,
        personnelStatus: dto.personnelStatus,
        profileStatus,
        profileCompletedAt: profileStatus === 'COMPLETE' ? new Date() : null,
      },
      include: {
        unit: { select: { id: true, code: true, name: true } },
        user: { select: { id: true, email: true, phone: true } },
      },
    });

    if (!preTrained) {
      return { driver, accountCreated };
    }

    const preTrainedApplication = await createPreTrainedApplicationInTx(tx, {
      driverProfileId: driver.id,
      createdById: preTrained.createdById,
      prior: preTrained.prior,
      applicationNumber: await generateApplicationNumber(
        tx,
        preTrained.attempt,
      ),
    });

    return { driver: { ...driver, preTrainedApplication }, accountCreated };
  }

  /** The signed-in driver's own profile, plus which required fields are still empty. */
  async findMine(userId: string) {
    const profile = await this.prisma.driverProfile.findUnique({
      where: { userId },
      include: {
        unit: { select: { id: true, code: true, name: true } },
        user: { select: { id: true, email: true, phone: true } },
      },
    });
    if (!profile) {
      throw new AppNotFoundException(
        'DRIVER_NOT_FOUND',
        {},
        'Driver profile not found.',
      );
    }
    return {
      ...profile,
      missingFields: missingProfileFields(profile),
      lockedFields: lockedProfileFields(profile),
    };
  }

  /**
   * Self-service profile completion. The DTO whitelists what a driver may edit;
   * everything else (name, rank, unit, status) stays admin-only.
   */
  async updateMine(userId: string, dto: UpdateMyProfileDto) {
    const profile = await this.prisma.driverProfile.findUnique({
      where: { userId },
    });
    if (!profile) {
      throw new AppNotFoundException(
        'DRIVER_NOT_FOUND',
        {},
        'Driver profile not found.',
      );
    }

    // Details an administrator already entered are read-only for the driver.
    // Re-sending the same value is harmless; trying to change one is refused.
    const locked = new Set<string>(lockedProfileFields(profile));
    const editable: Record<string, unknown> = {};
    const refused: string[] = [];
    for (const [field, value] of Object.entries(dto)) {
      if (value === undefined) continue;
      if (!locked.has(field)) {
        editable[field] = value;
      } else if (
        !sameProfileValue(field as RequiredProfileField, profile[field as RequiredProfileField], value)
      ) {
        refused.push(field);
      }
    }
    if (refused.length > 0) {
      throw new AppForbiddenException(
        'PROFILE_FIELD_LOCKED',
        { fields: refused.join(', ') },
        `These details were entered by your administrator and cannot be changed here: ${refused.join(', ')}.`,
      );
    }

    const updated = await this.update(profile.id, editable as UpdateDriverDto, {
      selfEntered: Object.keys(editable),
    });
    return {
      ...updated,
      missingFields: missingProfileFields(updated),
      lockedFields: lockedProfileFields(updated),
    };
  }

  /**
   * `opts.selfEntered` marks the call as the driver editing their own profile:
   * the fields they send are recorded as theirs. Without it (an administrator),
   * the fields sent become admin-owned again, i.e. read-only for the driver.
   */
  async update(
    id: string,
    dto: UpdateDriverDto,
    opts: { selfEntered?: string[] } = {},
  ) {
    const existing = await this.prisma.driverProfile.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new AppNotFoundException(
        'DRIVER_NOT_FOUND',
        {},
        'Driver profile not found.',
      );
    }

    const normalizedNationalId =
      dto.nationalIdNumber !== undefined
        ? dto.nationalIdNumber.trim().toUpperCase() || null
        : undefined;

    if (normalizedNationalId) {
      const duplicate = await this.prisma.driverProfile.findUnique({
        where: { nationalIdNumber: normalizedNationalId },
        select: { id: true },
      });
      if (duplicate && duplicate.id !== id) {
        throw new AppConflictException(
          'DRIVER_NATIONAL_ID_EXISTS',
          { nationalId: normalizedNationalId },
          `Driver profile already exists for National / Fayda ID ${normalizedNationalId}.`,
        );
      }
    }

    // The three name parts travel together; the combined name is rebuilt from them.
    let names:
      | { firstName: string; middleName: string; lastName: string; fullName: string }
      | undefined;
    if (
      dto.firstName !== undefined ||
      dto.middleName !== undefined ||
      dto.lastName !== undefined
    ) {
      const firstName = normalizeNamePart(dto.firstName ?? existing.firstName ?? '');
      const middleName = normalizeNamePart(dto.middleName ?? existing.middleName ?? '');
      const lastName = normalizeNamePart(dto.lastName ?? existing.lastName ?? '');
      if (!firstName || !middleName || !lastName) {
        throw new AppBadRequestException(
          'NAME_PARTS_REQUIRED',
          {},
          "First name, father's name and grandfather's name are all required.",
        );
      }
      names = {
        firstName,
        middleName,
        lastName,
        fullName: composeFullName(firstName, middleName, lastName),
      };
    }

    let dob: Date | undefined;
    if (dto.dateOfBirth !== undefined) {
      dob = new Date(dto.dateOfBirth);
      if (Number.isNaN(dob.getTime()) || calculateAge(dob) < MIN_DRIVER_AGE) {
        throw new AppBadRequestException(
          'DRIVER_UNDERAGE',
          {},
          'Driver must be at least 18 years old.',
        );
      }
    }

    const normalizedEmail =
      dto.email !== undefined
        ? dto.email.trim().toLowerCase() || null
        : undefined;

    if (normalizedEmail) {
      const duplicateUser = await this.prisma.user.findUnique({
        where: { email: normalizedEmail },
        select: { id: true },
      });
      if (duplicateUser && duplicateUser.id !== existing.userId) {
        throw new AppConflictException(
          'USERS_EMAIL_EXISTS',
          { email: normalizedEmail },
          `User account already exists with email ${normalizedEmail}.`,
        );
      }
    }

    const normalizedContactPhone =
      dto.contactPhone !== undefined
        ? dto.contactPhone.trim() || null
        : undefined;

    // The account's email/phone are the same contact details, keep them in step.
    if (
      existing.userId &&
      (normalizedEmail !== undefined ||
        normalizedContactPhone !== undefined ||
        names)
    ) {
      await this.prisma.user.update({
        where: { id: existing.userId },
        data: {
          ...(names ?? {}),
          ...(normalizedEmail !== undefined ? { email: normalizedEmail } : {}),
          ...(normalizedContactPhone !== undefined
            ? { phone: normalizedContactPhone }
            : {}),
        },
      });
    }

    const data = {
      fullName: names?.fullName,
      firstName: names?.firstName,
      middleName: names?.middleName,
      lastName: names?.lastName,
      rank: dto.rank !== undefined ? dto.rank.trim() || null : undefined,
      gender: dto.gender,
      nationalIdNumber: normalizedNationalId,
      dateOfBirth: dob,
      bloodGroup: dto.bloodGroup,
      photoUrl: dto.photoUrl,
      contactPhone: normalizedContactPhone,
      emergencyContactName:
        dto.emergencyContactName !== undefined
          ? dto.emergencyContactName.trim() || null
          : undefined,
      emergencyContactPhone:
        dto.emergencyContactPhone !== undefined
          ? dto.emergencyContactPhone.trim() || null
          : undefined,
      unitId: dto.unitId,
      personnelStatus: dto.personnelStatus,
    };

    // Changing a field the identity check was based on voids that verification.
    const identityChanged =
      (normalizedNationalId !== undefined &&
        normalizedNationalId !== existing.nationalIdNumber) ||
      (dob !== undefined &&
        dob.getTime() !== existing.dateOfBirth?.getTime());

    // Recompute completeness from the values the profile will hold afterwards.
    const merged = {
      dateOfBirth: data.dateOfBirth ?? existing.dateOfBirth,
      gender: data.gender ?? existing.gender,
      nationalIdNumber:
        data.nationalIdNumber !== undefined
          ? data.nationalIdNumber
          : existing.nationalIdNumber,
      bloodGroup: data.bloodGroup ?? existing.bloodGroup,
      photoUrl: data.photoUrl ?? existing.photoUrl,
      emergencyContactName:
        data.emergencyContactName !== undefined
          ? data.emergencyContactName
          : existing.emergencyContactName,
      emergencyContactPhone:
        data.emergencyContactPhone !== undefined
          ? data.emergencyContactPhone
          : existing.emergencyContactPhone,
    };
    const profileStatus = profileStatusFor(merged);

    // Who owns each field now: self-service edits are the driver's, anything an
    // administrator sets reverts to admin-owned (locked for the driver).
    const touched = REQUIRED_PROFILE_FIELDS.filter(
      (f) => data[f as keyof typeof data] !== undefined,
    );
    const previousOwn = new Set(existing.selfEnteredFields ?? []);
    const nextOwn = new Set(previousOwn);
    for (const f of touched) {
      if (opts.selfEntered) nextOwn.add(f);
      else nextOwn.delete(f);
    }
    const ownChanged =
      nextOwn.size !== previousOwn.size ||
      [...nextOwn].some((f) => !previousOwn.has(f));

    return this.prisma.driverProfile.update({
      where: { id },
      data: {
        ...data,
        ...(ownChanged ? { selfEnteredFields: [...nextOwn] } : {}),
        profileStatus,
        profileCompletedAt:
          profileStatus === 'COMPLETE'
            ? existing.profileCompletedAt ?? new Date()
            : null,
        ...(identityChanged && existing.identityVerifiedAt
          ? { identityVerifiedAt: null, identityVerifiedBy: null }
          : {}),
      },
      include: {
        unit: { select: { id: true, code: true, name: true } },
        user: { select: { id: true, email: true, phone: true } },
      },
    });
  }

  /**
   * Issues a new temporary password for a driver's account (returned once).
   * Unit coordinators can only do this for drivers in their own unit.
   */
  async resetPassword(id: string, actor: RequestUserContext) {
    const perms = new Set(actor.resolvedPermissions || []);
    const driver = await this.prisma.driverProfile.findUnique({
      where: { id },
      select: {
        id: true,
        userId: true,
        unitId: true,
        user: { select: { roles: true } },
      },
    });
    if (!driver) {
      throw new AppNotFoundException(
        'DRIVER_NOT_FOUND',
        {},
        'Driver profile not found.',
      );
    }
    // A unit-scoped officer must not be able to take over a colleague's
    // staff/admin account just because that person is also a registered driver.
    const holdsOtherRoles = driver.user.roles.some(
      (r) => r !== SystemRole.STAFF_DRIVER,
    );
    if (
      !perms.has(Permission.DRIVERS_VIEW_ALL) &&
      ((actor.unitId && driver.unitId !== actor.unitId) || holdsOtherRoles)
    ) {
      throw new AppForbiddenException(
        'DRIVER_OUTSIDE_UNIT_SCOPE',
        {},
        'Access denied: Driver outside your unit scope.',
      );
    }
    if (driver.userId === actor.id) {
      throw new AppBadRequestException(
        'USERS_RESET_OWN_PASSWORD',
        {},
        'You cannot reset your own password here. Use change password instead.',
      );
    }

    const temporaryPassword = generateTempPassword();
    const expiresAt = tempPasswordExpiry();
    await this.prisma.user.update({
      where: { id: driver.userId },
      data: {
        passwordHash: await bcrypt.hash(temporaryPassword, 10),
        mustChangePassword: true,
        tempPasswordExpiresAt: expiresAt,
      },
    });
    return { temporaryPassword, expiresAt };
  }

  /**
   * Stamps identity verification on many drivers at once. Each driver is
   * checked individually; ineligible ones are reported rather than failing
   * the whole batch:
   *  - not found / outside the verifier's unit scope → FAILED
   *  - the verifier's own profile (separation of duties) → FAILED
   *  - already verified → SKIPPED (original stamp is kept)
   */
  async bulkVerifyIdentity(driverIds: string[], verifier: RequestUserContext) {
    const ids = Array.from(new Set(driverIds));
    const perms = new Set(verifier.resolvedPermissions || []);

    const drivers = await this.prisma.driverProfile.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        serviceNumber: true,
        fullName: true,
        unitId: true,
        userId: true,
        identityVerifiedAt: true,
      },
    });
    const byId = new Map(drivers.map((d) => [d.id, d]));

    type Outcome = {
      driverId: string;
      serviceNumber?: string;
      fullName?: string;
      status: 'VERIFIED' | 'SKIPPED' | 'FAILED';
      reason?: string;
    };
    const results: Outcome[] = [];
    const eligible: string[] = [];

    for (const id of ids) {
      const d = byId.get(id);
      if (!d) {
        results.push({
          driverId: id,
          status: 'FAILED',
          reason: 'Driver profile not found.',
        });
        continue;
      }
      const base = {
        driverId: d.id,
        serviceNumber: d.serviceNumber,
        fullName: d.fullName,
      };
      const inScope =
        perms.has(Permission.DRIVERS_VIEW_ALL) ||
        (perms.has(Permission.DRIVERS_VIEW_UNIT) &&
          d.unitId === verifier.unitId);
      if (!inScope) {
        results.push({
          ...base,
          status: 'FAILED',
          reason: 'Driver is outside your unit scope.',
        });
      } else if (d.userId && d.userId === verifier.id) {
        results.push({
          ...base,
          status: 'FAILED',
          reason: 'You cannot verify your own identity.',
        });
      } else if (d.identityVerifiedAt) {
        results.push({
          ...base,
          status: 'SKIPPED',
          reason: 'Identity already verified.',
        });
      } else {
        eligible.push(d.id);
        results.push({ ...base, status: 'VERIFIED' });
      }
    }

    if (eligible.length > 0) {
      const now = new Date();
      await this.prisma.$transaction(async (tx) => {
        // Re-check identityVerifiedAt so a concurrent verification isn't overwritten.
        const updated = await tx.driverProfile.updateMany({
          where: { id: { in: eligible }, identityVerifiedAt: null },
          data: {
            identityVerifiedAt: now,
            identityVerifiedBy: verifier.serviceNumber,
          },
        });
        if (updated.count !== eligible.length) {
          const stamped = await tx.driverProfile.findMany({
            where: { id: { in: eligible }, identityVerifiedAt: now },
            select: { id: true },
          });
          const stampedIds = new Set(stamped.map((s) => s.id));
          for (const r of results) {
            if (r.status === 'VERIFIED' && !stampedIds.has(r.driverId)) {
              r.status = 'SKIPPED';
              r.reason = 'Identity already verified.';
            }
          }
        }

        const verified = results.filter((r) => r.status === 'VERIFIED');
        if (verified.length) {
          await tx.auditLog.createMany({
            data: verified.map((r) => ({
              userId: verifier.id,
              action: 'VERIFY_DRIVER_IDENTITY',
              entityType: 'DriverProfile',
              entityId: r.driverId,
              newValue: {
                serviceNumber: r.serviceNumber,
                identityVerifiedAt: now.toISOString(),
                identityVerifiedBy: verifier.serviceNumber,
                via: 'BULK_VERIFY',
              },
            })),
          });
        }
      });
    }

    return {
      totalRequested: ids.length,
      verifiedCount: results.filter((r) => r.status === 'VERIFIED').length,
      skippedCount: results.filter((r) => r.status === 'SKIPPED').length,
      failedCount: results.filter((r) => r.status === 'FAILED').length,
      results,
    };
  }

  async verifyIdentity(id: string, verifier: RequestUserContext) {
    const existing = await this.prisma.driverProfile.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new AppNotFoundException(
        'DRIVER_NOT_FOUND',
        {},
        'Driver profile not found.',
      );
    }

    return this.prisma.driverProfile.update({
      where: { id },
      data: {
        identityVerifiedAt: new Date(),
        identityVerifiedBy: verifier.serviceNumber,
      },
      include: {
        unit: { select: { id: true, code: true, name: true } },
      },
    });
  }
}
