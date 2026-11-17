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
          fullName: 'Young Recruit',
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
          fullName: 'Sgt. Cross',
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
          fullName: 'Duplicate Soldier',
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

  it('should throw ConflictException on duplicate nationalIdNumber', async () => {
    prisma.organizationalUnit.findUnique.mockResolvedValue({ id: 'unit-1' });
    prisma.driverProfile.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'existing-by-national-id' });

    await expect(
      service.create(
        {
          serviceNumber: 'MOD-88299',
          fullName: 'Sgt. Tesfaye',
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
        fullName: 'Sgt. Abebe Bikila',
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
    expect(txUserCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          serviceNumber: 'MOD-77001',
          fullName: 'Sgt. Abebe Bikila',
          rank: 'Sergeant',
          phone: '+251911223344',
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
            fullName: 'Cpl. Kebede',
            dateOfBirth: '1994-05-12',
            unitId: 'unit-1',
            initialPassword: 'CustomPass@2026',
          },
          {
            serviceNumber: 'MOD-EXISTS',
            fullName: 'Already Registered',
            dateOfBirth: '1992-01-01',
            unitId: 'unit-1',
          },
          {
            serviceNumber: 'MOD-YOUNG',
            fullName: 'Too Young',
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
                fullName: 'Sgt. Pre Trained',
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
              fullName: 'Sgt. Pre Trained',
              dateOfBirth: '1990-01-01',
              unitId: 'unit-1',
              priorPermit: prior('mod-p-1'),
            },
            {
              serviceNumber: 'MOD-PT-2',
              fullName: 'Cpl. Same Permit',
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
});
