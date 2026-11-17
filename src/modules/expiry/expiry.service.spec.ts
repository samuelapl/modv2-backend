import { Test, TestingModule } from '@nestjs/testing';
import { CredentialStatus, VerificationStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ExpiryService } from './expiry.service';
import {
  credentialStatusWhere,
  effectiveCredentialStatus,
} from '../credentials/helpers/credential-status.helper';

describe('ExpiryService — nightly expiry sweep', () => {
  let service: ExpiryService;

  const mockTx: any = {
    issuedCredential: { updateMany: jest.fn() },
    nationalLicense: { updateMany: jest.fn() },
    auditLog: { createMany: jest.fn() },
  };
  const mockPrisma: any = {
    issuedCredential: { findMany: jest.fn() },
    nationalLicense: { findMany: jest.fn() },
    $transaction: jest.fn((fn: (tx: any) => any) => fn(mockTx)),
  };

  const NOW = new Date('2028-11-12T00:05:00.000Z');

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [ExpiryService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get(ExpiryService);
  });

  it('marks past-due ACTIVE permits and VERIFIED licenses as EXPIRED and audits each one', async () => {
    mockPrisma.issuedCredential.findMany.mockResolvedValue([
      { id: 'cred-1', credentialNumber: 'MOD-AUTH-2026-0002', expiryDate: new Date('2028-11-11T09:04:59Z') },
    ]);
    mockPrisma.nationalLicense.findMany.mockResolvedValue([
      {
        id: 'lic-1',
        licenseNumber: 'ETH-TST-00001',
        verificationStatus: VerificationStatus.VERIFIED,
        expiryDate: new Date('2028-11-10T00:00:00Z'),
      },
    ]);

    const result = await service.runExpirySweep('manual', NOW);

    // Only records that are past due are selected.
    expect(mockPrisma.issuedCredential.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: CredentialStatus.ACTIVE, expiryDate: { lte: NOW } },
      }),
    );
    expect(mockTx.issuedCredential.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['cred-1'] }, status: CredentialStatus.ACTIVE },
      data: { status: CredentialStatus.EXPIRED },
    });
    expect(mockTx.nationalLicense.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { verificationStatus: VerificationStatus.EXPIRED },
      }),
    );
    const audit = mockTx.auditLog.createMany.mock.calls[0][0].data;
    expect(audit).toHaveLength(2);
    expect(audit[0]).toEqual(
      expect.objectContaining({ userId: null, action: 'AUTO_EXPIRE_CREDENTIAL', entityId: 'cred-1' }),
    );
    expect(result?.credentialsExpired).toEqual(['MOD-AUTH-2026-0002']);
    expect(result?.licensesExpired).toEqual(['ETH-TST-00001']);
  });

  it('does nothing (no writes) when nothing is past due — safe to run repeatedly', async () => {
    mockPrisma.issuedCredential.findMany.mockResolvedValue([]);
    mockPrisma.nationalLicense.findMany.mockResolvedValue([]);

    const result = await service.runExpirySweep('schedule', NOW);

    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(result?.credentialsExpired).toEqual([]);
  });

  it('skips a second run while one is already in progress', async () => {
    let release!: () => void;
    mockPrisma.issuedCredential.findMany.mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve([]);
      }),
    );
    mockPrisma.nationalLicense.findMany.mockResolvedValue([]);

    const first = service.runExpirySweep('schedule', NOW);
    const second = await service.runExpirySweep('manual', NOW);
    release();
    await first;

    expect(second).toBeNull();
  });

  it('dispatches expiry.warning event for permits expiring in 30 days', async () => {
    const mockEmitter = { emit: jest.fn() };
    const svc = new ExpiryService(mockPrisma as any, mockEmitter as any);

    mockPrisma.issuedCredential.findMany.mockResolvedValue([
      {
        id: 'cred-1',
        credentialNumber: 'MOD-AUTH-2026-0001',
        expiryDate: new Date('2028-12-12T00:05:00.000Z'), // 30 days after NOW
        driverProfile: { userId: 'user-1' },
      },
    ]);

    const count = await svc.dispatchExpiryWarnings(NOW);
    expect(count).toBe(1);
    expect(mockEmitter.emit).toHaveBeenCalledWith(
      'expiry.warning',
      expect.objectContaining({
        driverUserId: 'user-1',
        permitNumber: 'MOD-AUTH-2026-0001',
        daysRemaining: 30,
      }),
    );
  });
});

describe('effective credential status', () => {
  const now = new Date('2028-11-11T12:00:00Z');

  it('shows an ACTIVE permit past its expiry date as EXPIRED', () => {
    expect(
      effectiveCredentialStatus(CredentialStatus.ACTIVE, '2028-11-11T09:00:00Z', now),
    ).toBe(CredentialStatus.EXPIRED);
  });

  it('keeps a still-valid ACTIVE permit as ACTIVE', () => {
    expect(
      effectiveCredentialStatus(CredentialStatus.ACTIVE, '2028-11-12T09:00:00Z', now),
    ).toBe(CredentialStatus.ACTIVE);
  });

  it('never overrides SUSPENDED / REVOKED / SUPERSEDED', () => {
    for (const s of [
      CredentialStatus.SUSPENDED,
      CredentialStatus.REVOKED,
      CredentialStatus.SUPERSEDED,
    ]) {
      expect(effectiveCredentialStatus(s, '2020-01-01T00:00:00Z', now)).toBe(s);
    }
  });

  it('builds date-aware filters for ACTIVE and EXPIRED', () => {
    expect(credentialStatusWhere(CredentialStatus.ACTIVE, now)).toEqual({
      status: CredentialStatus.ACTIVE,
      expiryDate: { gt: now },
    });
    expect(credentialStatusWhere(CredentialStatus.EXPIRED, now)).toEqual({
      OR: [
        { status: CredentialStatus.EXPIRED },
        { status: CredentialStatus.ACTIVE, expiryDate: { lte: now } },
      ],
    });
  });
});
