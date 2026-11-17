import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { SystemRole } from '@prisma/client';
import { UsersService } from './users.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionResolverService } from '../../common/services/permission-resolver.service';
import { Permission } from '../../common/enums/permissions.enum';

describe('UsersService', () => {
  let service: UsersService;
  let prisma: {
    user: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      deleteMany: jest.Mock;
    };
    auditLog: { updateMany: jest.Mock };
    rolePermission: { findMany: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
    $transaction: jest.Mock;
  };
  let permissionResolver: { invalidateRoleCache: jest.Mock };

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        deleteMany: jest.fn(),
      },
      auditLog: {
        updateMany: jest.fn(),
      },
      rolePermission: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(async (cb: any) =>
      cb({ user: prisma.user, auditLog: prisma.auditLog }),
    );
    permissionResolver = {
      invalidateRoleCache: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
        { provide: PermissionResolverService, useValue: permissionResolver },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('should be defined and return READY status', () => {
    expect(service).toBeDefined();
    expect(service.getStatus().status).toBe('READY');
  });

  it('should throw ConflictException if serviceNumber already exists', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'existing-id' });

    await expect(
      service.create({
        serviceNumber: 'MOD-ADMIN-001',
        fullName: 'Col. Test User',
        rank: 'Colonel',
        phone: '+251911000001',
        password: 'Password@123',
        roles: [SystemRole.UNIT_COORDINATOR],
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('should create user with fullName, rank, phone, hashed password and normalized serviceNumber', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({
      id: 'new-id',
      serviceNumber: 'MOD-TEST-99',
      fullName: 'Maj. Dawit Bekele',
      rank: 'Major',
      phone: '+251911223344',
      roles: [SystemRole.UNIT_COORDINATOR],
    });

    const result = await service.create({
      serviceNumber: ' mod-test-99 ',
      fullName: ' Maj. Dawit Bekele ',
      rank: ' Major ',
      phone: ' +251911223344 ',
      email: ' DAWIT@MOD.GOV.ET ',
      password: 'Password@123',
      roles: [SystemRole.UNIT_COORDINATOR],
      unitId: '9f8beb56-c285-4e0b-908d-95b67440884d',
    });

    expect(result.serviceNumber).toBe('MOD-TEST-99');
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          serviceNumber: 'MOD-TEST-99',
          fullName: 'Maj. Dawit Bekele',
          rank: 'Major',
          phone: '+251911223344',
          email: 'dawit@mod.gov.et',
          passwordHash: expect.any(String),
        }),
      }),
    );
  });

  it('should reject a unit-scoped role without an organizational unit', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      service.create({
        serviceNumber: 'MOD-TEST-100',
        fullName: 'Capt. No Unit',
        rank: 'Captain',
        phone: '+251911223355',
        password: 'Password@123',
        roles: [SystemRole.UNIT_COORDINATOR],
      }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('should support filtering unassigned users via unitId=UNASSIGNED', async () => {
    prisma.user.findMany.mockResolvedValue([]);
    prisma.user.count.mockResolvedValue(0);

    await service.findAll({ page: 1, limit: 10, unitId: 'UNASSIGNED' });

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ unitId: null }),
      }),
    );
  });

  it('should prevent deleting your own active account', async () => {
    await expect(service.remove('actor-id', 'actor-id')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('should block deletion when user has operational history', async () => {
    prisma.user.findMany.mockResolvedValue([
      {
        id: 'u-1',
        serviceNumber: 'MOD-EXAM-001',
        driverProfile: null,
        _count: {
          approvalsGiven: 0,
          examinationsGiven: 2,
          issuedCredentials: 0,
          suspensionsImposed: 0,
        },
      },
    ]);

    await expect(service.bulkRemove(['u-1'], 'admin-id')).rejects.toThrow(
      ConflictException,
    );
    expect(prisma.user.deleteMany).not.toHaveBeenCalled();
  });

  it('should bulk delete accounts without operational history and preserve audit logs', async () => {
    prisma.user.findMany.mockResolvedValue([
      {
        id: 'u-1',
        serviceNumber: 'MOD-NEW-01',
        driverProfile: null,
        _count: {
          approvalsGiven: 0,
          examinationsGiven: 0,
          issuedCredentials: 0,
          suspensionsImposed: 0,
        },
      },
      {
        id: 'u-2',
        serviceNumber: 'MOD-NEW-02',
        driverProfile: null,
        _count: {
          approvalsGiven: 0,
          examinationsGiven: 0,
          issuedCredentials: 0,
          suspensionsImposed: 0,
        },
      },
    ]);

    const res = await service.bulkRemove(['u-1', 'u-2'], 'admin-id');

    expect(prisma.auditLog.updateMany).toHaveBeenCalledWith({
      where: { userId: { in: ['u-1', 'u-2'] } },
      data: { userId: null },
    });
    expect(prisma.user.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['u-1', 'u-2'] } },
    });
    expect(res).toEqual({
      deletedCount: 2,
      deletedIds: ['u-1', 'u-2'],
      deletedServiceNumbers: ['MOD-NEW-01', 'MOD-NEW-02'],
    });
  });

  it('should update role permissions and invalidate Redis cache immediately', async () => {
    prisma.rolePermission.findUnique.mockResolvedValue({
      role: SystemRole.UNIT_COORDINATOR,
      permissions: [Permission.DRIVERS_REGISTER],
    });
    prisma.rolePermission.update.mockResolvedValue({
      role: SystemRole.UNIT_COORDINATOR,
      permissions: [Permission.DRIVERS_REGISTER, Permission.APPLICATIONS_APPROVE],
    });

    const updated = await service.updateRolePermissions(SystemRole.UNIT_COORDINATOR, {
      permissions: [Permission.DRIVERS_REGISTER, Permission.APPLICATIONS_APPROVE],
    });

    expect(updated.permissions).toContain(Permission.APPLICATIONS_APPROVE);
    expect(permissionResolver.invalidateRoleCache).toHaveBeenCalledWith(
      SystemRole.UNIT_COORDINATOR,
    );
  });

  it('should throw NotFoundException when updating unknown role template', async () => {
    prisma.rolePermission.findUnique.mockResolvedValue(null);

    await expect(
      service.updateRolePermissions(SystemRole.UNIT_COORDINATOR, {
        permissions: [Permission.DRIVERS_REGISTER],
      }),
    ).rejects.toThrow(NotFoundException);
  });
});
