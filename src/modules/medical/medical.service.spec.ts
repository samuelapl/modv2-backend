import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  ApplicationStatus,
  MedicalFitnessOutcome,
  PersonnelStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { Permission } from '../../common/enums/permissions.enum';
import { MedicalService } from './medical.service';

describe('MedicalService', () => {
  let service: MedicalService;

  const mockTx: any = {
    medicalFitnessReview: { create: jest.fn() },
    application: { update: jest.fn(), findUnique: jest.fn() },
  };

  const mockPrisma: any = {
    driverProfile: { findUnique: jest.fn() },
    application: { findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn() },
    medicalFitnessReview: { findMany: jest.fn(), count: jest.fn() },
    $transaction: jest.fn((fn: (tx: any) => any) => fn(mockTx)),
  };

  const medicalOfficer = {
    id: 'user-med-1',
    serviceNumber: 'MOD-MED-001',
    unitId: 'unit-1',
    resolvedPermissions: [
      Permission.MEDICAL_RECORD_FIT,
      Permission.MEDICAL_VIEW_OUTCOME,
    ],
  };

  const licensingAdmin = {
    id: 'user-lic-1',
    serviceNumber: 'MOD-LIC-001',
    unitId: 'unit-1',
    resolvedPermissions: [
      Permission.MEDICAL_VIEW_OUTCOME,
      Permission.APPLICATIONS_VIEW_ALL,
    ],
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MedicalService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<MedicalService>(MedicalService);
  });

  it('blocks self-review with 403 Forbidden', async () => {
    mockPrisma.driverProfile.findUnique.mockResolvedValue({
      id: 'drv-1',
      userId: 'user-med-1',
      personnelStatus: PersonnelStatus.ACTIVE,
    });

    await expect(
      service.recordReview(
        {
          driverProfileId: 'drv-1',
          medicalFacility: 'Armed Forces Hospital',
          reviewerBadgeNumber: 'MED-101',
          outcome: MedicalFitnessOutcome.FIT,
          operationalRestrictions: [],
          assessmentDate: '2026-11-01',
          reviewDueDate: '2029-11-01',
        },
        medicalOfficer,
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('requires at least one restriction for FIT_WITH_RESTRICTIONS', async () => {
    mockPrisma.driverProfile.findUnique.mockResolvedValue({
      id: 'drv-1',
      userId: 'user-drv-1',
      personnelStatus: PersonnelStatus.ACTIVE,
    });

    await expect(
      service.recordReview(
        {
          driverProfileId: 'drv-1',
          medicalFacility: 'Armed Forces Hospital',
          reviewerBadgeNumber: 'MED-101',
          outcome: MedicalFitnessOutcome.FIT_WITH_RESTRICTIONS,
          operationalRestrictions: [],
          assessmentDate: '2026-11-01',
          reviewDueDate: '2029-11-01',
        },
        medicalOfficer,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects reviewDueDate <= assessmentDate', async () => {
    mockPrisma.driverProfile.findUnique.mockResolvedValue({
      id: 'drv-1',
      userId: 'user-drv-1',
      personnelStatus: PersonnelStatus.ACTIVE,
    });

    await expect(
      service.recordReview(
        {
          driverProfileId: 'drv-1',
          medicalFacility: 'Armed Forces Hospital',
          reviewerBadgeNumber: 'MED-101',
          outcome: MedicalFitnessOutcome.FIT,
          operationalRestrictions: [],
          assessmentDate: '2027-05-01',
          reviewDueDate: '2026-05-01',
        },
        medicalOfficer,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('omits documentProofUrl and reviewerBadgeNumber for non-medical licensing admins', async () => {
    mockPrisma.medicalFitnessReview.findMany.mockResolvedValue([]);
    mockPrisma.medicalFitnessReview.count.mockResolvedValue(0);

    await service.findAll({}, licensingAdmin);

    const callArg = mockPrisma.medicalFitnessReview.findMany.mock.calls[0][0];
    expect(callArg.select.documentProofUrl).toBeUndefined();
    expect(callArg.select.reviewerBadgeNumber).toBeUndefined();
    expect(callArg.select.outcome).toBe(true);
    expect(callArg.select.operationalRestrictions).toBe(true);
  });

  it('records FIT_WITH_RESTRICTIONS and advances MEDICAL_PENDING to TRAINING_PENDING (medical runs before training)', async () => {
    mockTx.application.findUnique.mockResolvedValue({ type: 'NEW_AUTHORIZATION' });
    mockPrisma.driverProfile.findUnique.mockResolvedValue({
      id: 'drv-1',
      userId: 'user-drv-1',
      personnelStatus: PersonnelStatus.ACTIVE,
    });
    mockPrisma.application.findUnique.mockResolvedValue({
      id: 'app-1',
      driverProfileId: 'drv-1',
      status: ApplicationStatus.MEDICAL_PENDING,
    });

    mockTx.medicalFitnessReview.create.mockResolvedValue({
      id: 'med-1',
      outcome: MedicalFitnessOutcome.FIT_WITH_RESTRICTIONS,
      operationalRestrictions: ['CORRECTIVE_LENSES'],
    });

    const result = await service.recordReview(
      {
        driverProfileId: 'drv-1',
        applicationId: 'app-1',
        medicalFacility: 'Armed Forces Hospital',
        reviewerBadgeNumber: 'MED-101',
        outcome: MedicalFitnessOutcome.FIT_WITH_RESTRICTIONS,
        operationalRestrictions: ['CORRECTIVE_LENSES'],
        assessmentDate: '2026-11-01',
        reviewDueDate: '2029-11-01',
        documentProofUrl: 'cert-1.pdf',
      },
      medicalOfficer,
    );

    expect(result.operationalRestrictions).toEqual(['CORRECTIVE_LENSES']);
    expect(mockTx.application.update).toHaveBeenCalledWith({
      where: { id: 'app-1' },
      data: {
        status: ApplicationStatus.TRAINING_PENDING,
        currentStage: 'Awaiting Training Completion',
        rejectionReason: null,
      },
    });
  });

  it('stamps the signed-in reviewer as the badge number, ignoring any client value', async () => {
    mockTx.application.findUnique.mockResolvedValue({ type: 'NEW_AUTHORIZATION' });
    mockPrisma.driverProfile.findUnique.mockResolvedValue({
      id: 'drv-1',
      userId: 'user-drv-1',
      personnelStatus: PersonnelStatus.ACTIVE,
    });
    mockPrisma.application.findUnique.mockResolvedValue({
      id: 'app-1',
      driverProfileId: 'drv-1',
      status: ApplicationStatus.MEDICAL_PENDING,
    });
    mockTx.medicalFitnessReview.create.mockResolvedValue({
      id: 'med-2',
      outcome: MedicalFitnessOutcome.FIT,
      operationalRestrictions: [],
    });

    await service.recordReview(
      {
        driverProfileId: 'drv-1',
        applicationId: 'app-1',
        medicalFacility: 'Armed Forces Hospital',
        reviewerBadgeNumber: 'SOMEONE-ELSE-999',
        outcome: MedicalFitnessOutcome.FIT,
        operationalRestrictions: [],
        assessmentDate: '2026-11-01',
        reviewDueDate: '2029-11-01',
      },
      medicalOfficer,
    );

    expect(mockTx.medicalFitnessReview.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ reviewerBadgeNumber: 'MOD-MED-001' }),
      }),
    );
  });

  const baseDto = {
    driverProfileId: 'drv-1',
    medicalFacility: 'Armed Forces Hospital',
    operationalRestrictions: [] as string[],
    assessmentDate: '2026-11-01',
    reviewDueDate: '2029-11-01',
  };
  const activeDriver = () =>
    mockPrisma.driverProfile.findUnique.mockResolvedValue({
      id: 'drv-1',
      userId: 'user-drv-1',
      personnelStatus: PersonnelStatus.ACTIVE,
    });

  it('requires a medical certificate for FIT_WITH_RESTRICTIONS', async () => {
    activeDriver();
    await expect(
      service.recordReview(
        {
          ...baseDto,
          outcome: MedicalFitnessOutcome.FIT_WITH_RESTRICTIONS,
          operationalRestrictions: ['CORRECTIVE_LENSES'],
        },
        medicalOfficer,
      ),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'MEDICAL_CERTIFICATE_REQUIRED' }) });
  });

  it('requires a medical certificate for UNFIT', async () => {
    activeDriver();
    await expect(
      service.recordReview(
        { ...baseDto, outcome: MedicalFitnessOutcome.UNFIT },
        medicalOfficer,
      ),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'MEDICAL_CERTIFICATE_REQUIRED' }) });
  });

  it('records UNFIT without a review due date (server sets a placeholder)', async () => {
    activeDriver();
    mockTx.medicalFitnessReview.create.mockResolvedValue({
      id: 'med-3',
      outcome: MedicalFitnessOutcome.UNFIT,
      operationalRestrictions: [],
    });
    const { reviewDueDate: _omit, ...noDue } = baseDto;
    await service.recordReview(
      { ...noDue, outcome: MedicalFitnessOutcome.UNFIT, documentProofUrl: 'cert-2.pdf' },
      medicalOfficer,
    );
    const data = mockTx.medicalFitnessReview.create.mock.calls.at(-1)[0].data;
    expect(data.reviewDueDate.getTime()).toBeGreaterThan(data.assessmentDate.getTime());
  });

  describe('voidReview', () => {
    beforeEach(() => {
      mockPrisma.medicalFitnessReview.findUnique = jest.fn();
      mockPrisma.medicalFitnessReview.update = jest.fn().mockResolvedValue({ id: 'med-1' });
    });

    it('marks the review voided with who and why (row is kept)', async () => {
      mockPrisma.medicalFitnessReview.findUnique.mockResolvedValue({
        id: 'med-1',
        voidedAt: null,
        application: { status: ApplicationStatus.MEDICAL_PENDING },
      });
      await service.voidReview('med-1', { reason: 'Recorded against the wrong driver.' }, medicalOfficer);
      expect(mockPrisma.medicalFitnessReview.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'med-1' },
          data: expect.objectContaining({
            voidedById: 'user-med-1',
            voidReason: 'Recorded against the wrong driver.',
            voidedAt: expect.any(Date),
          }),
        }),
      );
    });

    it('can void a review that has no application (periodic review)', async () => {
      mockPrisma.medicalFitnessReview.findUnique.mockResolvedValue({
        id: 'med-9',
        voidedAt: null,
        application: null,
      });
      await service.voidReview('med-9', { reason: 'Recorded against the wrong driver.' }, medicalOfficer);
      expect(mockPrisma.medicalFitnessReview.update).toHaveBeenCalled();
    });

    it.each([
      ApplicationStatus.TRAINING_PENDING,
      ApplicationStatus.READY_FOR_APPROVAL,
      ApplicationStatus.APPROVED,
      ApplicationStatus.REJECTED,
    ])('refuses to void once the application has moved on (%s)', async (status) => {
      mockPrisma.medicalFitnessReview.findUnique.mockResolvedValue({
        id: 'med-1',
        voidedAt: null,
        application: { status },
      });
      await expect(
        service.voidReview('med-1', { reason: 'Recorded against the wrong driver.' }, medicalOfficer),
      ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'MEDICAL_VOID_APPLICATION_MOVED' }) });
      expect(mockPrisma.medicalFitnessReview.update).not.toHaveBeenCalled();
    });

    it('refuses to void twice', async () => {
      mockPrisma.medicalFitnessReview.findUnique.mockResolvedValue({ id: 'med-1', voidedAt: new Date() });
      await expect(
        service.voidReview('med-1', { reason: 'Recorded against the wrong driver.' }, medicalOfficer),
      ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'MEDICAL_REVIEW_ALREADY_VOIDED' }) });
    });

    it('404s for an unknown review', async () => {
      mockPrisma.medicalFitnessReview.findUnique.mockResolvedValue(null);
      await expect(
        service.voidReview('nope', { reason: 'Recorded against the wrong driver.' }, medicalOfficer),
      ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'MEDICAL_REVIEW_NOT_FOUND' }) });
    });
  });
});
