import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  CredentialStatus,
  IncidentSeverity,
  PersonnelStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { Permission } from '../../common/enums/permissions.enum';
import { SafetyService } from './safety.service';

describe('SafetyService', () => {
  let service: SafetyService;

  const mockTx: any = {
    incidentReport: { create: jest.fn(), update: jest.fn() },
    suspensionRecord: { create: jest.fn(), update: jest.fn(), findFirst: jest.fn() },
    driverProfile: { update: jest.fn() },
    issuedCredential: { updateMany: jest.fn(), findMany: jest.fn() },
    auditLog: { create: jest.fn() },
  };

  const mockPrisma: any = {
    driverProfile: { findUnique: jest.fn() },
    incidentReport: { findFirst: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn() },
    suspensionRecord: { findFirst: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn() },
    $transaction: jest.fn((fn: (tx: any) => any) => fn(mockTx)),
  };

  const coordUser = {
    id: 'user-coord-1',
    serviceNumber: 'MOD-COORD-001',
    unitId: 'unit-1',
    resolvedPermissions: [
      Permission.DRIVERS_VIEW_UNIT,
      Permission.SAFETY_REPORT_INCIDENT,
    ],
  };

  const cmdrUser = {
    id: 'user-cmdr-1',
    serviceNumber: 'MOD-CMDR-001',
    unitId: 'unit-1',
    resolvedPermissions: [
      Permission.DRIVERS_VIEW_ALL,
      Permission.SAFETY_INVESTIGATE,
      Permission.SAFETY_SUSPEND,
      Permission.SAFETY_REINSTATE,
    ],
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SafetyService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<SafetyService>(SafetyService);
  });

  it('blocks coordinator reporting incident for driver in another unit', async () => {
    mockPrisma.driverProfile.findUnique.mockResolvedValue({
      id: 'drv-2',
      userId: 'u2',
      unitId: 'other-unit',
      serviceNumber: 'MOD-999',
    });

    await expect(
      service.reportIncident(
        {
          driverProfileId: 'drv-2',
          incidentDate: '2026-11-01T10:00:00.000Z',
          severity: IncidentSeverity.MINOR,
          description: 'Minor scratch',
        },
        coordUser,
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects incident dates in the future', async () => {
    mockPrisma.driverProfile.findUnique.mockResolvedValue({
      id: 'drv-1',
      userId: 'u1',
      unitId: 'unit-1',
      serviceNumber: 'MOD-1234',
    });

    const futureDate = new Date(Date.now() + 86400000 * 5).toISOString();
    await expect(
      service.reportIncident(
        {
          driverProfileId: 'drv-1',
          incidentDate: futureDate,
          severity: IncidentSeverity.MODERATE,
          description: 'Future dated incident',
        },
        coordUser,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('blocks self-suspension and duplicate active suspension', async () => {
    mockPrisma.driverProfile.findUnique.mockResolvedValue({
      id: 'drv-cmdr',
      userId: 'user-cmdr-1',
      issuedCredentials: [],
    });

    await expect(
      service.imposeSuspension(
        {
          driverProfileId: 'drv-cmdr',
          legalBasis: 'Art 14',
          reason: 'Self test',
        },
        cmdrUser,
      ),
    ).rejects.toThrow(ForbiddenException);

    mockPrisma.driverProfile.findUnique.mockResolvedValue({
      id: 'drv-1',
      userId: 'u-drv-1',
      issuedCredentials: [],
    });
    mockPrisma.suspensionRecord.findFirst.mockResolvedValue({ id: 'susp-active' });

    await expect(
      service.imposeSuspension(
        {
          driverProfileId: 'drv-1',
          legalBasis: 'Art 14',
          reason: 'Already suspended',
        },
        cmdrUser,
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('atomically sets driver and ACTIVE credentials to SUSPENDED on suspension', async () => {
    mockPrisma.driverProfile.findUnique.mockResolvedValue({
      id: 'drv-1',
      userId: 'u-drv-1',
      serviceNumber: 'MOD-1234',
      personnelStatus: PersonnelStatus.ACTIVE,
      issuedCredentials: [{ id: 'cred-1' }],
    });
    mockPrisma.suspensionRecord.findFirst.mockResolvedValue(null);
    mockTx.suspensionRecord.create.mockResolvedValue({
      id: 'susp-1',
      isActive: true,
    });

    await service.imposeSuspension(
      {
        driverProfileId: 'drv-1',
        legalBasis: 'MoD Transport Code Art. 14.2',
        reason: 'Severe convoy accident',
      },
      cmdrUser,
    );

    expect(mockTx.driverProfile.update).toHaveBeenCalledWith({
      where: { id: 'drv-1' },
      data: { personnelStatus: PersonnelStatus.SUSPENDED },
    });
    expect(mockTx.issuedCredential.updateMany).toHaveBeenCalledWith({
      where: { driverProfileId: 'drv-1', status: CredentialStatus.ACTIVE },
      data: { status: CredentialStatus.SUSPENDED },
    });
  });

  it('blocks reinstatement when corrective action is incomplete, then reinstates once complete', async () => {
    mockPrisma.suspensionRecord.findUnique.mockResolvedValue({
      id: 'susp-1',
      driverProfileId: 'drv-1',
      isActive: true,
      driverProfile: { userId: 'u-drv-1' },
    });
    mockPrisma.incidentReport.findFirst.mockResolvedValueOnce({
      reportNumber: 'INC-2026-0001',
      correctiveAction: 'Remedial Convoy Training',
    });

    await expect(service.reinstateDriver('susp-1', cmdrUser)).rejects.toThrow(
      BadRequestException,
    );

    mockPrisma.incidentReport.findFirst.mockResolvedValueOnce(null);
    mockTx.suspensionRecord.update.mockResolvedValue({
      id: 'susp-1',
      isActive: false,
    });

    const res = await service.reinstateDriver('susp-1', cmdrUser);
    expect(res.isActive).toBe(false);
    expect(mockTx.driverProfile.update).toHaveBeenCalledWith({
      where: { id: 'drv-1' },
      data: { personnelStatus: PersonnelStatus.ACTIVE },
    });
  });

  describe('revocation & suspension dates', () => {
    it('revokes all ACTIVE/SUSPENDED permits and closes an active suspension', async () => {
      mockPrisma.driverProfile.findUnique.mockResolvedValue({
        id: 'drv-1',
        userId: 'u-drv-1',
        serviceNumber: 'MOD-1',
        personnelStatus: PersonnelStatus.SUSPENDED,
      });
      mockTx.issuedCredential.findMany.mockResolvedValue([
        { id: 'cred-1', credentialNumber: 'MOD-AUTH-2026-0001', status: CredentialStatus.SUSPENDED },
      ]);
      mockTx.suspensionRecord.findFirst.mockResolvedValue({ id: 'susp-1' });

      const res = await service.revokePermit(
        { driverProfileId: 'drv-1', legalBasis: 'Disciplinary Code §22', reason: 'Repeated violations' },
        cmdrUser as any,
      );

      expect(mockTx.issuedCredential.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['cred-1'] } },
        data: expect.objectContaining({
          status: CredentialStatus.REVOKED,
          revokedById: 'user-cmdr-1',
          revocationLegalBasis: 'Disciplinary Code §22',
        }),
      });
      expect(mockTx.suspensionRecord.update).toHaveBeenCalledWith({
        where: { id: 'susp-1' },
        data: expect.objectContaining({ isActive: false, closedById: 'user-cmdr-1' }),
      });
      expect(res.revokedCredentials).toEqual(['MOD-AUTH-2026-0001']);
    });

    it('revokes directly without touching suspensions when none is active', async () => {
      mockPrisma.driverProfile.findUnique.mockResolvedValue({
        id: 'drv-1',
        userId: 'u-drv-1',
        serviceNumber: 'MOD-1',
        personnelStatus: PersonnelStatus.ACTIVE,
      });
      mockTx.issuedCredential.findMany.mockResolvedValue([
        { id: 'cred-1', credentialNumber: 'MOD-AUTH-2026-0001', status: CredentialStatus.ACTIVE },
      ]);
      mockTx.suspensionRecord.findFirst.mockResolvedValue(null);

      await service.revokePermit(
        { driverProfileId: 'drv-1', legalBasis: 'Code §22', reason: 'Fraudulent licence' },
        cmdrUser as any,
      );

      expect(mockTx.suspensionRecord.update).not.toHaveBeenCalled();
      expect(mockTx.driverProfile.update).not.toHaveBeenCalled();
    });

    it('refuses when the driver holds no permit to revoke', async () => {
      mockPrisma.driverProfile.findUnique.mockResolvedValue({
        id: 'drv-1',
        userId: 'u-drv-1',
        serviceNumber: 'MOD-1',
        personnelStatus: PersonnelStatus.ACTIVE,
      });
      mockTx.issuedCredential.findMany.mockResolvedValue([]);

      await expect(
        service.revokePermit(
          { driverProfileId: 'drv-1', legalBasis: 'Code §22', reason: 'Repeated violations' },
          cmdrUser as any,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses an officer revoking their own permit', async () => {
      mockPrisma.driverProfile.findUnique.mockResolvedValue({
        id: 'drv-1',
        userId: 'user-cmdr-1',
        serviceNumber: 'MOD-1',
        personnelStatus: PersonnelStatus.ACTIVE,
      });
      await expect(
        service.revokePermit(
          { driverProfileId: 'drv-1', legalBasis: 'Code §22', reason: 'Repeated violations' },
          cmdrUser as any,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects a suspension effective date in the future', async () => {
      mockPrisma.driverProfile.findUnique.mockResolvedValue({
        id: 'drv-1',
        userId: 'u-drv-1',
        serviceNumber: 'MOD-1',
        personnelStatus: PersonnelStatus.ACTIVE,
        issuedCredentials: [],
      });
      mockPrisma.suspensionRecord.findFirst.mockResolvedValue(null);
      const future = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);

      await expect(
        service.imposeSuspension(
          {
            driverProfileId: 'drv-1',
            legalBasis: 'Code §22',
            reason: 'Convoy violation',
            startDate: future,
          },
          cmdrUser as any,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a review date on or before the effective date', async () => {
      mockPrisma.driverProfile.findUnique.mockResolvedValue({
        id: 'drv-1',
        userId: 'u-drv-1',
        serviceNumber: 'MOD-1',
        personnelStatus: PersonnelStatus.ACTIVE,
        issuedCredentials: [],
      });
      mockPrisma.suspensionRecord.findFirst.mockResolvedValue(null);

      await expect(
        service.imposeSuspension(
          {
            driverProfileId: 'drv-1',
            legalBasis: 'Code §22',
            reason: 'Convoy violation',
            startDate: '2026-11-01',
            reviewDate: '2026-10-01',
          },
          cmdrUser as any,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
