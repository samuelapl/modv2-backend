import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  ApplicationStatus,
  ExamOutcome,
  ExamType,
  PersonnelStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ExaminationsService } from './examinations.service';

describe('ExaminationsService', () => {
  let service: ExaminationsService;

  const mockTx: any = {
    examinationRecord: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
    application: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockPrisma: any = {
    driverProfile: { findUnique: jest.fn() },
    vehicleCategory: { findUnique: jest.fn() },
    application: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    examinationRecord: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    $transaction: jest.fn((fn: (tx: any) => any) => fn(mockTx)),
  };

  const examinerUser = {
    id: 'user-exam-1',
    serviceNumber: 'MOD-EXAM-001',
    unitId: 'unit-1',
    resolvedPermissions: ['exams:grade_locked'],
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExaminationsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<ExaminationsService>(ExaminationsService);
  });

  it('blocks self-grading with 403 Forbidden', async () => {
    mockPrisma.driverProfile.findUnique.mockResolvedValue({
      id: 'drv-1',
      userId: 'user-exam-1',
      personnelStatus: PersonnelStatus.ACTIVE,
    });
    mockPrisma.vehicleCategory.findUnique.mockResolvedValue({
      id: 'cat-sp',
      code: 'CAT-SP',
    });

    await expect(
      service.recordResult(
        {
          driverProfileId: 'drv-1',
          examType: ExamType.THEORETICAL,
          categoryCode: 'CAT-SP',
          scorePercent: 90,
          outcome: ExamOutcome.PASS,
        },
        examinerUser,
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects marking PASS when scorePercent is below 75%', async () => {
    mockPrisma.driverProfile.findUnique.mockResolvedValue({
      id: 'drv-1',
      userId: 'user-drv-1',
      personnelStatus: PersonnelStatus.ACTIVE,
    });
    mockPrisma.vehicleCategory.findUnique.mockResolvedValue({
      id: 'cat-sp',
      code: 'CAT-SP',
    });

    await expect(
      service.recordResult(
        {
          driverProfileId: 'drv-1',
          examType: ExamType.THEORETICAL,
          categoryCode: 'CAT-SP',
          scorePercent: 70,
          outcome: ExamOutcome.PASS,
        },
        examinerUser,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('requires examiner notes when recording FAIL or INCOMPLETE', async () => {
    mockPrisma.driverProfile.findUnique.mockResolvedValue({
      id: 'drv-1',
      userId: 'user-drv-1',
      personnelStatus: PersonnelStatus.ACTIVE,
    });
    mockPrisma.vehicleCategory.findUnique.mockResolvedValue({
      id: 'cat-sp',
      code: 'CAT-SP',
    });

    await expect(
      service.recordResult(
        {
          driverProfileId: 'drv-1',
          examType: ExamType.THEORETICAL,
          categoryCode: 'CAT-SP',
          scorePercent: 55,
          outcome: ExamOutcome.FAIL,
          notes: '  ',
        },
        examinerUser,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('prevents duplicate locked PASS record for same application/category/type', async () => {
    mockPrisma.driverProfile.findUnique.mockResolvedValue({
      id: 'drv-1',
      userId: 'user-drv-1',
      personnelStatus: PersonnelStatus.ACTIVE,
    });
    mockPrisma.vehicleCategory.findUnique.mockResolvedValue({
      id: 'cat-sp',
      code: 'CAT-SP',
    });
    mockPrisma.application.findUnique.mockResolvedValue({
      id: 'app-1',
      driverProfileId: 'drv-1',
      status: ApplicationStatus.EXAM_PENDING,
      requestedCategories: [{ category: { code: 'CAT-SP' } }],
    });
    mockPrisma.examinationRecord.findFirst.mockResolvedValue({ id: 'old-pass' });

    await expect(
      service.recordResult(
        {
          driverProfileId: 'drv-1',
          applicationId: 'app-1',
          examType: ExamType.THEORETICAL,
          categoryCode: 'CAT-SP',
          scorePercent: 85,
          outcome: ExamOutcome.PASS,
        },
        examinerUser,
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('keeps EXAM_PENDING on Theory PASS alone, then advances to MEDICAL_PENDING when Practical also PASSes', async () => {
    mockPrisma.driverProfile.findUnique.mockResolvedValue({
      id: 'drv-1',
      userId: 'user-drv-1',
      personnelStatus: PersonnelStatus.ACTIVE,
    });
    mockPrisma.vehicleCategory.findUnique.mockResolvedValue({
      id: 'cat-sp',
      code: 'CAT-SP',
    });
    mockPrisma.application.findUnique.mockResolvedValue({
      id: 'app-1',
      driverProfileId: 'drv-1',
      status: ApplicationStatus.EXAM_PENDING,
      requestedCategories: [
        { category: { code: 'CAT-SP', requiresMedical: true } },
      ],
    });
    mockPrisma.examinationRecord.findFirst.mockResolvedValue(null);

    mockTx.examinationRecord.create.mockResolvedValue({
      id: 'rec-theory',
      isLocked: true,
      outcome: ExamOutcome.PASS,
    });
    mockTx.application.findUnique.mockResolvedValue({
      id: 'app-1',
      status: ApplicationStatus.EXAM_PENDING,
      requestedCategories: [
        { category: { code: 'CAT-SP', requiresMedical: true } },
      ],
    });

    // Only Theory passed so far -> should NOT advance
    mockTx.examinationRecord.findMany.mockResolvedValueOnce([
      { categoryCode: 'CAT-SP', examType: ExamType.THEORETICAL },
    ]);

    await service.recordResult(
      {
        driverProfileId: 'drv-1',
        applicationId: 'app-1',
        examType: ExamType.THEORETICAL,
        categoryCode: 'CAT-SP',
        scorePercent: 85,
        outcome: ExamOutcome.PASS,
      },
      examinerUser,
    );
    expect(mockTx.application.update).not.toHaveBeenCalled();

    // Now Practical also passed -> MUST advance to MEDICAL_PENDING
    mockTx.examinationRecord.findMany.mockResolvedValueOnce([
      { categoryCode: 'CAT-SP', examType: ExamType.THEORETICAL },
      { categoryCode: 'CAT-SP', examType: ExamType.PRACTICAL },
    ]);

    await service.recordResult(
      {
        driverProfileId: 'drv-1',
        applicationId: 'app-1',
        examType: ExamType.PRACTICAL,
        categoryCode: 'CAT-SP',
        outcome: ExamOutcome.PASS,
      },
      examinerUser,
    );

    expect(mockTx.application.update).toHaveBeenCalledWith({
      where: { id: 'app-1' },
      data: {
        status: ApplicationStatus.MEDICAL_PENDING,
        currentStage: 'Awaiting Medical Fitness Clearance',
      },
    });
  });
});
