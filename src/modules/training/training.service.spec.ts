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
import { PoliciesService } from '../policies/policies.service';
import { TrainingService } from './training.service';

describe('TrainingService', () => {
  let service: TrainingService;

  const mockTx: any = {
    trainingEnrollment: {
      update: jest.fn(),
      findMany: jest.fn(),
    },
    trainingAttendanceDay: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    application: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
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
      update: jest.fn(),
    },
    trainingAttendanceDay: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    trainingBatchSession: { findMany: jest.fn() },
    auditLog: {
      create: jest.fn(),
    },
    $transaction: jest.fn((fn: (tx: any) => any) => fn(mockTx)),
  };

  const mockPolicies = {
    getNumber: jest.fn().mockResolvedValue(100),
  };

  const instructorUser = {
    id: 'user-inst-1',
    serviceNumber: 'MOD-INST-001',
    unitId: 'unit-1',
    resolvedPermissions: ['training:log_attendance'],
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPolicies.getNumber.mockResolvedValue(100);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrainingService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PoliciesService, useValue: mockPolicies },
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

  describe('date-based attendance (setAttendance & bulkMarkAttendance)', () => {
    // 2026-11-16 (Mon) to 2026-11-20 (Fri) = 5 training days
    const batchSession = {
      startDate: new Date('2026-11-16T08:00:00.000Z'),
      endDate: new Date('2026-11-20T17:00:00.000Z'),
    };

    const baseEnrollment = {
      id: 'enr-date-1',
      status: CourseStatus.PLANNED,
      hoursAttended: 0,
      course: { durationHours: 40 },
      driverProfile: { id: 'd-1', userId: 'driver-user-1', serviceNumber: 'MOD-DRV-001', fullName: 'Abebe Bikila' },
      batchSession,
      attendanceDays: [],
      applicationId: 'app-1',
    };

    it('rejects self-marking attendance with Separation of Duties', async () => {
      mockPrisma.trainingEnrollment.findUnique.mockResolvedValue({
        ...baseEnrollment,
        driverProfile: { ...baseEnrollment.driverProfile, userId: instructorUser.id },
      });

      await expect(
        service.setAttendance('enr-date-1', { attendedDates: ['2026-11-16'] }, instructorUser),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects attendance change on final COMPLETED or FAILED enrollment', async () => {
      mockPrisma.trainingEnrollment.findUnique.mockResolvedValue({
        ...baseEnrollment,
        status: CourseStatus.COMPLETED,
      });

      await expect(
        service.setAttendance('enr-date-1', { attendedDates: ['2026-11-16'] }, instructorUser),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects enrollment without training days', async () => {
      mockPrisma.trainingEnrollment.findUnique.mockResolvedValue({
        ...baseEnrollment,
        batchSession: null,
      });

      await expect(
        service.setAttendance('enr-date-1', { attendedDates: ['2026-11-16'] }, instructorUser),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects non-training date (weekend)', async () => {
      mockPrisma.trainingEnrollment.findUnique.mockResolvedValue(baseEnrollment);

      await expect(
        service.setAttendance('enr-date-1', { attendedDates: ['2026-11-21'] }, instructorUser),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'TRAINING_ATTENDANCE_DATE_INVALID' }),
      });
    });

    it('rejects future date', async () => {
      mockPrisma.trainingEnrollment.findUnique.mockResolvedValue({
        ...baseEnrollment,
        batchSession: {
          startDate: new Date('2029-01-01T00:00:00.000Z'),
          endDate: new Date('2029-01-10T00:00:00.000Z'),
        },
      });

      await expect(
        service.setAttendance('enr-date-1', { attendedDates: ['2029-01-02'] }, instructorUser),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'TRAINING_ATTENDANCE_DATE_FUTURE' }),
      });
    });

    it('marks days -> IN_PROGRESS below required percent', async () => {
      mockPrisma.trainingEnrollment.findUnique.mockResolvedValue(baseEnrollment);
      mockPolicies.getNumber.mockResolvedValue(100);

      mockTx.trainingEnrollment.update.mockResolvedValue({
        ...baseEnrollment,
        status: CourseStatus.IN_PROGRESS,
        hoursAttended: 16,
        attendanceDays: [{ date: new Date('2026-11-16') }, { date: new Date('2026-11-17') }],
      });

      const res = await service.setAttendance(
        'enr-date-1',
        { attendedDates: ['2026-11-16', '2026-11-17'] },
        instructorUser,
      );

      expect(res.status).toBe(CourseStatus.IN_PROGRESS);
      expect(mockTx.trainingAttendanceDay.deleteMany).toHaveBeenCalled();
      expect(mockTx.trainingAttendanceDay.createMany).toHaveBeenCalled();
      expect(mockTx.application.update).not.toHaveBeenCalled();
      expect(mockTx.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'MARK_TRAINING_ATTENDANCE',
            newValue: expect.objectContaining({ attendedDays: 2, status: CourseStatus.IN_PROGRESS }),
          }),
        }),
      );
    });

    it('reaches policy % -> COMPLETED and auto-advances application to EXAM_PENDING', async () => {
      mockPrisma.trainingEnrollment.findUnique.mockResolvedValue(baseEnrollment);
      mockPolicies.getNumber.mockResolvedValue(80);

      mockTx.trainingEnrollment.update.mockResolvedValue({
        ...baseEnrollment,
        status: CourseStatus.COMPLETED,
        hoursAttended: 32,
        attendanceDays: [
          { date: new Date('2026-11-16') },
          { date: new Date('2026-11-17') },
          { date: new Date('2026-11-18') },
          { date: new Date('2026-11-19') },
        ],
      });

      mockTx.application.findUnique.mockResolvedValue({
        id: 'app-1',
        status: ApplicationStatus.TRAINING_PENDING,
        requestedCategories: [{ category: { code: 'CAT-HV' } }],
      });
      mockTx.trainingEnrollment.findMany.mockResolvedValue([{ categoryCode: 'CAT-HV' }]);

      const res = await service.setAttendance(
        'enr-date-1',
        { attendedDates: ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19'] },
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

    it('logAttendance COMPLETED is rejected with TRAINING_COMPLETE_BELOW_POLICY when below policy %', async () => {
      mockPrisma.trainingEnrollment.findUnique.mockResolvedValue({
        ...baseEnrollment,
        attendanceDays: [{ date: new Date('2026-11-16') }],
      });
      mockPolicies.getNumber.mockResolvedValue(100);

      await expect(
        service.logAttendance('enr-date-1', { status: CourseStatus.COMPLETED }, instructorUser),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'TRAINING_COMPLETE_BELOW_POLICY' }),
      });
    });

    it('bulkMarkAttendance handles ALL and DAY modes and isolates errors', async () => {
      mockPolicies.getNumber.mockResolvedValue(100);
      mockPrisma.trainingEnrollment.findMany.mockResolvedValue([
        baseEnrollment,
        {
          ...baseEnrollment,
          id: 'enr-date-2',
          status: CourseStatus.COMPLETED,
          driverProfile: { serviceNumber: 'MOD-DRV-002', fullName: 'Kebede' },
        },
      ]);

      mockPrisma.trainingEnrollment.findUnique.mockImplementation(({ where }: any) => {
        if (where.id === 'enr-date-1') return Promise.resolve(baseEnrollment);
        if (where.id === 'enr-date-2')
          return Promise.resolve({ ...baseEnrollment, id: 'enr-date-2', status: CourseStatus.COMPLETED });
        return Promise.resolve(null);
      });

      mockTx.trainingEnrollment.update.mockResolvedValue({
        ...baseEnrollment,
        status: CourseStatus.IN_PROGRESS,
        hoursAttended: 8,
        attendanceDays: [{ date: new Date('2026-11-16') }],
      });

      const res = await service.bulkMarkAttendance(
        {
          enrollmentIds: ['enr-date-1', 'enr-date-2'],
          mode: 'DAY',
          date: '2026-11-16',
        },
        instructorUser,
      );

      expect(res.totalRequested).toBe(2);
      expect(res.updatedCount).toBe(1);
      expect(res.failedCount).toBe(1);
      expect(res.results[0]).toMatchObject({ enrollmentId: 'enr-date-1', status: 'UPDATED' });
      expect(res.results[1]).toMatchObject({ enrollmentId: 'enr-date-2', status: 'FAILED' });
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
