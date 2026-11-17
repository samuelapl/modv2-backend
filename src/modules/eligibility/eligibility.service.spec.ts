import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  CredentialStatus,
  MedicalFitnessOutcome,
  PersonnelStatus,
  VerificationStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CredentialsService } from '../credentials/credentials.service';
import { EligibilityService } from './eligibility.service';

describe('EligibilityService', () => {
  let service: EligibilityService;

  const mockPrisma: any = {
    vehicleCategory: { findMany: jest.fn(), findUnique: jest.fn() },
    issuedCredential: { findUnique: jest.fn() },
    driverProfile: { findUnique: jest.fn() },
    auditLog: { create: jest.fn() },
  };

  const mockCredentialsService: any = {
    verifyQrToken: jest.fn(),
  };

  const guardUser = {
    id: 'user-guard-1',
    serviceNumber: 'MOD-GUARD-001',
    unitId: 'unit-1',
    resolvedPermissions: ['eligibility:check', 'credentials:verify_qr'],
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EligibilityService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: CredentialsService, useValue: mockCredentialsService },
      ],
    }).compile();

    service = module.get<EligibilityService>(EligibilityService);
  });

  it('throws 404 when target category does not exist', async () => {
    mockPrisma.vehicleCategory.findUnique.mockResolvedValue(null);

    await expect(
      service.checkEligibility(
        { serviceNumber: 'MOD-88219', categoryCode: 'CAT-XX' },
        guardUser,
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('returns NOT ELIGIBLE when driver lacks requested CAT-HV endorsement', async () => {
    mockPrisma.vehicleCategory.findUnique.mockResolvedValue({
      id: 'cat-hv',
      code: 'CAT-HV',
      name: 'Heavy Freight',
      requiresNationalLicense: true,
      requiresMedical: true,
      isActive: true,
    });

    mockPrisma.driverProfile.findUnique.mockResolvedValue({
      id: 'drv-1',
      serviceNumber: 'MOD-88219',
      fullName: 'Cpl. Dawit Tesfaye',
      photoUrl: null,
      personnelStatus: PersonnelStatus.ACTIVE,
      unit: { id: 'u1', code: 'LOG-CORPS', name: 'Logistics' },
      nationalLicense: {
        verificationStatus: VerificationStatus.VERIFIED,
        expiryDate: new Date('2030-01-01'),
      },
      medicalReviews: [
        {
          outcome: MedicalFitnessOutcome.FIT_WITH_RESTRICTIONS,
          operationalRestrictions: ['CORRECTIVE_LENSES'],
          reviewDueDate: new Date('2029-01-01'),
        },
      ],
      suspensions: [],
      issuedCredentials: [
        {
          credentialNumber: 'MOD-AUTH-2026-0001',
          serialNumber: 'SN-1',
          status: CredentialStatus.ACTIVE,
          issueDate: new Date('2026-01-01'),
          expiryDate: new Date('2029-01-01'),
          activeRestrictions: ['CORRECTIVE_LENSES'],
          categories: [{ category: { code: 'CAT-LV', name: 'Light Vehicle' } }],
        },
      ],
    });

    const result = await service.checkEligibility(
      { serviceNumber: 'MOD-88219', categoryCode: 'CAT-HV' },
      guardUser,
    );

    expect(result.eligible).toBe(false);
    expect(result.reasons[0]).toMatch(/Not authorized for Category CAT-HV/i);
  });

  it('returns ELIGIBLE with active CORRECTIVE_LENSES restriction for endorsed CAT-LV', async () => {
    mockPrisma.vehicleCategory.findUnique.mockResolvedValue({
      id: 'cat-lv',
      code: 'CAT-LV',
      name: 'Light Vehicle',
      requiresNationalLicense: true,
      requiresMedical: true,
      isActive: true,
    });

    mockPrisma.driverProfile.findUnique.mockResolvedValue({
      id: 'drv-1',
      serviceNumber: 'MOD-88219',
      fullName: 'Cpl. Dawit Tesfaye',
      photoUrl: null,
      personnelStatus: PersonnelStatus.ACTIVE,
      unit: { id: 'u1', code: 'LOG-CORPS', name: 'Logistics' },
      nationalLicense: {
        verificationStatus: VerificationStatus.VERIFIED,
        expiryDate: new Date('2030-01-01'),
      },
      medicalReviews: [
        {
          outcome: MedicalFitnessOutcome.FIT_WITH_RESTRICTIONS,
          operationalRestrictions: ['CORRECTIVE_LENSES'],
          reviewDueDate: new Date('2029-01-01'),
        },
      ],
      suspensions: [],
      issuedCredentials: [
        {
          credentialNumber: 'MOD-AUTH-2026-0001',
          serialNumber: 'SN-1',
          status: CredentialStatus.ACTIVE,
          issueDate: new Date('2026-01-01'),
          expiryDate: new Date('2029-01-01'),
          activeRestrictions: ['CORRECTIVE_LENSES'],
          categories: [{ category: { code: 'CAT-LV', name: 'Light Vehicle' } }],
        },
      ],
    });

    const result = await service.checkEligibility(
      { serviceNumber: 'MOD-88219', categoryCode: 'CAT-LV' },
      guardUser,
    );

    expect(result.eligible).toBe(true);
    expect(result.activeRestrictions).toEqual(['CORRECTIVE_LENSES']);
  });

  it('blocks dispatch immediately when an active suspension exists', async () => {
    mockPrisma.vehicleCategory.findUnique.mockResolvedValue({
      id: 'cat-lv',
      code: 'CAT-LV',
      name: 'Light Vehicle',
      requiresNationalLicense: false,
      requiresMedical: false,
      isActive: true,
    });

    mockPrisma.driverProfile.findUnique.mockResolvedValue({
      id: 'drv-1',
      serviceNumber: 'MOD-88219',
      fullName: 'Cpl. Dawit Tesfaye',
      photoUrl: null,
      personnelStatus: PersonnelStatus.SUSPENDED,
      unit: { id: 'u1', code: 'LOG-CORPS', name: 'Logistics' },
      nationalLicense: null,
      medicalReviews: [],
      suspensions: [
        { reason: 'Major convoy violation', legalBasis: 'Art 14.2' },
      ],
      issuedCredentials: [
        {
          credentialNumber: 'MOD-AUTH-2026-0001',
          serialNumber: 'SN-1',
          status: CredentialStatus.SUSPENDED,
          issueDate: new Date('2026-01-01'),
          expiryDate: new Date('2029-01-01'),
          activeRestrictions: [],
          categories: [{ category: { code: 'CAT-LV', name: 'Light Vehicle' } }],
        },
      ],
    });

    const result = await service.checkEligibility(
      { serviceNumber: 'MOD-88219', categoryCode: 'CAT-LV' },
      guardUser,
    );

    expect(result.eligible).toBe(false);
    expect(result.reasons.length).toBeGreaterThanOrEqual(3);
  });

  it('returns invalid verdict when QR signature verification fails', async () => {
    mockCredentialsService.verifyQrToken.mockResolvedValue({
      cryptographicValid: false,
      valid: false,
      reason: 'Tampered QR payload',
      credential: null,
    });

    const res = await service.scanQrCheckpoint(
      { token: 'BAD.TOKEN.SIG' },
      guardUser,
    );

    expect(res.cryptographicValid).toBe(false);
    expect(res.eligible).toBe(false);
  });
});
