import { Test, TestingModule } from '@nestjs/testing';
import {
  ApplicationStatus,
  CredentialStatus,
  ExamOutcome,
  ExamType,
  MedicalFitnessOutcome,
  PersonnelStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ReportsService } from './reports.service';

describe('ReportsService', () => {
  let service: ReportsService;

  const prismaMock = {
    driverProfile: { groupBy: jest.fn() },
    application: { groupBy: jest.fn() },
    examinationRecord: { groupBy: jest.fn() },
    issuedCredential: {
      groupBy: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
    },
    incidentReport: { count: jest.fn() },
    suspensionRecord: { count: jest.fn(), findMany: jest.fn() },
    medicalFitnessReview: { findMany: jest.fn() },
    organizationalUnit: { findMany: jest.fn() },
    vehicleCategory: { findMany: jest.fn() },
    credentialCategoryItem: { groupBy: jest.fn() },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get<ReportsService>(ReportsService);
  });

  it('returns zero pass & approval rates safely when database has no records', async () => {
    prismaMock.driverProfile.groupBy.mockResolvedValue([]);
    prismaMock.application.groupBy.mockResolvedValue([]);
    prismaMock.examinationRecord.groupBy.mockResolvedValue([]);
    prismaMock.issuedCredential.groupBy.mockResolvedValue([]);
    prismaMock.issuedCredential.count.mockResolvedValue(0);
    prismaMock.incidentReport.count.mockResolvedValue(0);
    prismaMock.suspensionRecord.count.mockResolvedValue(0);
    prismaMock.medicalFitnessReview.findMany.mockResolvedValue([]);
    prismaMock.organizationalUnit.findMany.mockResolvedValue([]);
    prismaMock.issuedCredential.findMany.mockResolvedValue([]);
    prismaMock.suspensionRecord.findMany.mockResolvedValue([]);

    const kpis = await service.getExecutiveKpis({});
    expect(kpis.drivers.total).toBe(0);
    expect(kpis.applications.approvalRatePct).toBe(0);
    expect(kpis.examinations.overallPassRatePct).toBe(0);
    expect(kpis.safetyAndMedical.unfitDrivers).toBe(0);
  });

  it('computes pass rates, approval rates, and aggregate medical safety counts accurately', async () => {
    prismaMock.driverProfile.groupBy
      .mockResolvedValueOnce([
        { personnelStatus: PersonnelStatus.ACTIVE, _count: { _all: 9 } },
        { personnelStatus: PersonnelStatus.SUSPENDED, _count: { _all: 1 } },
      ])
      .mockResolvedValueOnce([{ unitId: 'u1', _count: { _all: 10 } }]);

    prismaMock.application.groupBy.mockResolvedValue([
      { status: ApplicationStatus.APPROVED, _count: { _all: 3 } },
      { status: ApplicationStatus.REJECTED, _count: { _all: 1 } },
      { status: ApplicationStatus.EXAM_PENDING, _count: { _all: 2 } },
    ]);

    prismaMock.examinationRecord.groupBy.mockResolvedValue([
      { examType: ExamType.THEORETICAL, outcome: ExamOutcome.PASS, _count: { _all: 3 } },
      { examType: ExamType.THEORETICAL, outcome: ExamOutcome.FAIL, _count: { _all: 1 } },
      { examType: ExamType.PRACTICAL, outcome: ExamOutcome.PASS, _count: { _all: 2 } },
    ]);

    prismaMock.issuedCredential.groupBy.mockResolvedValue([
      { status: CredentialStatus.ACTIVE, _count: { _all: 4 } },
      { status: CredentialStatus.SUSPENDED, _count: { _all: 1 } },
    ]);
    prismaMock.issuedCredential.count.mockResolvedValue(2);
    prismaMock.incidentReport.count.mockResolvedValue(1);
    prismaMock.suspensionRecord.count.mockResolvedValue(1);
    prismaMock.medicalFitnessReview.findMany.mockResolvedValue([
      { outcome: MedicalFitnessOutcome.UNFIT },
      { outcome: MedicalFitnessOutcome.FIT_WITH_RESTRICTIONS },
      { outcome: MedicalFitnessOutcome.FIT },
    ]);
    prismaMock.organizationalUnit.findMany.mockResolvedValue([
      { id: 'u1', code: 'LOG-CORPS', name: 'Logistics' },
    ]);
    prismaMock.issuedCredential.findMany.mockResolvedValue([
      { driverProfile: { unitId: 'u1' } },
    ]);
    prismaMock.suspensionRecord.findMany.mockResolvedValue([
      { driverProfile: { unitId: 'u1' } },
    ]);

    const res = await service.getExecutiveKpis({});
    expect(res.drivers).toEqual({ total: 10, active: 9, suspended: 1 });
    expect(res.applications.approvalRatePct).toBe(75);
    expect(res.examinations.theoreticalPassRatePct).toBe(75);
    expect(res.examinations.practicalPassRatePct).toBe(100);
    expect(res.examinations.overallPassRatePct).toBe(83.3);
    expect(res.safetyAndMedical).toEqual({
      openIncidents: 1,
      activeSuspensions: 1,
      unfitDrivers: 1,
      restrictedDrivers: 1,
    });
    expect(res.unitBreakdown[0]).toMatchObject({
      unitCode: 'LOG-CORPS',
      totalDrivers: 10,
      activeCredentials: 1,
      activeSuspensions: 1,
    });
  });

  it('classifies expiring permits as CRITICAL <= 14d, WARNING <= 30d, and NOTICE > 30d', async () => {
    const now = Date.now();
    prismaMock.issuedCredential.findMany.mockResolvedValue([
      {
        id: 'c1',
        credentialNumber: 'MOD-01',
        serialNumber: 'S1',
        expiryDate: new Date(now + 5 * 86_400_000),
        driverProfile: { id: 'd1', serviceNumber: 'MOD-1', fullName: 'Driver 1', unit: { id: 'u1', code: 'U1', name: 'Unit 1' } },
      },
      {
        id: 'c2',
        credentialNumber: 'MOD-02',
        serialNumber: 'S2',
        expiryDate: new Date(now + 20 * 86_400_000),
        driverProfile: { id: 'd2', serviceNumber: 'MOD-2', fullName: 'Driver 2', unit: { id: 'u1', code: 'U1', name: 'Unit 1' } },
      },
      {
        id: 'c3',
        credentialNumber: 'MOD-03',
        serialNumber: 'S3',
        expiryDate: new Date(now + 45 * 86_400_000),
        driverProfile: { id: 'd3', serviceNumber: 'MOD-3', fullName: 'Driver 3', unit: { id: 'u1', code: 'U1', name: 'Unit 1' } },
      },
    ]);

    const res = await service.getExpiringPermits({ expiringDays: 60 });
    expect(res.items.map((i) => i.urgency)).toEqual([
      'CRITICAL',
      'WARNING',
      'NOTICE',
    ]);
  });
});
