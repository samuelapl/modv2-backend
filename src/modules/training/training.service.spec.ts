import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  ApplicationStatus,
  CourseStatus,
  PersonnelStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TrainingService } from './training.service';

describe('TrainingService', () => {
  let service: TrainingService;

  const mockTx: any = {
    trainingEnrollment: {
      update: jest.fn(),
      findMany: jest.fn(),
    },
    application: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockPrisma: any = {
    trainingCourse: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    vehicleCategory: { findUnique: jest.fn(), findMany: jest.fn() },
    driverProfile: { findUnique: jest.fn() },
    application: { findUnique: jest.fn(), findMany: jest.fn() },
    trainingEnrollment: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      groupBy: jest.fn(),
    },
    trainingBatchSession: { findMany: jest.fn() },
    $transaction: jest.fn((fn: (tx: any) => any) => fn(mockTx)),
  };

  const instructorUser = {
    id: 'user-inst-1',
    serviceNumber: 'MOD-INST-001',
    unitId: 'unit-1',
    resolvedPermissions: ['training:log_attendance'],
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrainingService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<TrainingService>(TrainingService);
  });

  it('rejects duplicate course code with 409 Conflict', async () => {
    mockPrisma.trainingCourse.findUnique.mockResolvedValue({
      id: 'c1',
      courseCode: 'TRN-HV-01',
    });

    await expect(
      service.createCourse({
        courseCode: 'trn-hv-01',
        title: 'Heavy Freight',
        categoryCodes: ['CAT-HV'],
        durationHours: 40,
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('creates a course covering several categories, normalised and sorted', async () => {
    mockPrisma.trainingCourse.findUnique.mockResolvedValue(null);
    mockPrisma.vehicleCategory.findMany.mockResolvedValue([
      { code: 'CAT-HV' },
      { code: 'CAT-MV' },
    ]);
    mockPrisma.trainingCourse.create.mockImplementation(({ data }: any) =>
      Promise.resolve({ id: 'c-new', ...data }),
    );

    const res = await service.createCourse({
      courseCode: 'trn-cv-01',
      title: 'Combined Convoy',
      categoryCodes: ['cat-mv', 'CAT-HV', 'CAT-MV'],
      durationHours: 40,
    });

    expect(res.courseCode).toBe('TRN-CV-01');
    expect(res.categoryCodes).toEqual(['CAT-HV', 'CAT-MV']);
  });

  it('rejects a course with an unknown category', async () => {
    mockPrisma.trainingCourse.findUnique.mockResolvedValue(null);
    mockPrisma.vehicleCategory.findMany.mockResolvedValue([{ code: 'CAT-HV' }]);

    await expect(
      service.createCourse({
        courseCode: 'TRN-X-01',
        title: 'Unknown',
        categoryCodes: ['CAT-HV', 'CAT-ZZ'],
        durationHours: 10,
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('blocks removing a category that already has trainees on the course', async () => {
    mockPrisma.trainingCourse.findUnique.mockResolvedValue({
      id: 'c1',
      courseCode: 'TRN-CV-01',
      categoryCodes: ['CAT-HV', 'CAT-MV'],
    });
    mockPrisma.vehicleCategory.findMany.mockResolvedValue([{ code: 'CAT-HV' }]);
    mockPrisma.trainingEnrollment.groupBy.mockResolvedValue([
      { categoryCode: 'CAT-MV', _count: { _all: 2 } },
    ]);
    mockPrisma.trainingBatchSession.findMany.mockResolvedValue([]);

    await expect(
      service.updateCourse('c1', { categoryCodes: ['CAT-HV'] }),
    ).rejects.toThrow(ConflictException);
    expect(mockPrisma.trainingCourse.update).not.toHaveBeenCalled();
  });

  it('deletes a course with no training history', async () => {
    mockPrisma.trainingCourse.findUnique.mockResolvedValue({
      id: 'c1',
      courseCode: 'TRN-SP-02',
      _count: { enrollments: 0, batchSessions: 0 },
    });

    await expect(service.deleteCourse('c1')).resolves.toEqual({
      id: 'c1',
      courseCode: 'TRN-SP-02',
      deleted: true,
    });
    expect(mockPrisma.trainingCourse.delete).toHaveBeenCalledWith({
      where: { id: 'c1' },
    });
  });

  it('refuses to delete a course that has enrollments', async () => {
    mockPrisma.trainingCourse.findUnique.mockResolvedValue({
      id: 'c1',
      courseCode: 'TRN-SP-01',
      _count: { enrollments: 3, batchSessions: 1 },
    });

    await expect(service.deleteCourse('c1')).rejects.toThrow(ConflictException);
    expect(mockPrisma.trainingCourse.delete).not.toHaveBeenCalled();
  });

  it('requires a category when a multi-category course fits several requested ones', async () => {
    mockPrisma.driverProfile.findUnique.mockResolvedValue({
      id: 'drv-1',
      personnelStatus: PersonnelStatus.ACTIVE,
    });
    mockPrisma.trainingCourse.findUnique.mockResolvedValue({
      id: 'crs-cv',
      courseCode: 'TRN-CV-01',
      categoryCodes: ['CAT-HV', 'CAT-MV'],
    });
    mockPrisma.application.findUnique.mockResolvedValue({
      id: 'app-1',
      driverProfileId: 'drv-1',
      status: ApplicationStatus.TRAINING_PENDING,
      requestedCategories: [
        { category: { code: 'CAT-HV' } },
        { category: { code: 'CAT-MV' } },
      ],
    });

    await expect(
      service.enrollCandidate({
        driverProfileId: 'drv-1',
        courseId: 'crs-cv',
        applicationId: 'app-1',
      }),
    ).rejects.toThrow(BadRequestException);

    mockPrisma.trainingEnrollment.findFirst.mockResolvedValue(null);
    mockPrisma.trainingEnrollment.create.mockImplementation(({ data }: any) =>
      Promise.resolve({ id: 'enr-1', ...data }),
    );
    const res = await service.enrollCandidate({
      driverProfileId: 'drv-1',
      courseId: 'crs-cv',
      applicationId: 'app-1',
      categoryCode: 'cat-mv',
    });
    expect(res.categoryCode).toBe('CAT-MV');
  });

  it('numbers re-enrollments by earlier failed attempts and filters overdue', async () => {
    const t = (d: string) => new Date(`2026-${d}T00:00:00Z`);
    const current = {
      id: 'enr-2',
      driverProfileId: 'drv-1',
      applicationId: 'app-1',
      categoryCode: 'CAT-SP',
      createdAt: t('11-20'),
      status: CourseStatus.IN_PROGRESS,
    };
    const firstTry = {
      id: 'enr-new-driver',
      driverProfileId: 'drv-2',
      applicationId: 'app-2',
      categoryCode: 'CAT-SP',
      createdAt: t('11-20'),
      status: CourseStatus.PLANNED,
    };
    mockPrisma.trainingEnrollment.findMany
      .mockResolvedValueOnce([current, firstTry]) // page of items
      .mockResolvedValueOnce([
        {
          id: 'enr-1',
          driverProfileId: 'drv-1',
          applicationId: 'app-1',
          categoryCode: 'CAT-SP',
          createdAt: t('10-01'),
          hoursAttended: 0,
          notes: 'Did not attend',
          course: { courseCode: 'TRN-SP-01', durationHours: 24 },
          batchSession: { endDate: t('10-31'), batch: { batchCode: 'BATCH-001' } },
        },
      ]); // earlier failures
    mockPrisma.trainingEnrollment.count.mockResolvedValue(2);

    const res: any = await service.findAllEnrollments(
      { page: 1, limit: 10, overdue: true, batchId: 'b-1' } as any,
      { ...instructorUser, resolvedPermissions: ['training:log_attendance'] },
    );

    const [again, fresh] = res.items;
    expect(again.attempt).toBe(2);
    expect(again.previousAttempt).toMatchObject({
      batchCode: 'BATCH-001',
      notes: 'Did not attend',
      hoursAttended: 0,
    });
    expect(fresh.attempt).toBe(1);
    expect(fresh.previousAttempt).toBeNull();

    const where = mockPrisma.trainingEnrollment.findMany.mock.calls[0][0].where;
    expect(where.status).toEqual({
      in: [CourseStatus.PLANNED, CourseStatus.IN_PROGRESS],
    });
    expect(where.batchSession.batchId).toBe('b-1');
    expect(where.batchSession.endDate.lt).toBeInstanceOf(Date);
  });

  it('rejects enrollment when linked application is not TRAINING_PENDING', async () => {
    mockPrisma.driverProfile.findUnique.mockResolvedValue({
      id: 'drv-1',
      personnelStatus: PersonnelStatus.ACTIVE,
    });
    mockPrisma.trainingCourse.findUnique.mockResolvedValue({
      id: 'crs-hv',
      courseCode: 'TRN-HV-01',
      categoryCodes: ['CAT-HV'],
      durationHours: 40,
    });
    mockPrisma.application.findUnique.mockResolvedValue({
      id: 'app-1',
      driverProfileId: 'drv-1',
      status: ApplicationStatus.SUBMITTED,
      requestedCategories: [{ category: { code: 'CAT-HV' } }],
    });

    await expect(
      service.enrollCandidate({
        driverProfileId: 'drv-1',
        courseId: 'crs-hv',
        applicationId: 'app-1',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('blocks self-logging attendance with 403 Forbidden', async () => {
    mockPrisma.trainingEnrollment.findUnique.mockResolvedValue({
      id: 'enr-1',
      driverProfile: { userId: 'user-inst-1' },
      course: { durationHours: 40 },
    });

    await expect(
      service.logAttendance(
        'enr-1',
        { hoursAttended: 40, status: CourseStatus.COMPLETED },
        instructorUser,
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('blocks premature COMPLETED before reaching course durationHours', async () => {
    mockPrisma.trainingEnrollment.findUnique.mockResolvedValue({
      id: 'enr-1',
      driverProfile: { userId: 'user-drv-1' },
      course: { durationHours: 40 },
    });

    await expect(
      service.logAttendance(
        'enr-1',
        { hoursAttended: 24, status: CourseStatus.COMPLETED },
        instructorUser,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects attended hours above the course length', async () => {
    mockPrisma.trainingEnrollment.findUnique.mockResolvedValue({
      id: 'enr-1',
      driverProfile: { userId: 'user-drv-1' },
      course: { durationHours: 40 },
    });

    await expect(
      service.logAttendance(
        'enr-1',
        { hoursAttended: 41, status: CourseStatus.IN_PROGRESS },
        instructorUser,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'TRAINING_HOURS_EXCEED_COURSE' }),
    });
  });

  it('requires notes when marking FAILED', async () => {
    mockPrisma.trainingEnrollment.findUnique.mockResolvedValue({
      id: 'enr-1',
      driverProfile: { userId: 'user-drv-1' },
      course: { durationHours: 40 },
    });

    await expect(
      service.logAttendance(
        'enr-1',
        { hoursAttended: 10, status: CourseStatus.FAILED, notes: '   ' },
        instructorUser,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('completes enrollment at full hours and auto-advances application from TRAINING_PENDING to EXAM_PENDING', async () => {
    mockPrisma.trainingEnrollment.findUnique.mockResolvedValue({
      id: 'enr-1',
      applicationId: 'app-1',
      certificateUrl: null,
      notes: null,
      driverProfile: { userId: 'user-drv-1' },
      categoryCode: 'CAT-HV',
      course: { durationHours: 40 },
    });

    mockTx.trainingEnrollment.update.mockResolvedValue({
      id: 'enr-1',
      hoursAttended: 40,
      status: CourseStatus.COMPLETED,
    });

    mockTx.application.findUnique.mockResolvedValue({
      id: 'app-1',
      status: ApplicationStatus.TRAINING_PENDING,
      requestedCategories: [{ category: { code: 'CAT-HV' } }],
    });

    mockTx.trainingEnrollment.findMany.mockResolvedValue([
      { categoryCode: 'CAT-HV' },
    ]);

    const res = await service.logAttendance(
      'enr-1',
      {
        hoursAttended: 40,
        status: CourseStatus.COMPLETED,
        certificateUrl: 'cert-1.pdf',
      },
      instructorUser,
    );

    expect(res.status).toBe(CourseStatus.COMPLETED);
    expect(mockTx.application.update).toHaveBeenCalledWith({
      where: { id: 'app-1' },
      data: {
        status: ApplicationStatus.EXAM_PENDING,
        currentStage: 'Awaiting Theory & Practical Exams',
      },
    });
  });

  describe('findWaiting', () => {
    const app = (id: string, cats: string[], enrolled: string[]) => ({
      id,
      applicationNumber: `APP-${id}`,
      type: 'NEW_AUTHORIZATION',
      updatedAt: new Date('2026-11-01'),
      driverProfile: { id: `d-${id}`, serviceNumber: `MOD-${id}`, fullName: `Driver ${id}`, unit: { code: 'LOG' } },
      requestedCategories: cats.map((code) => ({ category: { code } })),
      trainingEnrollments: enrolled.map((categoryCode) => ({ categoryCode })),
    });

    it('lists only categories that still have no enrollment and skips fully enrolled applications', async () => {
      mockPrisma.application.findMany.mockResolvedValue([
        app('1', ['CAT-HV', 'CAT-LV'], ['CAT-HV']), // LV still waiting
        app('2', ['CAT-HV'], ['CAT-HV']), // fully enrolled: not waiting
        app('3', ['CAT-MV'], []), // waiting
      ]);

      const res = await service.findWaiting({ page: 1, limit: 10 } as any);

      expect(res.total).toBe(2);
      expect(res.items.map((r: any) => [r.id, r.waitingCategories])).toEqual([
        ['1', ['CAT-LV']],
        ['3', ['CAT-MV']],
      ]);
      expect(mockPrisma.application.findMany.mock.calls[0][0].where.status).toBe(
        ApplicationStatus.TRAINING_PENDING,
      );
    });

    it('filters by category and paginates', async () => {
      mockPrisma.application.findMany.mockResolvedValue([
        app('1', ['CAT-HV'], []),
        app('2', ['CAT-HV'], []),
        app('3', ['CAT-LV'], []),
      ]);
      const res = await service.findWaiting({ page: 2, limit: 1, categoryCode: 'cat-hv' } as any);
      expect(res.total).toBe(2);
      expect(res.items).toHaveLength(1);
      expect((res.items[0] as any).id).toBe('2');
    });
  });
});
