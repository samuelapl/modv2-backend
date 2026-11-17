import { Injectable } from '@nestjs/common';
import { SystemRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/paginated-result.dto';
import { generateTempPassword, tempPasswordExpiry } from '../../common/utils/password.util';
import { composeFullName, normalizeNamePart } from '../../common/utils/person-name.util';
import { PermissionResolverService } from '../../common/services/permission-resolver.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { QueryUsersDto } from './dto/query-users.dto';
import { UpdateRolePermissionsDto } from './dto/update-role-permissions.dto';
import { PERMISSION_CATALOG } from './constants/permission-catalog';
import { AppBadRequestException, AppConflictException, AppNotFoundException } from '../../common/errors';

/** Roles whose permissions are scoped to a single organizational unit. */
const UNIT_SCOPED_ROLES: SystemRole[] = [
  SystemRole.UNIT_COORDINATOR,
  SystemRole.STAFF_DRIVER,
];

function assertUnitAssigned(roles: SystemRole[], unitId: string | null | undefined) {
  if (!unitId && roles.some((r) => UNIT_SCOPED_ROLES.includes(r))) {
    throw new AppBadRequestException(
      'USERS_UNIT_REQUIRED', {}, 
      'An organizational unit is required for Unit Coordinator and Staff/Driver accounts.',
    );
  }
}

/**
 * A STAFF_DRIVER account always has a driver profile (applications, training and
 * permits hang off it). The profile starts incomplete with the basics already on
 * the account; the driver fills in the rest themselves.
 */
function newDriverProfile(user: {
  serviceNumber: string;
  fullName: string;
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
  rank: string | null;
  phone: string | null;
  unitId: string;
}) {
  return {
    create: {
      serviceNumber: user.serviceNumber,
      fullName: user.fullName,
      firstName: user.firstName ?? null,
      middleName: user.middleName ?? null,
      lastName: user.lastName ?? null,
      rank: user.rank,
      contactPhone: user.phone,
      unitId: user.unitId,
    },
  };
}

function normalizeOptionalEmail(
  email: string | null | undefined,
): string | null | undefined {
  if (email === undefined) return undefined;
  const trimmed = email?.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

const USER_SELECT = {
  id: true,
  serviceNumber: true,
  fullName: true,
  firstName: true,
  middleName: true,
  lastName: true,
  rank: true,
  phone: true,
  email: true,
  roles: true,
  customPermissions: true,
  unitId: true,
  unit: { select: { id: true, code: true, name: true } },
  driverProfile: {
    select: {
      id: true,
      fullName: true,
      personnelStatus: true,
      profileStatus: true,
    },
  },
  isActive: true,
  mustChangePassword: true,
  createdAt: true,
  updatedAt: true,
};

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissionResolver: PermissionResolverService,
  ) {}

  getStatus() {
    return {
      module: 'users',
      description: 'User Accounts & Role Management',
      status: 'READY',
    };
  }

  async findAll(query: QueryUsersDto) {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (query.search) {
      where.OR = [
        { serviceNumber: { contains: query.search, mode: 'insensitive' } },
        { fullName: { contains: query.search, mode: 'insensitive' } },
        { rank: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
        { phone: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.role) {
      where.roles = { has: query.role };
    }
    if (query.unitId === 'UNASSIGNED') {
      where.unitId = null;
    } else if (query.unitId) {
      where.unitId = query.unitId;
    }
    if (query.isActive !== undefined) {
      where.isActive = query.isActive;
    }

    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: USER_SELECT,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count({ where }),
    ]);

    return new PaginatedResult(items, total, page, limit);
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: USER_SELECT,
    });
    if (!user) {
      throw new AppNotFoundException(
      'USERS_NOT_FOUND', {}, 'User account not found.');
    }
    return user;
  }

  private async assertEmailAvailable(email: string | null | undefined, excludeUserId?: string) {
    if (!email) return;
    const existingByEmail = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existingByEmail && existingByEmail.id !== excludeUserId) {
      throw new AppConflictException(
      'USERS_EMAIL_EXISTS', { email }, `An account with email ${email} already exists.`);
    }
  }

  async create(dto: CreateUserDto) {
    const normalizedService = dto.serviceNumber.trim().toUpperCase();
    const existing = await this.prisma.user.findUnique({
      where: { serviceNumber: normalizedService },
    });

    if (existing) {
      throw new AppConflictException(
      'USERS_SERVICE_NUMBER_EXISTS', { serviceNumber: normalizedService }, 
        `User with service number ${normalizedService} already exists.`,
      );
    }

    const normalizedEmail = normalizeOptionalEmail(dto.email) ?? null;
    await this.assertEmailAvailable(normalizedEmail);

    const normalizedUnitId = dto.unitId?.trim() || null;
    assertUnitAssigned(dto.roles, normalizedUnitId);

    // Admin-issued passwords are temporary: the user must replace it on first login.
    const generated = !dto.password;
    const temporaryPassword = dto.password ?? generateTempPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);

    const names = {
      firstName: normalizeNamePart(dto.firstName),
      middleName: normalizeNamePart(dto.middleName),
      lastName: normalizeNamePart(dto.lastName),
      fullName: composeFullName(dto.firstName, dto.middleName, dto.lastName),
    };

    const created = await this.prisma.user.create({
      data: {
        serviceNumber: normalizedService,
        ...names,
        rank: dto.rank.trim(),
        phone: dto.phone.trim(),
        email: normalizedEmail,
        passwordHash,
        roles: dto.roles,
        unitId: normalizedUnitId,
        customPermissions: dto.customPermissions || [],
        mustChangePassword: true,
        tempPasswordExpiresAt: tempPasswordExpiry(),
        // Created together with the account, so there is never a driver without a profile.
        driverProfile:
          dto.roles.includes(SystemRole.STAFF_DRIVER) && normalizedUnitId
            ? newDriverProfile({
                serviceNumber: normalizedService,
                ...names,
                rank: dto.rank.trim(),
                phone: dto.phone.trim(),
                unitId: normalizedUnitId,
              })
            : undefined,
      },
      select: USER_SELECT,
    });

    // The generated password is shown to the admin once and never stored in plain text.
    return generated ? { ...created, temporaryPassword } : created;
  }

  /**
   * Issues a new temporary password (returned once). The user must change it at
   * next login; their existing sessions are blocked until they do.
   */
  async resetPassword(id: string, actorId: string) {
    if (id === actorId) {
      throw new AppBadRequestException(
        'USERS_RESET_OWN_PASSWORD',
        {},
        'You cannot reset your own password here. Use change password instead.',
      );
    }
    await this.findOne(id);

    const temporaryPassword = generateTempPassword();
    const expiresAt = tempPasswordExpiry();
    await this.prisma.user.update({
      where: { id },
      data: {
        passwordHash: await bcrypt.hash(temporaryPassword, 10),
        mustChangePassword: true,
        tempPasswordExpiresAt: expiresAt,
      },
    });
    return { temporaryPassword, expiresAt };
  }

  async update(id: string, dto: UpdateUserDto) {
    const current = await this.findOne(id);
    const nextUnitId =
      dto.unitId !== undefined ? dto.unitId?.trim() || null : current.unitId;
    assertUnitAssigned(dto.roles ?? current.roles, nextUnitId);

    const nextEmail = normalizeOptionalEmail(dto.email);
    await this.assertEmailAvailable(nextEmail, id);

    // Adding the driver role to an existing account gives it a profile too.
    // (Removing the role keeps the profile: applications and permits may refer to it.)
    // The three name parts travel together; the combined name is rebuilt from them.
    let names:
      | { firstName: string; middleName: string; lastName: string; fullName: string }
      | undefined;
    if (
      dto.firstName !== undefined ||
      dto.middleName !== undefined ||
      dto.lastName !== undefined
    ) {
      const firstName = normalizeNamePart(dto.firstName ?? current.firstName ?? '');
      const middleName = normalizeNamePart(dto.middleName ?? current.middleName ?? '');
      const lastName = normalizeNamePart(dto.lastName ?? current.lastName ?? '');
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

    const nextRoles = dto.roles ?? current.roles;
    const needsProfile =
      nextRoles.includes(SystemRole.STAFF_DRIVER) && !current.driverProfile && nextUnitId;

    return this.prisma.user.update({
      where: { id },
      data: {
        ...(names ?? {}),
        rank: dto.rank !== undefined ? dto.rank.trim() : undefined,
        phone: dto.phone !== undefined ? dto.phone.trim() : undefined,
        email: nextEmail,
        roles: dto.roles,
        unitId: dto.unitId !== undefined ? nextUnitId : undefined,
        isActive: dto.isActive,
        customPermissions: dto.customPermissions,
        driverProfile: needsProfile
          ? newDriverProfile({
              serviceNumber: current.serviceNumber,
              fullName: names?.fullName || current.fullName || current.serviceNumber,
              firstName: names?.firstName ?? current.firstName,
              middleName: names?.middleName ?? current.middleName,
              lastName: names?.lastName ?? current.lastName,
              rank: (dto.rank !== undefined ? dto.rank.trim() : current.rank) ?? null,
              phone: (dto.phone !== undefined ? dto.phone.trim() : current.phone) ?? null,
              unitId: nextUnitId as string,
            })
          : // keep an existing driver profile's name in step with the account
            names && current.driverProfile
            ? { update: { ...names } }
            : undefined,
      },
      select: USER_SELECT,
    });
  }

  async remove(id: string, actorId?: string) {
    const result = await this.deleteUsers([id], actorId);
    return {
      id: result.deletedIds[0],
      serviceNumber: result.deletedServiceNumbers[0],
      deleted: true,
    };
  }

  async bulkRemove(ids: string[], actorId?: string) {
    return this.deleteUsers(ids, actorId);
  }

  private async deleteUsers(rawIds: string[], actorId?: string) {
    const ids = Array.from(new Set(rawIds));
    if (ids.length === 0) {
      throw new AppBadRequestException(
      'USERS_DELETE_NONE_SELECTED', {}, 'Select at least one account to delete.');
    }

    if (actorId && ids.includes(actorId)) {
      throw new AppBadRequestException(
      'USERS_DELETE_SELF', {}, 'You cannot delete your own active account.');
    }

    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        serviceNumber: true,
        driverProfile: { select: { id: true } },
        _count: {
          select: {
            approvalsGiven: true,
            examinationsGiven: true,
            issuedCredentials: true,
            suspensionsImposed: true,
          },
        },
      },
    });

    if (users.length === 0) {
      throw new AppNotFoundException(
      'USERS_NOT_FOUND', {}, 'User account not found.');
    }

    const blocked = users.filter(
      (u) =>
        u.driverProfile !== null ||
        u._count.approvalsGiven > 0 ||
        u._count.examinationsGiven > 0 ||
        u._count.issuedCredentials > 0 ||
        u._count.suspensionsImposed > 0,
    );

    if (blocked.length > 0) {
      throw new AppConflictException(
      'USERS_DELETE_HAS_RECORDS', { serviceNumbers: blocked.map((u) => u.serviceNumber).join(', ') }, 
        `Cannot delete account(s) with operational records (${blocked.map((u) => u.serviceNumber).join(', ')}). Deactivate them instead to preserve audit integrity.`,
      );
    }

    const targetIds = users.map((u) => u.id);

    await this.prisma.$transaction(async (tx) => {
      await tx.auditLog.updateMany({
        where: { userId: { in: targetIds } },
        data: { userId: null },
      });
      await tx.user.deleteMany({
        where: { id: { in: targetIds } },
      });
    });

    return {
      deletedCount: users.length,
      deletedIds: targetIds,
      deletedServiceNumbers: users.map((u) => u.serviceNumber),
    };
  }

  async getRoleTemplates() {
    return this.prisma.rolePermission.findMany({
      orderBy: { role: 'asc' },
    });
  }

  getAvailablePermissions() {
    return PERMISSION_CATALOG;
  }

  async updateRolePermissions(role: SystemRole, dto: UpdateRolePermissionsDto) {
    const existing = await this.prisma.rolePermission.findUnique({
      where: { role },
    });

    if (!existing) {
      throw new AppNotFoundException(
      'USERS_ROLE_TEMPLATE_NOT_FOUND', { role: String(role) }, `Role template ${role} not found.`);
    }

    const updated = await this.prisma.rolePermission.update({
      where: { role },
      data: { permissions: dto.permissions },
    });

    // Immediately invalidate Redis cache so active users get new permissions
    await this.permissionResolver.invalidateRoleCache(role);

    return updated;
  }
}
