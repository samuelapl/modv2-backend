import { Injectable } from '@nestjs/common';
import { SystemRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/paginated-result.dto';
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
    },
  },
  isActive: true,
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

    const passwordHash = await bcrypt.hash(dto.password, 10);

    return this.prisma.user.create({
      data: {
        serviceNumber: normalizedService,
        fullName: dto.fullName.trim(),
        rank: dto.rank.trim(),
        phone: dto.phone.trim(),
        email: normalizedEmail,
        passwordHash,
        roles: dto.roles,
        unitId: normalizedUnitId,
        customPermissions: dto.customPermissions || [],
      },
      select: USER_SELECT,
    });
  }

  async update(id: string, dto: UpdateUserDto) {
    const current = await this.findOne(id);
    const nextUnitId =
      dto.unitId !== undefined ? dto.unitId?.trim() || null : current.unitId;
    assertUnitAssigned(dto.roles ?? current.roles, nextUnitId);

    const nextEmail = normalizeOptionalEmail(dto.email);
    await this.assertEmailAvailable(nextEmail, id);

    return this.prisma.user.update({
      where: { id },
      data: {
        fullName: dto.fullName !== undefined ? dto.fullName.trim() : undefined,
        rank: dto.rank !== undefined ? dto.rank.trim() : undefined,
        phone: dto.phone !== undefined ? dto.phone.trim() : undefined,
        email: nextEmail,
        roles: dto.roles,
        unitId: dto.unitId !== undefined ? nextUnitId : undefined,
        isActive: dto.isActive,
        customPermissions: dto.customPermissions,
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
