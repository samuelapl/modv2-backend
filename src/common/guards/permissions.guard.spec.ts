import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SystemRole } from '@prisma/client';
import { PermissionsGuard } from './permissions.guard';
import { Permission } from '../enums/permissions.enum';
import { PermissionResolverService } from '../services/permission-resolver.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';

describe('PermissionsGuard', () => {
  let guard: PermissionsGuard;
  let reflector: Reflector;
  let prisma: { rolePermission: { findMany: jest.Mock } };
  let redis: { get: jest.Mock; set: jest.Mock; del: jest.Mock };
  let resolver: PermissionResolverService;

  beforeEach(() => {
    reflector = new Reflector();
    prisma = {
      rolePermission: {
        findMany: jest.fn(),
      },
    };
    redis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
    };

    resolver = new PermissionResolverService(
      prisma as unknown as PrismaService,
      redis as unknown as RedisService,
    );
    guard = new PermissionsGuard(reflector, resolver);
  });

  const createMockContext = (user: any): ExecutionContext =>
    ({
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    }) as unknown as ExecutionContext;

  it('should allow access when no permissions are required', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    const ctx = createMockContext({ roles: [SystemRole.STAFF_DRIVER] });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('should allow access when another role is granted the required permission in RolePermission', async () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce([Permission.APPLICATIONS_APPROVE])
      .mockReturnValueOnce(undefined);

    prisma.rolePermission.findMany.mockResolvedValue([
      {
        role: SystemRole.UNIT_COORDINATOR,
        permissions: [Permission.DRIVERS_REGISTER, Permission.APPLICATIONS_APPROVE],
      },
    ]);

    const ctx = createMockContext({
      roles: [SystemRole.UNIT_COORDINATOR],
      customPermissions: [],
    });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(redis.set).toHaveBeenCalledWith(
      `role_perms:${SystemRole.UNIT_COORDINATOR}`,
      expect.any(String),
      300,
    );
  });

  it('should allow access when user holds one of @RequireAnyPermission', async () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce([Permission.DRIVERS_VIEW_ALL, Permission.DRIVERS_VIEW_UNIT]);

    prisma.rolePermission.findMany.mockResolvedValue([
      {
        role: SystemRole.UNIT_COORDINATOR,
        permissions: [Permission.DRIVERS_VIEW_UNIT],
      },
    ]);

    const ctx = createMockContext({
      roles: [SystemRole.UNIT_COORDINATOR],
      customPermissions: [],
    });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('should allow access when user has customPermissions delegated directly', async () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce([Permission.SAFETY_SUSPEND])
      .mockReturnValueOnce(undefined);

    prisma.rolePermission.findMany.mockResolvedValue([
      {
        role: SystemRole.CENTRAL_LICENSING_ADMIN,
        permissions: [Permission.APPLICATIONS_SCREEN],
      },
    ]);

    const ctx = createMockContext({
      roles: [SystemRole.CENTRAL_LICENSING_ADMIN],
      customPermissions: [Permission.SAFETY_SUSPEND],
    });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('should throw ForbiddenException when user lacks required permission', async () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce([Permission.CREDENTIALS_ISSUE])
      .mockReturnValueOnce(undefined);

    prisma.rolePermission.findMany.mockResolvedValue([
      {
        role: SystemRole.STAFF_DRIVER,
        permissions: [Permission.DRIVERS_VIEW_OWN],
      },
    ]);

    const ctx = createMockContext({
      roles: [SystemRole.STAFF_DRIVER],
      customPermissions: [],
    });

    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });
});
