import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  ApplicationStatus,
  CourseStatus,
  PersonnelStatus,
  SystemRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PoliciesService } from '../policies/policies.service';
import { TrainingService } from './training.service';

describe('TrainingService — batch enrollment', () => {
  let service: TrainingService;

  const mockTx: any = {
    trainingBatch: {
      findFirst: jest.fn(),
      create: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    trainingBatchSession: { create: jest.fn() },
    trainingEnrollment: { createMany: jest.fn() },
  };

  const mockPrisma: any = {
    trainingCourse: { findMany: jest.fn() },
    user: { findMany: jest.fn() },
    application: { findMany: jest.fn() },
    trainingBatch: { findFirst: jest.fn() },
    $transaction: jest.fn((fn: (tx: any) => any) => fn(mockTx)),
  };

  const admin: any = {
    id: 'user-tadmin',
    serviceNumber: 'MOD-TA-001',
    resolvedPermissions: ['training:manage_courses'],
  };

  const COURSE_SP = {
    id: '11111111-1111-4111-8111-111111111111',
    courseCode: 'TRN-SP-01',
    categoryCodes: ['CAT-SP'],
    durationHours: 40,
    durationDays: 30,
  };
  const INSTRUCTOR = {
    id: '22222222-2222-4222-8222-222222222222',
    serviceNumber: 'MOD-INST-001',
    roles: [SystemRole.INSTRUCTOR],
    isActive: true,
  };
  const APP_ID = '33333333-3333-4333-8333-333333333333';

  const pendingApp = (overrides: any = {}) => ({
    id: APP_ID,
    applicationNumber: 'APP-2026-00010',
    status: ApplicationStatus.TRAINING_PENDING,
    driverProfile: {
      id: 'drv-1',
      fullName: 'Cpl. Abebe',
      personnelStatus: PersonnelStatus.ACTIVE,
    },
    requestedCategories: [{ category: { code: 'CAT-SP' } }],
    trainingEnrollments: [],
    ...overrides,
  });

  const futureStart = new Date(Date.now() + 10 * 86400000)
    .toISOString()
    .slice(0, 10);

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrainingService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PoliciesService, useValue: { getNumber: jest.fn().mockResolvedValue(100) } },
      ],
    }).compile();
    service = module.get(TrainingService);

    mockPrisma.trainingCourse.findMany.mockResolvedValue([COURSE_SP]);
    mockPrisma.user.findMany.mockResolvedValue([INSTRUCTOR]);
    mockPrisma.application.findMany.mockResolvedValue([pendingApp()]);
    mockTx.trainingBatch.findFirst.mockResolvedValue({ batchCode: 'BATCH-003' });
    mockTx.trainingBatch.create.mockImplementation(({ data }: any) =>
      Promise.resolve({ id: 'batch-1', ...data }),
    );
    mockTx.trainingBatchSession.create.mockImplementation(({ data }: any) =>
      Promise.resolve({ id: 'sess-1', ...data }),
    );
    mockTx.trainingBatch.findUniqueOrThrow.mockResolvedValue({ id: 'batch-1' });
  });

  const dto = (sessionOverrides: any = {}) => ({
    sessions: [
      {
        courseId: COURSE_SP.id,
        instructorUserId: INSTRUCTOR.id,
        startDate: futureStart,
        applicationIds: [APP_ID],
        ...sessionOverrides,
      },
    ],
  });

  it('allocates the next sequential batch code and schedules by course duration', async () => {
    await service.createBatch(dto(), admin);

    expect(mockTx.trainingBatch.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ batchCode: 'BATCH-004', createdById: admin.id }),
    });

    const sessionData = mockTx.trainingBatchSession.create.mock.calls[0][0].data;
    const days =
      (sessionData.endDate.getTime() - sessionData.startDate.getTime()) / 86400000;
    expect(days).toBe(30);
    expect(sessionData.instructorUserId).toBe(INSTRUCTOR.id);

    expect(mockTx.trainingEnrollment.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          applicationId: APP_ID,
          batchSessionId: 'sess-1',
          instructorId: 'MOD-INST-001',
          status: CourseStatus.PLANNED,
        }),
      ],
    });
  });

  it('starts numbering at BATCH-001 when no batches exist', async () => {
    mockTx.trainingBatch.findFirst.mockResolvedValue(null);
    await service.createBatch(dto(), admin);
    expect(mockTx.trainingBatch.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ batchCode: 'BATCH-001' }),
    });
  });

  it('rejects a candidate who did not request the category', async () => {
    mockPrisma.application.findMany.mockResolvedValue([
      pendingApp({ requestedCategories: [{ category: { code: 'CAT-HV' } }] }),
    ]);
    await expect(service.createBatch(dto(), admin)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects a candidate already enrolled for the category', async () => {
    mockPrisma.application.findMany.mockResolvedValue([
      pendingApp({
        trainingEnrollments: [{ categoryCode: 'CAT-SP' }],
      }),
    ]);
    await expect(service.createBatch(dto(), admin)).rejects.toThrow(
      ConflictException,
    );
  });

  it('rejects a trainer without the Instructor role', async () => {
    mockPrisma.user.findMany.mockResolvedValue([
      { ...INSTRUCTOR, roles: [SystemRole.EXAMINER] },
    ]);
    await expect(service.createBatch(dto(), admin)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects an end date before the start date', async () => {
    await expect(
      service.createBatch(dto({ endDate: '2020-01-01' }), admin),
    ).rejects.toThrow(BadRequestException);
  });

  it('stamps the session category on the session and its enrollments', async () => {
    await service.createBatch(dto(), admin);
    expect(
      mockTx.trainingBatchSession.create.mock.calls[0][0].data.categoryCode,
    ).toBe('CAT-SP');
    expect(
      mockTx.trainingEnrollment.createMany.mock.calls[0][0].data[0].categoryCode,
    ).toBe('CAT-SP');
  });

  it('bulk-logs attendance per trainee, isolating failures', async () => {
    const ids = {
      planned: '44444444-4444-4444-8444-444444444441',
      done: '44444444-4444-4444-8444-444444444442',
      self: '44444444-4444-4444-8444-444444444443',
      missing: '44444444-4444-4444-8444-444444444444',
    };
    mockPrisma.trainingEnrollment = {
      findMany: jest.fn().mockResolvedValue([
        { id: ids.planned, status: CourseStatus.PLANNED, hoursAttended: 4, notes: 'prior', driverProfile: { serviceNumber: 'ND-1', fullName: 'A' } },
        { id: ids.done, status: CourseStatus.COMPLETED, hoursAttended: 40, notes: null, driverProfile: { serviceNumber: 'ND-2', fullName: 'B' } },
        { id: ids.self, status: CourseStatus.IN_PROGRESS, hoursAttended: 0, notes: null, driverProfile: { serviceNumber: 'ND-3', fullName: 'C' } },
      ]),
    };
    mockPrisma.auditLog = { create: jest.fn() };
    const logSpy = jest
      .spyOn(service, 'logAttendance')
      .mockImplementation(async (id: string, d: any) => {
        if (id === ids.self) throw new Error('Separation of Duties');
        return { id, hoursAttended: d.hoursAttended, status: d.status } as any;
      });

    const res = await service.bulkLogAttendance(
      {
        enrollmentIds: [ids.planned, ids.done, ids.self, ids.missing],
        mode: 'ADD',
        hours: 8,
        notes: 'Day 2 yard',
      },
      admin,
    );

    expect(res.updatedCount).toBe(1);
    expect(res.failedCount).toBe(3);
    // Planned + hours → In Progress, hours added, note appended.
    expect(logSpy).toHaveBeenCalledWith(
      ids.planned,
      expect.objectContaining({
        hoursAttended: 12,
        status: CourseStatus.IN_PROGRESS,
        notes: expect.stringMatching(/^prior\n\[\d{4}-\d{2}-\d{2}\] Day 2 yard$/),
      }),
      admin,
    );
    // Completed records are never touched by bulk logging.
    expect(logSpy).not.toHaveBeenCalledWith(ids.done, expect.anything(), admin);
    expect(res.results.find((r) => r.enrollmentId === ids.missing)?.error).toMatch(
      /not found/,
    );
    expect(mockPrisma.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('FULL mode sets each trainee to their own course hours', async () => {
    const a = '55555555-5555-4555-8555-555555555551';
    const b = '55555555-5555-4555-8555-555555555552';
    mockPrisma.trainingEnrollment = {
      findMany: jest.fn().mockResolvedValue([
        { id: a, status: CourseStatus.IN_PROGRESS, hoursAttended: 6, notes: null, course: { durationHours: 24 }, driverProfile: { serviceNumber: 'ND-1', fullName: 'A' } },
        { id: b, status: CourseStatus.PLANNED, hoursAttended: 0, notes: null, course: { durationHours: 40 }, driverProfile: { serviceNumber: 'ND-2', fullName: 'B' } },
      ]),
    };
    mockPrisma.auditLog = { create: jest.fn() };
    const logSpy = jest
      .spyOn(service, 'logAttendance')
      .mockImplementation(async (id: string, d: any) => ({ id, ...d }) as any);

    const res = await service.bulkLogAttendance(
      { enrollmentIds: [a, b], mode: 'FULL', status: CourseStatus.COMPLETED },
      admin,
    );

    expect(res.updatedCount).toBe(2);
    expect(logSpy).toHaveBeenCalledWith(a, { hoursAttended: 24, status: CourseStatus.COMPLETED }, admin);
    expect(logSpy).toHaveBeenCalledWith(b, { hoursAttended: 40, status: CourseStatus.COMPLETED }, admin);
  });

  it('requires a session category when the course covers several', async () => {
    mockPrisma.trainingCourse.findMany.mockResolvedValue([
      { ...COURSE_SP, categoryCodes: ['CAT-SP', 'CAT-HV'] },
    ]);
    await expect(service.createBatch(dto(), admin)).rejects.toThrow(
      BadRequestException,
    );

    await service.createBatch(dto({ categoryCode: 'CAT-SP' }), admin);
    expect(
      mockTx.trainingBatchSession.create.mock.calls[0][0].data.categoryCode,
    ).toBe('CAT-SP');
  });
});
