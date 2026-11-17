import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { DriversService } from './drivers.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { Permission } from '../../../common/enums/permissions.enum';

describe('DriversService', () => {
  let service: DriversService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      organizationalUnit: { findUnique: jest.fn(), findMany: jest.fn() },
      driverProfile: {
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      user: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
      },
      issuedCredential: { findMany: jest.fn().mockResolvedValue([]) },
      application: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [DriversService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<DriversService>(DriversService);
  });

  it('should reject drivers under 18 years old', async () => {
    const youngDob = new Date();
    youngDob.setFullYear(youngDob.getFullYear() - 16);

    await expect(
      service.create(
        {
          serviceNumber: 'MOD-YOUNG',
          firstName: 'Young',
          middleName: 'Recruit',
          lastName: 'Tester',
          email: 'driver1@mod.gov.et',
          contactPhone: '+251911000001',
          dateOfBirth: youngDob.toISOString(),
          unitId: 'unit-1',
        },
        {
          id: 'admin-1',
          serviceNumber: 'MOD-ADMIN-001',
          unitId: 'unit-1',
          resolvedPermissions: [Permission.DRIVERS_VIEW_ALL],
        },
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('should prevent Unit Coordinator from registering driver in another unit', async () => {
    await expect(
      service.create(
        {
          serviceNumber: 'MOD-CROSS',
          firstName: 'Cross',
          middleName: 'Bikila',
          lastName: 'Tester',
          email: 'driver2@mod.gov.et',
          contactPhone: '+251911000002',
          dateOfBirth: '1995-01-01',
          unitId: 'unit-OTHER',
        },
        {
          id: 'coord-1',
          serviceNumber: 'MOD-COORD-001',
          unitId: 'unit-1',
          resolvedPermissions: [Permission.DRIVERS_VIEW_UNIT],
        },
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('should throw ConflictException on duplicate driver serviceNumber', async () => {
    prisma.organizationalUnit.findUnique.mockResolvedValue({ id: 'unit-1' });
    prisma.driverProfile.findUnique.mockResolvedValue({ id: 'existing-driver' });

    await expect(
      service.create(
        {
          serviceNumber: 'MOD-88219',
          firstName: 'Duplicate',
          middleName: 'Soldier',
          lastName: 'Tester',
          email: 'driver3@mod.gov.et',
          contactPhone: '+251911000003',
          dateOfBirth: '1995-01-01',
          unitId: 'unit-1',
        },
        {
          id: 'admin-1',
          serviceNumber: 'MOD-ADMIN-001',
          unitId: 'unit-1',
          resolvedPermissions: [Permission.DRIVERS_VIEW_ALL],
        },
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('should filter drivers by unitId when user only has DRIVERS_VIEW_UNIT', async () => {
    prisma.driverProfile.findMany.mockResolvedValue([]);
    prisma.driverProfile.count.mockResolvedValue(0);

    await service.findAll(
      { page: 1, limit: 10 },
      {
        id: 'coord-1',
        serviceNumber: 'MOD-COORD-001',
        unitId: 'unit-LOG',
        resolvedPermissions: [Permission.DRIVERS_VIEW_UNIT],
      },
    );

    expect(prisma.driverProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { unitId: 'unit-LOG' },
      }),
    );
  });

  it.each(['COMPLETE', 'INCOMPLETE'] as const)('filters drivers by profile status %s', async (status) => {
    prisma.driverProfile.findMany.mockResolvedValue([]);
    prisma.driverProfile.count.mockResolvedValue(0);

    await service.findAll(
      { page: 1, limit: 10, profileStatus: status },
      {
        id: 'admin-1',
        serviceNumber: 'MOD-ADMIN-001',
        unitId: 'unit-1',
        resolvedPermissions: [Permission.DRIVERS_VIEW_ALL],
      },
    );

    expect(prisma.driverProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { profileStatus: status } }),
    );
  });

  it('combines the profile filter with the unit scope and personnel status', async () => {
    prisma.driverProfile.findMany.mockResolvedValue([]);
    prisma.driverProfile.count.mockResolvedValue(0);

    await service.findAll(
      { page: 1, limit: 10, profileStatus: 'INCOMPLETE', personnelStatus: 'ACTIVE' as any },
      {
        id: 'coord-1',
        serviceNumber: 'MOD-COORD-001',
        unitId: 'unit-LOG',
        resolvedPermissions: [Permission.DRIVERS_VIEW_UNIT],
      },
    );

    expect(prisma.driverProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { unitId: 'unit-LOG', personnelStatus: 'ACTIVE', profileStatus: 'INCOMPLETE' },
      }),
    );
  });

  it('should throw ConflictException on duplicate nationalIdNumber', async () => {
    prisma.organizationalUnit.findUnique.mockResolvedValue({ id: 'unit-1' });
    prisma.driverProfile.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'existing-by-national-id' });

    await expect(
      service.create(
        {
          serviceNumber: 'MOD-88299',
          firstName: 'Tesfaye',
          middleName: 'Bikila',
          lastName: 'Tester',
          email: 'driver4@mod.gov.et',
          rank: 'Sergeant',
          gender: 'MALE',
          nationalIdNumber: 'FAN-123456',
          dateOfBirth: '1995-01-01',
          bloodGroup: 'O+',
          contactPhone: '+251911223344',
          emergencyContactName: 'Almaz',
          emergencyContactPhone: '+251911887766',
          photoUrl: 'photo.jpg',
          unitId: 'unit-1',
        },
        {
          id: 'admin-1',
          serviceNumber: 'MOD-ADMIN-001',
          unitId: 'unit-1',
          resolvedPermissions: [Permission.DRIVERS_VIEW_ALL],
        },
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('should create driver profile and linked STAFF_DRIVER user with full fields', async () => {
    prisma.organizationalUnit.findUnique.mockResolvedValue({ id: 'unit-1' });
    prisma.driverProfile.findUnique.mockResolvedValue(null);

    const txUserCreate = jest.fn().mockResolvedValue({ id: 'user-new' });
    const txDriverCreate = jest.fn().mockResolvedValue({
      id: 'drv-new',
      serviceNumber: 'MOD-77001',
      rank: 'Sergeant',
      gender: 'MALE',
      nationalIdNumber: 'FAN-77001',
      bloodGroup: 'A+',
    });

    prisma.$transaction.mockImplementation(async (cb: any) =>
      cb({
        user: { findUnique: jest.fn().mockResolvedValue(null), create: txUserCreate },
        driverProfile: { create: txDriverCreate },
      }),
    );

    const created = await service.create(
      {
        serviceNumber: ' mod-77001 ',
        firstName: 'Abebe',
        middleName: 'Bikila',
        lastName: 'Tester',
        email: 'driver5@mod.gov.et',
        rank: 'Sergeant',
        gender: 'MALE',
        nationalIdNumber: ' fan-77001 ',
        dateOfBirth: '1995-03-10',
        bloodGroup: 'A+',
        photoUrl: 'portrait.jpg',
        contactPhone: '+251911223344',
        emergencyContactName: 'Almaz Bikila',
        emergencyContactPhone: '+251911887766',
        unitId: 'unit-1',
      },
      {
        id: 'admin-1',
        serviceNumber: 'MOD-ADMIN-001',
        unitId: 'unit-1',
        resolvedPermissions: [Permission.DRIVERS_VIEW_ALL],
      },
    );

    expect(created.nationalIdNumber).toBe('FAN-77001');
    // No password supplied: a random one is generated and returned once.
    expect((created as any).temporaryPassword).toEqual(expect.any(String));
    expect((created as any).temporaryPassword).not.toBe('MoD@2026!');
    expect(txUserCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          serviceNumber: 'MOD-77001',
          firstName: 'Abebe',
          middleName: 'Bikila',
          lastName: 'Tester',
          fullName: 'Abebe Bikila Tester', // composed, no title
          rank: 'Sergeant',
          phone: '+251911223344',
          mustChangePassword: true,
          tempPasswordExpiresAt: expect.any(Date),
        }),
      }),
    );
    expect(txDriverCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          nationalIdNumber: 'FAN-77001',
          bloodGroup: 'A+',
          gender: 'MALE',
          emergencyContactName: 'Almaz Bikila',
          emergencyContactPhone: '+251911887766',
        }),
      }),
    );
  });

  it('should stamp identityVerifiedAt and identityVerifiedBy on verifyIdentity', async () => {
    prisma.driverProfile.findUnique.mockResolvedValue({ id: 'drv-1' });
    prisma.driverProfile.update.mockResolvedValue({
      id: 'drv-1',
      identityVerifiedBy: 'MOD-LIC-001',
    });

    const result = await service.verifyIdentity('drv-1', {
      id: 'lic-1',
      serviceNumber: 'MOD-LIC-001',
      unitId: 'unit-1',
    });

    expect(result.identityVerifiedBy).toBe('MOD-LIC-001');
  });

  it('bulk verifies identity, skipping verified, self, out-of-scope and missing drivers', async () => {
    prisma.driverProfile.findMany.mockResolvedValue([
      { id: 'd-ok', serviceNumber: 'S-OK', fullName: 'A', unitId: 'unit-1', userId: 'u-a', identityVerifiedAt: null },
      { id: 'd-done', serviceNumber: 'S-DONE', fullName: 'B', unitId: 'unit-1', userId: 'u-b', identityVerifiedAt: new Date() },
      { id: 'd-self', serviceNumber: 'S-SELF', fullName: 'C', unitId: 'unit-1', userId: 'verifier-1', identityVerifiedAt: null },
      { id: 'd-other', serviceNumber: 'S-OTHER', fullName: 'D', unitId: 'unit-2', userId: 'u-d', identityVerifiedAt: null },
    ]);
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const createMany = jest.fn().mockResolvedValue({ count: 1 });
    prisma.$transaction.mockImplementation((fn: any) =>
      fn({ driverProfile: { updateMany, findMany: jest.fn() }, auditLog: { createMany } }),
    );

    const res = await service.bulkVerifyIdentity(
      ['d-ok', 'd-done', 'd-self', 'd-other', 'd-missing', 'd-ok'],
      {
        id: 'verifier-1',
        serviceNumber: 'MOD-UC-1',
        unitId: 'unit-1',
        resolvedPermissions: [Permission.DRIVERS_VIEW_UNIT, Permission.DRIVERS_UPDATE],
      },
    );

    expect(res.totalRequested).toBe(5);
    expect(res.verifiedCount).toBe(1);
    expect(res.skippedCount).toBe(1);
    expect(res.failedCount).toBe(3);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['d-ok'] }, identityVerifiedAt: null } }),
    );
    expect(createMany.mock.calls[0][0].data).toHaveLength(1);
  });

  it('should bulk register valid drivers and isolate duplicates or underage rows', async () => {
    prisma.organizationalUnit.findMany.mockResolvedValue([{ id: 'unit-1' }]);
    prisma.driverProfile.findMany
      .mockResolvedValueOnce([{ serviceNumber: 'MOD-EXISTS' }])
      .mockResolvedValueOnce([]);

    const txUserCreate = jest.fn().mockResolvedValue({ id: 'user-bulk-1' });
    const txDriverCreate = jest.fn().mockResolvedValue({
      id: 'drv-bulk-1',
      serviceNumber: 'MOD-BULK-1',
      fullName: 'Cpl. Kebede',
      email: 'driver7@mod.gov.et',
      contactPhone: '+251911000007',
    });

    prisma.$transaction.mockImplementation(async (cb: any) =>
      cb({
        user: { findUnique: jest.fn().mockResolvedValue(null), create: txUserCreate },
        driverProfile: { create: txDriverCreate },
      }),
    );

    const youngYear = new Date().getFullYear() - 16;

    const summary = await service.bulkCreate(
      {
        drivers: [
          {
            serviceNumber: 'MOD-BULK-1',
            firstName: 'Kebede',
            middleName: 'Bikila',
            lastName: 'Tester',
            email: 'driver8@mod.gov.et',
            contactPhone: '+251911000008',
            dateOfBirth: '1994-05-12',
            unitId: 'unit-1',
            initialPassword: 'CustomPass@2026',
          },
          {
            serviceNumber: 'MOD-EXISTS',
            firstName: 'Already', middleName: 'Registered', lastName: 'Tester',
            email: 'driver9@mod.gov.et',
            contactPhone: '+251911000009',
            dateOfBirth: '1992-01-01',
            unitId: 'unit-1',
          },
          {
            serviceNumber: 'MOD-YOUNG',
            firstName: 'Too', middleName: 'Young', lastName: 'Tester',
            email: 'driver10@mod.gov.et',
            contactPhone: '+251911000010',
            dateOfBirth: `${youngYear}-01-01`,
            unitId: 'unit-1',
          },
        ],
      },
      {
        id: 'admin-1',
        serviceNumber: 'MOD-ADMIN-001',
        unitId: 'unit-1',
        resolvedPermissions: [Permission.DRIVERS_VIEW_ALL],
      },
    );

    expect(summary.totalRequested).toBe(3);
    expect(summary.createdCount).toBe(1);
    expect(summary.failedCount).toBe(2);
    expect(summary.results[0].status).toBe('CREATED');
    expect(summary.results[1].status).toBe('FAILED');
    expect(summary.results[2].status).toBe('FAILED');
  });

  describe('already-trained (pre-trained) registration', () => {
    const futureIso = (days: number) => {
      const d = new Date();
      d.setDate(d.getDate() + days);
      return d.toISOString().slice(0, 10);
    };
    const prior = (permitNumber: string) => ({
      categoryCodes: ['CAT-LV'],
      permitNumber,
      issueDate: futureIso(-365),
      expiryDate: futureIso(365),
    });
    const registrar = {
      id: 'coord-1',
      serviceNumber: 'MOD-COORD-001',
      unitId: 'unit-1',
      resolvedPermissions: [Permission.DRIVERS_VIEW_ALL, Permission.APPLICATIONS_CREATE],
    };

    beforeEach(() => {
      prisma.vehicleCategory = {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'cat-lv', code: 'CAT-LV', minAgeRequired: 18 }]),
      };
      prisma.priorPermit = { findMany: jest.fn().mockResolvedValue([]) };
    });

    it('requires permission to submit applications', async () => {
      await expect(
        service.bulkCreate(
          {
            drivers: [
              {
                serviceNumber: 'MOD-PT-1',
                firstName: 'Pre',
                middleName: 'Trained',
                lastName: 'Tester',
                email: 'driver11@mod.gov.et',
                contactPhone: '+251911000011',
                dateOfBirth: '1990-01-01',
                unitId: 'unit-1',
                priorPermit: prior('MOD-P-1'),
              },
            ],
          },
          { ...registrar, resolvedPermissions: [Permission.DRIVERS_VIEW_ALL] },
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('creates driver + READY_FOR_APPROVAL application and rejects in-batch duplicate permits', async () => {
      prisma.organizationalUnit.findMany.mockResolvedValue([{ id: 'unit-1' }]);
      prisma.driverProfile.findMany.mockResolvedValue([]);

      const appCreate = jest.fn().mockImplementation(async ({ data }: any) => ({
        id: 'app-pt-1',
        applicationNumber: data.applicationNumber,
        status: data.status,
        type: data.type,
      }));
      const auditCreate = jest.fn();
      let driverSeq = 0;
      prisma.$transaction.mockImplementation(async (cb: any) =>
        cb({
          user: {
            findUnique: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue({ id: 'user-pt' }),
          },
          driverProfile: {
            create: jest.fn().mockImplementation(async () => ({ id: `drv-pt-${++driverSeq}` })),
          },
          application: {
            findFirst: jest.fn().mockResolvedValue(null),
            create: appCreate,
          },
          auditLog: { create: auditCreate },
        }),
      );

      const summary = await service.bulkCreate(
        {
          drivers: [
            {
              serviceNumber: 'MOD-PT-1',
              firstName: 'Pre',
              middleName: 'Trained',
              lastName: 'Tester',
              email: 'driver12@mod.gov.et',
              contactPhone: '+251911000012',
              dateOfBirth: '1990-01-01',
              unitId: 'unit-1',
              priorPermit: prior('mod-p-1'),
            },
            {
              serviceNumber: 'MOD-PT-2',
              firstName: 'Same', middleName: 'Permit', lastName: 'Tester',
              email: 'driver13@mod.gov.et',
              contactPhone: '+251911000013',
              dateOfBirth: '1991-01-01',
              unitId: 'unit-1',
              priorPermit: prior('MOD-P-1'),
            },
          ],
        },
        registrar,
      );

      expect(summary.createdCount).toBe(1);
      expect(summary.applicationsCreated).toBe(1);
      expect(summary.results[0].application?.status).toBe('READY_FOR_APPROVAL');
      expect(summary.results[1].status).toBe('FAILED');
      expect(summary.results[1].error).toMatch(/already recorded/);

      const data = appCreate.mock.calls[0][0].data;
      expect(data.type).toBe('PRE_TRAINED');
      expect(data.createdById).toBe('coord-1');
      expect(data.priorPermit.create.permitNumber).toBe('MOD-P-1');
      expect(data.requestedCategories.create).toEqual([{ categoryId: 'cat-lv' }]);
      expect(auditCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'CREATE_PRE_TRAINED_APPLICATION' }),
        }),
      );
    });
  });
  describe('lean registration and profile completion', () => {
    const admin = {
      id: 'admin-1',
      serviceNumber: 'MOD-ADMIN-001',
      unitId: 'unit-1',
      resolvedPermissions: [Permission.DRIVERS_VIEW_ALL, Permission.DRIVERS_UPDATE],
    };
    const lean = {
      serviceNumber: 'MOD-LEAN-1',
      firstName: 'Lean',
      middleName: 'Basic',
      lastName: 'Tester',
      rank: 'Private',
      email: 'lean@mod.gov.et',
      contactPhone: '+251911000111',
      unitId: 'unit-1',
    };

    const mockCreateTx = () => {
      const txUserCreate = jest.fn().mockResolvedValue({ id: 'user-lean' });
      const txDriverCreate = jest
        .fn()
        .mockImplementation(async ({ data }: any) => ({ id: 'drv-lean', ...data }));
      prisma.organizationalUnit.findUnique.mockResolvedValue({ id: 'unit-1' });
      prisma.driverProfile.findUnique.mockResolvedValue(null);
      prisma.$transaction.mockImplementation(async (cb: any) =>
        cb({
          user: { findUnique: jest.fn().mockResolvedValue(null), create: txUserCreate },
          driverProfile: { create: txDriverCreate },
        }),
      );
      return { txUserCreate, txDriverCreate };
    };

    it('registers a basic account without DOB: profile starts INCOMPLETE, password must be changed', async () => {
      const { txUserCreate, txDriverCreate } = mockCreateTx();

      const created: any = await service.create(lean, admin);

      expect(created.temporaryPassword).toEqual(expect.any(String));
      expect(created.temporaryPassword.length).toBeGreaterThanOrEqual(8);
      expect(txUserCreate.mock.calls[0][0].data).toEqual(
        expect.objectContaining({ mustChangePassword: true }),
      );
      const data = txDriverCreate.mock.calls[0][0].data;
      expect(data.dateOfBirth).toBeNull();
      expect(data.profileStatus).toBe('INCOMPLETE');
      expect(data.profileCompletedAt).toBeNull();
    });

    it('does not return a temporary password when the admin supplied one', async () => {
      mockCreateTx();
      const created: any = await service.create(
        { ...lean, initialPassword: 'Chosen#2026' },
        admin,
      );
      expect(created.temporaryPassword).toBeUndefined();
    });

    it('marks the profile COMPLETE when every required field is supplied', async () => {
      const { txDriverCreate } = mockCreateTx();
      await service.create(
        {
          ...lean,
          gender: 'MALE',
          nationalIdNumber: 'FAN-1',
          dateOfBirth: '1995-03-10',
          bloodGroup: 'O+',
          photoUrl: 'p.jpg',
          emergencyContactName: 'Almaz',
          emergencyContactPhone: '+251911887766',
        },
        admin,
      );
      expect(txDriverCreate.mock.calls[0][0].data.profileStatus).toBe('COMPLETE');
    });

    it('requires DOB only when an existing permit is recorded', async () => {
      await expect(
        service.create(
          {
            ...lean,
            priorPermit: {
              categoryCodes: ['CAT-LV'],
              permitNumber: 'P-1',
              issueDate: '2024-01-01',
              expiryDate: '2099-01-01',
            },
          },
          { ...admin, resolvedPermissions: [...admin.resolvedPermissions, Permission.APPLICATIONS_CREATE] },
        ),
      ).rejects.toThrow(/Date of birth is required/);
    });

    it('bulk rows each get their own generated temporary password', async () => {
      prisma.organizationalUnit.findMany.mockResolvedValue([{ id: 'unit-1' }]);
      prisma.driverProfile.findMany.mockResolvedValue([]);
      prisma.$transaction.mockImplementation(async (cb: any) =>
        cb({
          user: {
            findUnique: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue({ id: 'u' }),
          },
          driverProfile: {
            create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 'd', ...data })),
          },
        }),
      );

      const summary = await service.bulkCreate(
        {
          drivers: [
            { ...lean, serviceNumber: 'MOD-B-1', email: 'b1@mod.gov.et' },
            { ...lean, serviceNumber: 'MOD-B-2', email: 'b2@mod.gov.et' },
          ],
        },
        admin,
      );

      expect(summary.createdCount).toBe(2);
      const [a, b] = summary.results.map((r) => r.temporaryPassword);
      expect(a).toEqual(expect.any(String));
      expect(b).toEqual(expect.any(String));
      expect(a).not.toBe(b);
    });

    describe('update / self-service completion', () => {
      const incomplete = {
        id: 'drv-1',
        userId: 'user-1',
        nationalIdNumber: null,
        dateOfBirth: null,
        gender: null,
        bloodGroup: null,
        photoUrl: null,
        emergencyContactName: null,
        emergencyContactPhone: null,
        profileStatus: 'INCOMPLETE',
        profileCompletedAt: null,
        identityVerifiedAt: null,
      };

      it('flips to COMPLETE once the last required field arrives', async () => {
        prisma.driverProfile.findUnique
          .mockResolvedValueOnce({
            ...incomplete,
            dateOfBirth: new Date('1995-03-10'),
            gender: 'MALE',
            nationalIdNumber: 'FAN-1',
            bloodGroup: 'O+',
            emergencyContactName: 'Almaz',
          }) // existing row, only the emergency phone is missing
          .mockResolvedValue(null); // national-id duplicate lookup
        prisma.driverProfile.update.mockImplementation(async ({ data }: any) => ({ id: 'drv-1', ...data }));

        await service.update('drv-1', { emergencyContactPhone: '+251911887766' });

        const data = prisma.driverProfile.update.mock.calls[0][0].data;
        expect(data.profileStatus).toBe('COMPLETE');
        expect(data.profileCompletedAt).toBeInstanceOf(Date);
      });

      it('rejects a self-entered DOB under 18', async () => {
        prisma.driverProfile.findUnique.mockResolvedValue(incomplete);
        const young = new Date();
        young.setFullYear(young.getFullYear() - 16);
        await expect(
          service.update('drv-1', { dateOfBirth: young.toISOString() }),
        ).rejects.toThrow(BadRequestException);
      });

      it('voids identity verification when the national ID changes', async () => {
        prisma.driverProfile.findUnique
          .mockResolvedValueOnce({
            ...incomplete,
            nationalIdNumber: 'FAN-OLD',
            identityVerifiedAt: new Date(),
            identityVerifiedBy: 'MOD-LIC-001',
          })
          .mockResolvedValue(null);
        prisma.driverProfile.update.mockImplementation(async ({ data }: any) => ({ id: 'drv-1', ...data }));

        await service.update('drv-1', { nationalIdNumber: 'fan-new' });

        const data = prisma.driverProfile.update.mock.calls[0][0].data;
        expect(data.identityVerifiedAt).toBeNull();
        expect(data.identityVerifiedBy).toBeNull();
      });

      it('keeps identity verification when an unrelated field changes', async () => {
        prisma.driverProfile.findUnique.mockResolvedValueOnce({
          ...incomplete,
          identityVerifiedAt: new Date(),
        });
        prisma.driverProfile.update.mockImplementation(async ({ data }: any) => ({ id: 'drv-1', ...data }));

        await service.update('drv-1', { bloodGroup: 'A+' });

        expect(prisma.driverProfile.update.mock.calls[0][0].data).not.toHaveProperty('identityVerifiedAt');
      });

      it('updateMine looks the profile up by the signed-in user, not by a client-sent id', async () => {
        prisma.driverProfile.findUnique
          .mockResolvedValueOnce(incomplete) // lookup by userId
          .mockResolvedValueOnce(incomplete) // update(): existing
          .mockResolvedValue(null);
        prisma.driverProfile.update.mockImplementation(async ({ data }: any) => ({ id: 'drv-1', ...data }));

        const res: any = await service.updateMine('user-1', { bloodGroup: 'B+' });

        expect(prisma.driverProfile.findUnique.mock.calls[0][0]).toEqual(
          expect.objectContaining({ where: { userId: 'user-1' } }),
        );
        expect(res.missingFields).toContain('emergencyContactPhone');
      });

      describe('details entered by an administrator are read-only for the driver', () => {
        const adminFilled = {
          ...incomplete,
          bloodGroup: 'A+',
          dateOfBirth: new Date('1990-01-01'),
          selfEnteredFields: [] as string[],
        };

        it('reports them as locked', async () => {
          prisma.driverProfile.findUnique.mockResolvedValue({ ...adminFilled, unit: {}, user: {} });
          const res: any = await service.findMine('user-1');
          expect(res.lockedFields).toEqual(['dateOfBirth', 'bloodGroup']);
          expect(res.permitState).toBe('NONE');
          expect(res.missingFields).toContain('emergencyContactPhone');
        });

        it('refuses to change one, and saves nothing', async () => {
          prisma.driverProfile.findUnique.mockResolvedValue(adminFilled);
          await expect(
            service.updateMine('user-1', { bloodGroup: 'B+', gender: 'MALE' }),
          ).rejects.toMatchObject({
            response: { code: 'PROFILE_FIELD_LOCKED', params: { fields: 'bloodGroup' } },
          });
          expect(prisma.driverProfile.update).not.toHaveBeenCalled();
        });

        it('refuses to change a locked date of birth', async () => {
          prisma.driverProfile.findUnique.mockResolvedValue(adminFilled);
          await expect(
            service.updateMine('user-1', { dateOfBirth: '1995-05-05' }),
          ).rejects.toMatchObject({ response: { code: 'PROFILE_FIELD_LOCKED' } });
        });

        it('ignores a locked field re-sent with the same value, and still saves the rest', async () => {
          prisma.driverProfile.findUnique
            .mockResolvedValueOnce(adminFilled)
            .mockResolvedValueOnce(adminFilled)
            .mockResolvedValue(null);
          prisma.driverProfile.update.mockImplementation(async ({ data }: any) => ({ id: 'drv-1', ...data }));

          await service.updateMine('user-1', {
            bloodGroup: 'a+',
            dateOfBirth: '1990-01-01',
            gender: 'FEMALE',
          });

          const data = prisma.driverProfile.update.mock.calls[0][0].data;
          expect(data.gender).toBe('FEMALE');
          expect(data.bloodGroup).toBeUndefined(); // untouched
          expect(data.dateOfBirth).toBeUndefined();
          expect(data.selfEnteredFields).toEqual(['gender']); // only what the driver typed
        });

        it('lets the driver keep correcting what they typed themselves', async () => {
          const own = { ...adminFilled, gender: 'MALE', selfEnteredFields: ['gender'] };
          prisma.driverProfile.findUnique
            .mockResolvedValueOnce(own)
            .mockResolvedValueOnce(own)
            .mockResolvedValue(null);
          prisma.driverProfile.update.mockImplementation(async ({ data }: any) => ({ id: 'drv-1', ...data }));

          await service.updateMine('user-1', { gender: 'FEMALE' });

          expect(prisma.driverProfile.update.mock.calls[0][0].data.gender).toBe('FEMALE');
        });

        it('a field an administrator edits becomes admin-owned again', async () => {
          prisma.driverProfile.findUnique.mockResolvedValue({
            ...incomplete,
            gender: 'MALE',
            selfEnteredFields: ['gender', 'photoUrl'],
          });
          prisma.driverProfile.update.mockImplementation(async ({ data }: any) => ({ id: 'drv-1', ...data }));

          await service.update('drv-1', { gender: 'FEMALE' }); // admin: no selfEntered option

          expect(prisma.driverProfile.update.mock.calls[0][0].data.selfEnteredFields).toEqual(['photoUrl']);
        });
      });

      it('updateMine fails for an account without a driver profile', async () => {
        prisma.driverProfile.findUnique.mockResolvedValue(null);
        await expect(service.updateMine('staff-1', { bloodGroup: 'B+' })).rejects.toThrow(/not found/i);
      });
    });

    describe('resetPassword', () => {
      it('issues a new temporary password and forces a change', async () => {
        prisma.driverProfile.findUnique.mockResolvedValue({
          id: 'drv-1',
          userId: 'user-1',
          unitId: 'unit-1',
          user: { roles: ['STAFF_DRIVER'] },
        });
        const res = await service.resetPassword('drv-1', admin);

        expect(res.temporaryPassword.length).toBeGreaterThanOrEqual(8);
        expect(prisma.user.update.mock.calls[0][0].data).toEqual(
          expect.objectContaining({ mustChangePassword: true }),
        );
      });

      it('lets a unit coordinator reset only plain drivers of their own unit', async () => {
        const coordinator = {
          id: 'coord-1',
          serviceNumber: 'C-1',
          unitId: 'unit-1',
          resolvedPermissions: [Permission.DRIVERS_VIEW_UNIT, Permission.DRIVERS_UPDATE],
        };
        prisma.driverProfile.findUnique.mockResolvedValue({
          id: 'drv-2',
          userId: 'user-2',
          unitId: 'unit-2',
          user: { roles: ['STAFF_DRIVER'] },
        });
        await expect(service.resetPassword('drv-2', coordinator)).rejects.toThrow(ForbiddenException);

        // same unit, but the person is also an examiner: not theirs to reset
        prisma.driverProfile.findUnique.mockResolvedValue({
          id: 'drv-3',
          userId: 'user-3',
          unitId: 'unit-1',
          user: { roles: ['STAFF_DRIVER', 'EXAMINER'] },
        });
        await expect(service.resetPassword('drv-3', coordinator)).rejects.toThrow(ForbiddenException);
        expect(prisma.user.update).not.toHaveBeenCalled();
      });

      it('refuses to reset your own password', async () => {
        prisma.driverProfile.findUnique.mockResolvedValue({
          id: 'drv-1',
          userId: 'admin-1',
          unitId: 'unit-1',
          user: { roles: ['STAFF_DRIVER'] },
        });
        await expect(service.resetPassword('drv-1', admin)).rejects.toThrow(BadRequestException);
      });
    });
  });
});
