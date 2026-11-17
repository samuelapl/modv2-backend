import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { VerificationStatus } from '@prisma/client';
import { NationalLicenseService } from './national-license.service';
import { PrismaService } from '../../prisma/prisma.service';
import { LICENSE_VERIFIER_TOKEN } from './interfaces/license-verifier.interface';
import { ManualLicenseVerifier } from './providers/manual-license.verifier';
import { Permission } from '../../common/enums/permissions.enum';

describe('NationalLicenseService', () => {
  let service: NationalLicenseService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      driverProfile: { findUnique: jest.fn() },
      nationalLicense: {
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        upsert: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NationalLicenseService,
        { provide: PrismaService, useValue: prisma },
        { provide: LICENSE_VERIFIER_TOKEN, useClass: ManualLicenseVerifier },
      ],
    }).compile();

    service = module.get<NationalLicenseService>(NationalLicenseService);
  });

  it('should report READY status', () => {
    expect(service.getStatus().status).toBe('READY');
  });

  it('should reject when expiryDate is on or before issuedDate', async () => {
    prisma.driverProfile.findUnique.mockResolvedValue({
      id: 'drv-1',
      userId: 'u1',
      unitId: 'unit-1',
    });

    await expect(
      service.upsertForDriver(
        {
          driverProfileId: 'drv-1',
          licenseNumber: 'ETH-100',
          issuingAuthority: 'Federal Transport Authority',
          categories: ['Category 1 - Auto'],
          issuedDate: '2026-05-01',
          expiryDate: '2025-05-01',
        },
        {
          id: 'u1',
          serviceNumber: 'MOD-88219',
          unitId: 'unit-1',
          resolvedPermissions: [Permission.NATIONAL_DL_SUBMIT],
        },
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('should throw ConflictException if licenseNumber belongs to another driver', async () => {
    prisma.driverProfile.findUnique.mockResolvedValue({
      id: 'drv-1',
      userId: 'u1',
      unitId: 'unit-1',
    });
    prisma.nationalLicense.findFirst.mockResolvedValue({ id: 'other-lic' });

    await expect(
      service.upsertForDriver(
        {
          driverProfileId: 'drv-1',
          licenseNumber: 'ETH-DUP-001',
          issuingAuthority: 'Federal Transport Authority',
          categories: ['Category 1 - Auto'],
          issuedDate: '2023-01-01',
          expiryDate: '2028-01-01',
        },
        {
          id: 'coord-1',
          serviceNumber: 'MOD-COORD-001',
          unitId: 'unit-1',
          resolvedPermissions: [Permission.DRIVERS_VIEW_UNIT],
        },
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('should reset verificationStatus to UNVERIFIED on upsert', async () => {
    prisma.driverProfile.findUnique.mockResolvedValue({
      id: 'drv-1',
      userId: 'u1',
      unitId: 'unit-1',
    });
    prisma.nationalLicense.findFirst.mockResolvedValue(null);
    prisma.nationalLicense.upsert.mockResolvedValue({
      id: 'lic-1',
      licenseNumber: 'ETH-NEW-001',
      verificationStatus: VerificationStatus.UNVERIFIED,
    });

    const result = await service.upsertForDriver(
      {
        driverProfileId: 'drv-1',
        licenseNumber: 'eth-new-001',
        issuingAuthority: 'Federal Transport Authority',
        categories: ['Category 1 - Auto'],
        issuedDate: '2024-01-01',
        expiryDate: '2029-01-01',
      },
      {
        id: 'coord-1',
        serviceNumber: 'MOD-COORD-001',
        unitId: 'unit-1',
        resolvedPermissions: [Permission.DRIVERS_VIEW_UNIT],
      },
    );

    expect(result.verificationStatus).toBe(VerificationStatus.UNVERIFIED);
    expect(prisma.nationalLicense.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          verificationStatus: VerificationStatus.UNVERIFIED,
          verifiedAt: null,
        }),
      }),
    );
  });

  it('should block an officer from verifying their own personal license', async () => {
    prisma.nationalLicense.findUnique.mockResolvedValue({
      id: 'lic-1',
      expiryDate: new Date('2029-01-01'),
      driverProfile: { userId: 'officer-user-id' },
    });

    await expect(
      service.verifyLicense(
        'lic-1',
        { status: VerificationStatus.VERIFIED },
        { id: 'officer-user-id', serviceNumber: 'MOD-LIC-001', unitId: 'u1' },
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('should reject verifying an already-expired national license', async () => {
    prisma.nationalLicense.findUnique.mockResolvedValue({
      id: 'lic-1',
      expiryDate: new Date('2020-01-01'),
      driverProfile: { userId: 'driver-user-id' },
    });

    await expect(
      service.verifyLicense(
        'lic-1',
        { status: VerificationStatus.VERIFIED },
        { id: 'officer-id', serviceNumber: 'MOD-LIC-001', unitId: 'u1' },
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('should verify valid license and stamp verifier metadata', async () => {
    prisma.nationalLicense.findUnique.mockResolvedValue({
      id: 'lic-1',
      expiryDate: new Date('2029-01-01'),
      driverProfile: { userId: 'driver-user-id' },
    });
    prisma.nationalLicense.update.mockResolvedValue({
      id: 'lic-1',
      verificationStatus: VerificationStatus.VERIFIED,
      verifiedByUserId: 'MOD-LIC-001',
    });

    const result = await service.verifyLicense(
      'lic-1',
      { status: VerificationStatus.VERIFIED, verificationNotes: 'Authentic card' },
      { id: 'officer-id', serviceNumber: 'MOD-LIC-001', unitId: 'u1' },
    );

    expect(result.verificationStatus).toBe(VerificationStatus.VERIFIED);
    expect(result.verifiedByUserId).toBe('MOD-LIC-001');
  });
});
