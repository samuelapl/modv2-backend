import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import {
  ApplicationStatus,
  ApplicationType,
  CredentialStatus,
  MedicalFitnessOutcome,
  PersonnelStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { Permission } from '../../common/enums/permissions.enum';
import { CredentialsService } from './credentials.service';
import { signCredentialPayload } from './helpers/qr-signer.helper';

/** Statutory fields a driver needs before a card can be issued. */
const CARD_FIELDS = {
  rank: 'Sgt.',
  bloodGroup: 'O+',
  dateOfBirth: new Date('1990-05-01'),
  fullNameAm: 'ክብረት መንግስቱ ዘውዴ',
};

describe('CredentialsService', () => {
  let service: CredentialsService;

  const mockTx: any = {
    issuedCredential: {
      updateMany: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    application: { update: jest.fn() },
    auditLog: { create: jest.fn() },
  };

  const mockPrisma: any = {
    application: { findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn() },
    issuedCredential: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      count: jest.fn(),
    },
    cardReprint: { findUnique: jest.fn() },
    driverProfile: { findUnique: jest.fn() },
    $transaction: jest.fn((fn: (tx: any) => any) => fn(mockTx)),
  };

  const issuerUser = {
    id: 'user-issuer-1',
    serviceNumber: 'MOD-ISSUER-001',
    unitId: 'unit-1',
    resolvedPermissions: ['credentials:issue'],
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CredentialsService,
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: ConfigService,
          useValue: { get: () => 'unit_test_qr_secret_2026' },
        },
      ],
    }).compile();

    service = module.get<CredentialsService>(CredentialsService);
  });

  it('rejects issuance when application is not APPROVED', async () => {
    mockPrisma.application.findUnique.mockResolvedValue({
      id: 'app-1',
      status: ApplicationStatus.READY_FOR_APPROVAL,
      driverProfile: { userId: 'u1', medicalReviews: [], suspensions: [] },
      requestedCategories: [],
    });

    await expect(
      service.issueFromApplication({ applicationId: 'app-1' }, issuerUser),
    ).rejects.toThrow(BadRequestException);
  });

  it('prevents duplicate issuance for already-issued application cycle', async () => {
    mockPrisma.application.findUnique.mockResolvedValue({
      id: 'app-1',
      status: ApplicationStatus.APPROVED,
      currentStage: 'Credential Issued — MOD-AUTH-2026-0001',
      driverProfile: { userId: 'u1', medicalReviews: [], suspensions: [] },
      requestedCategories: [],
    });

    await expect(
      service.issueFromApplication({ applicationId: 'app-1' }, issuerUser),
    ).rejects.toThrow(ConflictException);
  });

  it('blocks self-issuance with 403 Forbidden', async () => {
    mockPrisma.application.findUnique.mockResolvedValue({
      id: 'app-1',
      status: ApplicationStatus.APPROVED,
      currentStage: 'Approved by Command Authority',
      driverProfile: {
        userId: 'user-issuer-1',
        medicalReviews: [],
        suspensions: [],
      },
      requestedCategories: [],
    });

    await expect(
      service.issueFromApplication({ applicationId: 'app-1' }, issuerUser),
    ).rejects.toThrow(ForbiddenException);
  });

  it('merges categories on ADDITIONAL_CATEGORY, inherits medical restrictions, supersedes old card, and signs QR', async () => {
    mockPrisma.application.findUnique.mockResolvedValue({
      id: 'app-2',
      driverProfileId: 'drv-1',
      type: ApplicationType.ADDITIONAL_CATEGORY,
      status: ApplicationStatus.APPROVED,
      currentStage: 'Approved by Command Authority',
      driverProfile: {
        id: 'drv-1',
        userId: 'u-drv-1',
        serviceNumber: 'MOD-1234',
        ...CARD_FIELDS,
        personnelStatus: PersonnelStatus.ACTIVE,
        medicalReviews: [
          {
            outcome: MedicalFitnessOutcome.FIT_WITH_RESTRICTIONS,
            operationalRestrictions: ['CORRECTIVE_LENSES'],
          },
        ],
        suspensions: [],
      },
      requestedCategories: [
        {
          categoryId: 'cat-hv',
          category: { id: 'cat-hv', code: 'CAT-HV', validityYears: 3, requiresMedical: true },
        },
      ],
    });

    mockPrisma.issuedCredential.findMany.mockResolvedValue([
      {
        id: 'old-cred-1',
        categories: [
          {
            categoryId: 'cat-sp',
            category: { id: 'cat-sp', code: 'CAT-SP', validityYears: 2 },
          },
        ],
      },
    ]);
    mockPrisma.issuedCredential.findFirst.mockResolvedValue(null);

    mockTx.issuedCredential.create.mockImplementation(async ({ data }: any) => ({
      id: 'new-cred-1',
      ...data,
      categories: [],
      driverProfile: { serviceNumber: 'MOD-1234' },
      issuer: { serviceNumber: 'MOD-ISSUER-001' },
    }));

    const issued = await service.issueFromApplication(
      { applicationId: 'app-2' },
      issuerUser,
    );

    expect(mockTx.issuedCredential.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['old-cred-1'] } },
      data: { status: CredentialStatus.SUPERSEDED },
    });
    expect(issued.credentialNumber).toMatch(/^MOD-AUTH-\d{4}-0001$/);
    expect(issued.activeRestrictions).toEqual(['CORRECTIVE_LENSES']);
    expect(issued.qrHashSignature).toMatch(/^IDLMS1\./);
    expect(issued.qrDataUrl).toMatch(/^data:image\/png;base64,/);
  });

  describe('ADDITIONAL_CATEGORY issuance', () => {
    const base = (overrides: any = {}) => ({
      id: 'base-cred',
      credentialNumber: 'MOD-AUTH-2026-0002',
      status: CredentialStatus.ACTIVE,
      issueDate: new Date('2026-01-01T00:00:00.000Z'),
      expiryDate: new Date(Date.now() + 300 * 86400000),
      activeRestrictions: [],
      categories: [
        { categoryId: 'cat-sp', category: { id: 'cat-sp', code: 'CAT-SP', validityYears: 2 } },
      ],
      ...overrides,
    });
    const upgradeApp = (upgradedFrom: any) => ({
      id: 'app-up',
      driverProfileId: 'drv-up',
      type: ApplicationType.ADDITIONAL_CATEGORY,
      status: ApplicationStatus.APPROVED,
      currentStage: 'Approved by Command Authority',
      driverProfile: {
        id: 'drv-up',
        userId: 'u-drv-up',
        serviceNumber: 'MOD-UP-1',
        ...CARD_FIELDS,
        personnelStatus: PersonnelStatus.ACTIVE,
        medicalReviews: [{ outcome: MedicalFitnessOutcome.FIT, operationalRestrictions: [] }],
        suspensions: [],
      },
      requestedCategories: [
        { categoryId: 'cat-hv', category: { id: 'cat-hv', code: 'CAT-HV', validityYears: 3, requiresMedical: true } },
      ],
      replacesCredential: upgradedFrom,
    });

    it('merges onto the linked permit with a new full validity and supersedes it', async () => {
      mockPrisma.application.findUnique.mockResolvedValue(upgradeApp(base()));
      // An unrelated active permit must not leak categories into the merge.
      mockPrisma.issuedCredential.findMany.mockResolvedValue([
        base(),
        { id: 'other', categories: [{ categoryId: 'cat-pt', category: { id: 'cat-pt', code: 'CAT-PT', validityYears: 5 } }] },
      ]);
      mockPrisma.issuedCredential.findFirst.mockResolvedValue(null);
      mockTx.issuedCredential.create.mockImplementation(async ({ data }: any) => ({ id: 'new', ...data }));

      const before = Date.now();
      const issued: any = await service.issueFromApplication({ applicationId: 'app-up' }, issuerUser);

      expect(issued.categories.create).toEqual([
        { categoryId: 'cat-sp' },
        { categoryId: 'cat-hv' },
      ]);
      // Full validity from today using the shortest category period (CAT-SP: 2y).
      const years = (issued.expiryDate.getTime() - before) / (365.25 * 86400000);
      expect(years).toBeGreaterThan(1.99);
      expect(years).toBeLessThan(2.01);
      expect(mockTx.auditLog.create.mock.calls[0][0].data.newValue).toMatchObject({
        upgradedFromCredentialNumber: 'MOD-AUTH-2026-0002',
        addedCategories: ['CAT-HV'],
      });
    });

    it('refuses when the permit being upgraded has expired', async () => {
      mockPrisma.application.findUnique.mockResolvedValue(
        upgradeApp(base({ expiryDate: new Date(Date.now() - 86400000) })),
      );
      await expect(
        service.issueFromApplication({ applicationId: 'app-up' }, issuerUser),
      ).rejects.toThrow(/categories can't be added/);
      expect(mockTx.issuedCredential.create).not.toHaveBeenCalled();
    });
  });

  describe('REPLACEMENT issuance', () => {
    const issueDate = new Date('2025-03-01T00:00:00.000Z');
    const expiryDate = new Date(Date.now() + 200 * 86400000);
    const replacedPermit = (overrides: any = {}) => ({
      id: 'old-cred',
      credentialNumber: 'MOD-AUTH-2025-0007',
      status: CredentialStatus.ACTIVE,
      issueDate,
      expiryDate,
      activeRestrictions: ['CORRECTIVE_LENSES'],
      categories: [
        { categoryId: 'cat-sp', category: { id: 'cat-sp', code: 'CAT-SP', validityYears: 2 } },
      ],
      ...overrides,
    });
    const replacementApp = (replaced: any) => ({
      id: 'app-rp',
      driverProfileId: 'drv-rp',
      type: ApplicationType.REPLACEMENT,
      status: ApplicationStatus.APPROVED,
      currentStage: 'Approved by Command Authority',
      replacementReason: 'LOST',
      driverProfile: {
        id: 'drv-rp',
        userId: 'u-drv-rp',
        serviceNumber: 'MOD-RP-1',
        ...CARD_FIELDS,
        personnelStatus: PersonnelStatus.ACTIVE,
        // A newer medical must not change a replacement card's restrictions.
        medicalReviews: [{ outcome: MedicalFitnessOutcome.FIT, operationalRestrictions: [] }],
        suspensions: [],
      },
      // Whatever was requested, the replaced permit's categories win.
      requestedCategories: [
        { categoryId: 'cat-hv', category: { id: 'cat-hv', code: 'CAT-HV', validityYears: 3, requiresMedical: true } },
      ],
      replacesCredential: replaced,
    });

    it('copies categories, dates and restrictions; only number, serial and QR are new', async () => {
      mockPrisma.application.findUnique.mockResolvedValue(
        replacementApp(replacedPermit()),
      );
      mockPrisma.issuedCredential.findMany.mockResolvedValue([{ id: 'old-cred', categories: [] }]);
      mockPrisma.issuedCredential.findFirst.mockResolvedValue(null);
      mockTx.issuedCredential.create.mockImplementation(async ({ data }: any) => ({
        id: 'new-cred',
        ...data,
      }));

      const issued: any = await service.issueFromApplication(
        { applicationId: 'app-rp', validityYearsOverride: 5 },
        issuerUser,
      );

      expect(issued.issueDate).toEqual(issueDate);
      expect(issued.expiryDate).toEqual(expiryDate);
      expect(issued.activeRestrictions).toEqual(['CORRECTIVE_LENSES']);
      expect(issued.categories.create).toEqual([{ categoryId: 'cat-sp' }]);
      expect(issued.credentialNumber).not.toBe('MOD-AUTH-2025-0007');
      expect(mockTx.issuedCredential.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['old-cred'] } },
        data: { status: CredentialStatus.SUPERSEDED },
      });
      expect(mockTx.auditLog.create.mock.calls[0][0].data.newValue).toMatchObject({
        replacesCredentialNumber: 'MOD-AUTH-2025-0007',
        replacementReason: 'LOST',
      });
    });

    it.each([
      ['expired', { expiryDate: new Date(Date.now() - 86400000) }],
      ['suspended', { status: CredentialStatus.SUSPENDED }],
    ])('refuses when the replaced permit is %s', async (_label, overrides) => {
      mockPrisma.application.findUnique.mockResolvedValue(
        replacementApp(replacedPermit(overrides)),
      );
      await expect(
        service.issueFromApplication({ applicationId: 'app-rp' }, issuerUser),
      ).rejects.toThrow(/no longer active/);
      expect(mockTx.issuedCredential.create).not.toHaveBeenCalled();
    });
  });

  describe('PRE_TRAINED issuance', () => {
    const preTrainedApp = (priorPermit: any) => ({
      id: 'app-pt',
      driverProfileId: 'drv-pt',
      type: ApplicationType.PRE_TRAINED,
      status: ApplicationStatus.APPROVED,
      currentStage: 'Approved by Command Authority',
      driverProfile: {
        id: 'drv-pt',
        userId: 'u-drv-pt',
        serviceNumber: 'MOD-PT-1',
        personnelStatus: PersonnelStatus.ACTIVE,
        medicalReviews: [],
        suspensions: [],
      },
      requestedCategories: [
        {
          categoryId: 'cat-lv',
          category: { id: 'cat-lv', code: 'CAT-LV', validityYears: 3, requiresMedical: true },
        },
      ],
      priorPermit,
    });

    it('records the existing permit with its original number and dates and NO card', async () => {
      const issueDate = new Date('2024-05-10T00:00:00.000Z');
      const expiryDate = new Date();
      expiryDate.setFullYear(expiryDate.getFullYear() + 1);

      mockPrisma.application.findUnique.mockResolvedValue(
        preTrainedApp({ permitNumber: 'MOD-P-1234', issueDate, expiryDate }),
      );
      mockTx.issuedCredential.findUnique.mockResolvedValue(null);
      mockTx.issuedCredential.create.mockImplementation(async ({ data }: any) => ({
        id: 'cred-pt',
        ...data,
      }));
      mockPrisma.issuedCredential.findUniqueOrThrow.mockResolvedValue({
        id: 'cred-pt',
        credentialNumber: 'MOD-P-1234',
        cardIssued: false,
        issueDate,
        expiryDate,
      });

      const issued: any = await service.issueFromApplication(
        { applicationId: 'app-pt', validityYearsOverride: 5 } as any,
        issuerUser,
      );

      expect(mockTx.issuedCredential.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            credentialNumber: 'MOD-P-1234',
            cardIssued: false,
            issueDate,
            expiryDate,
          }),
        }),
      );
      expect(issued.qrDataUrl).toBeNull();
      expect(issued.cardIssued).toBe(false);
      expect(mockTx.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'RECORD_EXISTING_PERMIT',
            newValue: expect.objectContaining({ permitNumber: 'MOD-P-1234' }),
          }),
        }),
      );
    });

    it('refuses to issue when the existing permit has expired since approval', async () => {
      mockPrisma.application.findUnique.mockResolvedValue(
        preTrainedApp({
          permitNumber: 'MOD-P-OLD',
          issueDate: new Date('2020-01-01'),
          expiryDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
        }),
      );
      mockPrisma.issuedCredential.findMany.mockResolvedValue([]);

      await expect(
        service.issueFromApplication({ applicationId: 'app-pt' }, issuerUser),
      ).rejects.toThrow(/expired/);
      expect(mockTx.issuedCredential.create).not.toHaveBeenCalled();
    });
  });

  it('bulk issue reports per-case failures without stopping the batch', async () => {
    const spy = jest
      .spyOn(service, 'issueFromApplication')
      .mockResolvedValueOnce({ id: 'c1', credentialNumber: 'MOD-DL-2026-00001' } as any)
      .mockRejectedValueOnce(
        new BadRequestException('Cannot issue credential while driver has an active suspension.'),
      );

    const res = await service.bulkIssue(['a1', 'a2', 'a1'], {
      id: 'issuer-1',
      serviceNumber: 'MOD-ISSUER-001',
      unitId: null,
    } as any);

    expect(spy).toHaveBeenCalledTimes(2);
    expect(res).toMatchObject({ totalRequested: 2, issuedCount: 1, failedCount: 1 });
    expect(res.results[0]).toMatchObject({ status: 'ISSUED', credentialNumber: 'MOD-DL-2026-00001' });
    expect(res.results[1].error).toContain('active suspension');
  });

  it('blocks card issuance when statutory fields are missing', async () => {
    mockPrisma.application.findUnique.mockResolvedValue({
      id: 'app-blocked',
      type: ApplicationType.NEW_AUTHORIZATION,
      status: ApplicationStatus.APPROVED,
      currentStage: 'Approved',
      driverProfile: {
        id: 'drv-b',
        userId: 'u-b',
        serviceNumber: 'MOD-B-1',
        personnelStatus: PersonnelStatus.ACTIVE,
        rank: 'Sgt.',
        bloodGroup: null,
        dateOfBirth: new Date('1990-05-01'),
        fullNameAm: '  ',
        medicalReviews: [],
        suspensions: [],
      },
      requestedCategories: [],
    });

    await expect(
      service.issueFromApplication({ applicationId: 'app-blocked' }, issuerUser),
    ).rejects.toThrow(/Blood Group, Amharic Full Name/);
    expect(mockTx.issuedCredential.create).not.toHaveBeenCalled();
  });

  it('verify-qr answers CARD_REPLACED for the old QR of a reprinted card', async () => {
    const oldToken = signCredentialPayload(
      { cred: 'MOD-AUTH-2026-0042', serial: 'SN-OLD', drv: 'MOD-1', cats: ['CAT-HV'], exp: '2099-01-01T00:00:00.000Z' },
      'unit_test_qr_secret_2026',
    );
    // The old token no longer matches any credential row (the row now holds the new QR)...
    mockPrisma.issuedCredential.findFirst.mockResolvedValue(null);
    // ...but its serial is on record as replaced.
    mockPrisma.cardReprint.findUnique.mockResolvedValue({
      createdAt: new Date('2026-11-01'),
      reasonCode: 'DAMAGED',
    });

    const res: any = await service.verifyQrToken(oldToken);

    expect(mockPrisma.cardReprint.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { oldSerial: 'SN-OLD' } }),
    );
    expect(res.status).toBe('CARD_REPLACED');
    expect(res.valid).toBe(false);
    expect(res.cryptographicValid).toBe(true);
    expect(res.credential).toBeNull();
  });

  it('verify-qr still answers NOT_FOUND for a genuine signature that was never recorded', async () => {
    const token = signCredentialPayload(
      { cred: 'X', serial: 'SN-UNKNOWN', drv: 'D', cats: [], exp: '2099-01-01T00:00:00.000Z' },
      'unit_test_qr_secret_2026',
    );
    mockPrisma.issuedCredential.findFirst.mockResolvedValue(null);
    mockPrisma.cardReprint.findUnique.mockResolvedValue(null);
    const res: any = await service.verifyQrToken(token);
    expect(res.status).toBe('NOT_FOUND');
  });

  it('readiness lists the statutory fields still missing', async () => {
    mockPrisma.driverProfile.findUnique.mockResolvedValue({
      serviceNumber: 'MOD-1',
      rank: 'Sgt.',
      bloodGroup: null,
      dateOfBirth: new Date('1990-01-01'),
      fullNameAm: null,
    });
    await expect(service.getIssuanceReadiness('drv-1')).resolves.toEqual({
      ready: false,
      missing: ['bloodGroup', 'fullNameAm'],
    });
  });

  it('rejects tampered QR token during verification', async () => {
    const res = await service.verifyQrToken('IDLMS1.tamperedPayload.deadbeef');
    expect(res.cryptographicValid).toBe(false);
    expect(res.valid).toBe(false);
    expect(res.status).toBe('INVALID_SIGNATURE');
  });
});
