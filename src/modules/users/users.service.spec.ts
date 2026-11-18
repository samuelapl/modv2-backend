import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { SystemRole } from '@prisma/client';
import { UsersService } from './users.service';
import { KEYCLOAK_PROVIDER_TOKEN } from '../keycloak';
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
    organizationalUnit: { findUnique: jest.Mock };
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
      organizationalUnit: {
        findUnique: jest.fn().mockResolvedValue({ code: 'LOG-CORPS' }),
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
        firstName: 'Test',
        middleName: 'User',
        lastName: 'Tester',
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
      firstName: 'Dawit', middleName: 'Bekele', lastName: 'Tester',
      rank: 'Major',
      phone: '+251911223344',
      roles: [SystemRole.UNIT_COORDINATOR],
    });

    const result = await service.create({
      serviceNumber: ' mod-test-99 ',
      firstName: 'Dawit', middleName: 'Bekele', lastName: 'Tester',
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
          firstName: 'Dawit', middleName: 'Bekele', lastName: 'Tester',
          rank: 'Major',
          phone: '+251911223344',
          email: 'dawit@mod.gov.et',
          passwordHash: expect.any(String),
          mustChangePassword: true,
          tempPasswordExpiresAt: expect.any(Date),
        }),
      }),
    );
    // the admin chose the password, so nothing is echoed back
    expect((result as any).temporaryPassword).toBeUndefined();
  });

  it('generates a temporary password when none is given and returns it once', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockImplementation(async ({ data }: any) => ({ id: 'n', ...data }));

    const result: any = await service.create({
      serviceNumber: 'MOD-GEN-1',
      firstName: 'Generated',
      middleName: 'Bikila',
      lastName: 'Tester',
      rank: 'Lieutenant',
      phone: '+251911000000',
      roles: [SystemRole.INSTRUCTOR],
    });

    expect(result.temporaryPassword).toEqual(expect.any(String));
    expect(result.temporaryPassword.length).toBeGreaterThanOrEqual(8);
    // only the hash is stored
    expect(prisma.user.create.mock.calls[0][0].data.passwordHash).not.toBe(result.temporaryPassword);
  });

  describe('driver profile follows the driver role', () => {
    const unitId = '9f8beb56-c285-4e0b-908d-95b67440884d';
    const base = {
      serviceNumber: 'MOD-DRV-1',
      firstName: 'Auto', middleName: 'Profile', lastName: 'Tester',
      rank: 'Corporal',
      phone: '+251911000500',
      unitId,
    };

    it('creates the profile together with a Ministry Staff / driver account', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockImplementation(async ({ data }: any) => ({ id: 'n', ...data }));

      await service.create({ ...base, roles: [SystemRole.STAFF_DRIVER] });

      const data = prisma.user.create.mock.calls[0][0].data;
      expect(data.driverProfile).toEqual({
        create: {
          serviceNumber: 'MOD-DRV-1',
          fullName: 'Auto Profile Tester',
          firstName: 'Auto',
          middleName: 'Profile',
          lastName: 'Tester',
          rank: 'Corporal',
          contactPhone: '+251911000500',
          unitId,
          // Approved automatically: no officer has to verify a newly created driver.
          identityVerifiedAt: expect.any(Date),
          identityVerifiedBy: 'SYSTEM',
        },
      });
    });

    it('also creates it when the driver role is combined with another role', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockImplementation(async ({ data }: any) => ({ id: 'n', ...data }));

      await service.create({ ...base, roles: [SystemRole.STAFF_DRIVER, SystemRole.INSTRUCTOR] });

      expect(prisma.user.create.mock.calls[0][0].data.driverProfile).toBeDefined();
    });

    it('does not create one for other staff roles', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockImplementation(async ({ data }: any) => ({ id: 'n', ...data }));

      await service.create({ ...base, roles: [SystemRole.EXAMINER] });

      expect(prisma.user.create.mock.calls[0][0].data.driverProfile).toBeUndefined();
    });

    it('adding the driver role to an existing account creates the profile', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u-9',
        ...base,
        roles: [SystemRole.EXAMINER],
        driverProfile: null,
      });
      prisma.user.update.mockResolvedValue({});

      await service.update('u-9', { roles: [SystemRole.EXAMINER, SystemRole.STAFF_DRIVER] });

      expect(prisma.user.update.mock.calls[0][0].data.driverProfile).toEqual({
        create: expect.objectContaining({ serviceNumber: 'MOD-DRV-1', unitId, contactPhone: '+251911000500' }),
      });
    });

    it('uses the edited name and falls back to the service number when none is on file', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u-9',
        ...base,
        fullName: null,
        roles: [SystemRole.EXAMINER],
        driverProfile: null,
      });
      prisma.user.update.mockResolvedValue({});

      await service.update('u-9', { roles: [SystemRole.STAFF_DRIVER] });

      expect(prisma.user.update.mock.calls[0][0].data.driverProfile.create.fullName).toBe('MOD-DRV-1');
    });

    it('does not create a second profile, syncs a rename, and keeps the profile when the role is taken away', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u-9',
        ...base,
        roles: [SystemRole.STAFF_DRIVER],
        driverProfile: { id: 'drv-1', firstName: 'x', middleName: 'Bikila', lastName: 'Tester', personnelStatus: 'ACTIVE' },
      });
      prisma.user.update.mockResolvedValue({});

      // renaming the account keeps the existing profile's name in step (no second profile)
      await service.update('u-9', { firstName: 'Renamed', middleName: 'Bikila', lastName: 'Tester' });
      expect(prisma.user.update.mock.calls[0][0].data.driverProfile).toEqual({
        update: {
          firstName: 'Renamed',
          middleName: 'Bikila',
          lastName: 'Tester',
          fullName: 'Renamed Bikila Tester',
        },
      });

      await service.update('u-9', { roles: [SystemRole.EXAMINER] });
      expect(prisma.user.update.mock.calls[1][0].data.driverProfile).toBeUndefined();
    });
  });

  describe('names (first / father / grandfather)', () => {
    it('stores the three parts and a title-free combined name', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockImplementation(async ({ data }: any) => ({ id: 'n', ...data }));

      await service.create({
        serviceNumber: 'MOD-N-1',
        firstName: '  Abebe ',
        middleName: 'Bikila',
        lastName: 'Demissie',
        rank: 'Sergeant',
        phone: '+251911000700',
        roles: [SystemRole.EXAMINER],
      });

      expect(prisma.user.create.mock.calls[0][0].data).toEqual(
        expect.objectContaining({
          firstName: 'Abebe',
          middleName: 'Bikila',
          lastName: 'Demissie',
          fullName: 'Abebe Bikila Demissie',
          rank: 'Sergeant',
        }),
      );
    });

    it('a name change must carry all three parts (legacy accounts have none on file)', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u-1',
        serviceNumber: 'MOD-1',
        roles: [SystemRole.EXAMINER],
        firstName: null,
        middleName: null,
        lastName: null,
        driverProfile: null,
      });
      await expect(service.update('u-1', { firstName: 'Abebe' })).rejects.toMatchObject({
        response: { code: 'NAME_PARTS_REQUIRED' },
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('changing one part keeps the others', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u-1',
        serviceNumber: 'MOD-1',
        roles: [SystemRole.EXAMINER],
        firstName: 'Abebe',
        middleName: 'Bikila',
        lastName: 'Demissie',
        driverProfile: null,
      });
      prisma.user.update.mockResolvedValue({});

      await service.update('u-1', { lastName: 'Worku' });

      expect(prisma.user.update.mock.calls[0][0].data).toEqual(
        expect.objectContaining({ firstName: 'Abebe', middleName: 'Bikila', lastName: 'Worku', fullName: 'Abebe Bikila Worku' }),
      );
    });
  });

  describe('resetPassword', () => {
    it('issues a new temporary password and forces a change at next login', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u-2', serviceNumber: 'MOD-2' });
      prisma.user.update.mockResolvedValue({});

      const res = await service.resetPassword('u-2', 'admin-1');

      expect(res.temporaryPassword.length).toBeGreaterThanOrEqual(8);
      expect(res.expiresAt).toBeInstanceOf(Date);
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'u-2' },
          data: expect.objectContaining({ mustChangePassword: true }),
        }),
      );
    });

    it('refuses to reset your own password', async () => {
      await expect(service.resetPassword('admin-1', 'admin-1')).rejects.toThrow(BadRequestException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('404s for an unknown user', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.resetPassword('ghost', 'admin-1')).rejects.toThrow(NotFoundException);
    });
  });

  it('should reject a unit-scoped role without an organizational unit', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      service.create({
        serviceNumber: 'MOD-TEST-100',
        firstName: 'No',
        middleName: 'Unit',
        lastName: 'Tester',
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

  it('sends the unit code to the identity provider when a user is created', async () => {
    const createIdentity = jest.fn().mockResolvedValue({ keycloakId: 'kc-new' });
    const withProvider: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
        { provide: PermissionResolverService, useValue: permissionResolver },
        { provide: KEYCLOAK_PROVIDER_TOKEN, useValue: { createIdentity } },
      ],
    }).compile();
    const svc = withProvider.get<UsersService>(UsersService);

    prisma.user.findUnique.mockResolvedValue(null);
    prisma.organizationalUnit.findUnique.mockResolvedValue({ code: 'ENG-CORPS' });
    prisma.user.create.mockResolvedValue({ id: 'new-id', serviceNumber: 'MOD-TEST-98', roles: [SystemRole.UNIT_COORDINATOR] });

    await svc.create({
      serviceNumber: 'MOD-TEST-98',
      firstName: 'Dawit', middleName: 'Bekele', lastName: 'Tester',
      rank: 'Major',
      phone: '+251911223344',
      email: 'unit@mod.gov.et',
      password: 'Password@123',
      roles: [SystemRole.UNIT_COORDINATOR],
      unitId: '9f8beb56-c285-4e0b-908d-95b67440884d',
    });

    expect(createIdentity).toHaveBeenCalledWith(expect.objectContaining({ unitCode: 'ENG-CORPS' }));
  });

  it('also removes the identity-provider account of deleted users that are linked', async () => {
    const deleteIdentity = jest.fn().mockResolvedValue(undefined);
    const withProvider: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
        { provide: PermissionResolverService, useValue: permissionResolver },
        { provide: KEYCLOAK_PROVIDER_TOKEN, useValue: { deleteIdentity } },
      ],
    }).compile();
    const svc = withProvider.get<UsersService>(UsersService);

    const noRecords = { approvalsGiven: 0, examinationsGiven: 0, issuedCredentials: 0, suspensionsImposed: 0 };
    prisma.user.findMany.mockResolvedValue([
      { id: 'u-1', serviceNumber: 'MOD-NEW-01', keycloakId: 'kc-1', driverProfile: null, _count: noRecords },
      { id: 'u-2', serviceNumber: 'MOD-NEW-02', keycloakId: null, driverProfile: null, _count: noRecords },
    ]);

    await svc.bulkRemove(['u-1', 'u-2'], 'admin-id');

    expect(prisma.user.deleteMany).toHaveBeenCalled();
    expect(deleteIdentity).toHaveBeenCalledTimes(1);
    expect(deleteIdentity).toHaveBeenCalledWith('kc-1');
  });

  it('keeps the local deletion even if removing the identity-provider account fails', async () => {
    const deleteIdentity = jest.fn().mockRejectedValue(new Error('keycloak down'));
    const withProvider: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
        { provide: PermissionResolverService, useValue: permissionResolver },
        { provide: KEYCLOAK_PROVIDER_TOKEN, useValue: { deleteIdentity } },
      ],
    }).compile();
    const svc = withProvider.get<UsersService>(UsersService);

    prisma.user.findMany.mockResolvedValue([
      {
        id: 'u-1', serviceNumber: 'MOD-NEW-01', keycloakId: 'kc-1', driverProfile: null,
        _count: { approvalsGiven: 0, examinationsGiven: 0, issuedCredentials: 0, suspensionsImposed: 0 },
      },
    ]);

    await expect(svc.bulkRemove(['u-1'], 'admin-id')).resolves.toMatchObject({ deletedCount: 1 });
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
