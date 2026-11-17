import { Injectable } from '@nestjs/common';
import {
  AppBadRequestException,
  AppConflictException,
  AppForbiddenException,
  AppNotFoundException,
} from '../../common/errors';
import {
  ApplicationStatus,
  CourseStatus,
  PersonnelStatus,
  Prisma,
  SystemRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/paginated-result.dto';
import { Permission } from '../../common/enums/permissions.enum';
import { RequestUserContext } from '../personnel/services/drivers.service';
import { CreateCourseDto } from './dto/create-course.dto';
import { UpdateCourseDto } from './dto/update-course.dto';
import { CreateEnrollmentDto } from './dto/create-enrollment.dto';
import { LogAttendanceDto } from './dto/log-attendance.dto';
import { QueryEnrollmentsDto } from './dto/query-enrollments.dto';
import { CreateBatchDto } from './dto/create-batch.dto';
import { BulkLogAttendanceDto } from './dto/bulk-log-attendance.dto';

const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH_PREFIX = 'BATCH-';

/** Enrollment statuses that block re-enrolling the same application/category. */
const BLOCKING_ENROLLMENT_STATUSES: CourseStatus[] = [
  CourseStatus.PLANNED,
  CourseStatus.IN_PROGRESS,
  CourseStatus.COMPLETED,
];

const BATCH_INCLUDE = {
  createdBy: { select: { id: true, serviceNumber: true, fullName: true } },
  sessions: {
    orderBy: { categoryCode: 'asc' as const },
    include: {
      course: {
        select: {
          id: true,
          courseCode: true,
          title: true,
          categoryCodes: true,
          durationHours: true,
          durationDays: true,
        },
      },
      instructor: {
        select: { id: true, serviceNumber: true, fullName: true, rank: true },
      },
      enrollments: {
        select: {
          id: true,
          status: true,
          hoursAttended: true,
          driverProfile: {
            select: { id: true, serviceNumber: true, fullName: true },
          },
          application: { select: { id: true, applicationNumber: true } },
        },
      },
    },
  },
};

/** Enrollments still awaiting an outcome. */
const OPEN_ENROLLMENT_STATUSES: CourseStatus[] = [
  CourseStatus.PLANNED,
  CourseStatus.IN_PROGRESS,
];

const FAILED_ATTEMPT_SELECT = {
  id: true,
  driverProfileId: true,
  applicationId: true,
  categoryCode: true,
  hoursAttended: true,
  notes: true,
  createdAt: true,
  course: { select: { courseCode: true, durationHours: true } },
  batchSession: {
    select: { endDate: true, batch: { select: { batchCode: true } } },
  },
} satisfies Prisma.TrainingEnrollmentSelect;

type FailedAttempt = Prisma.TrainingEnrollmentGetPayload<{
  select: typeof FAILED_ATTEMPT_SELECT;
}>;

/** Compact description of an earlier failed attempt for the UI. */
function toAttemptSummary(f: FailedAttempt) {
  return {
    enrollmentId: f.id,
    batchCode: f.batchSession?.batch.batchCode ?? null,
    courseCode: f.course.courseCode,
    hoursAttended: f.hoursAttended,
    requiredHours: f.course.durationHours,
    endedAt: f.batchSession?.endDate ?? null,
    enrolledAt: f.createdAt,
    notes: f.notes,
  };
}

const COURSE_COUNTS = {
  _count: { select: { enrollments: true, batchSessions: true } },
};

function formatBatchCode(n: number) {
  return `${BATCH_PREFIX}${String(n).padStart(3, '0')}`;
}

const INELIGIBLE_PERSONNEL: PersonnelStatus[] = [
  PersonnelStatus.SUSPENDED,
  PersonnelStatus.SEPARATED,
  PersonnelStatus.RETIRED,
];

const ENROLLMENT_INCLUDE = {
  course: true,
  driverProfile: {
    select: {
      id: true,
      userId: true,
      serviceNumber: true,
      fullName: true,
      photoUrl: true,
      unit: { select: { id: true, code: true, name: true } },
    },
  },
  application: {
    select: {
      id: true,
      applicationNumber: true,
      type: true,
      status: true,
    },
  },
  batchSession: {
    select: {
      id: true,
      startDate: true,
      endDate: true,
      batch: { select: { id: true, batchCode: true } },
      instructor: {
        select: { id: true, serviceNumber: true, fullName: true },
      },
    },
  },
};

@Injectable()
export class TrainingService {
  constructor(private readonly prisma: PrismaService) {}

  getStatus() {
    return {
      module: 'training',
      description: 'Training Courses, Attendance & Certificates',
      status: 'READY',
    };
  }

  async findAllCourses(categoryCode?: string) {
    const courses = await this.prisma.trainingCourse.findMany({
      where: categoryCode
        ? { categoryCodes: { has: categoryCode.trim().toUpperCase() } }
        : undefined,
      include: COURSE_COUNTS,
      orderBy: { courseCode: 'asc' },
    });
    return courses.map((c) => ({
      ...c,
      categoryCodes: [...c.categoryCodes].sort(),
    }));
  }

  /** Normalise and verify that every requested category exists. */
  private async resolveCategoryCodes(raw: string[]): Promise<string[]> {
    const codes = [...new Set(raw.map((c) => c.trim().toUpperCase()))].filter(
      Boolean,
    );
    if (codes.length === 0) {
      throw new AppBadRequestException(
        'TRAINING_SELECT_CATEGORY',
        {},
        'Select at least one vehicle category.',
      );
    }
    const found = await this.prisma.vehicleCategory.findMany({
      where: { code: { in: codes } },
      select: { code: true },
    });
    const known = new Set(found.map((c) => c.code));
    const missing = codes.filter((c) => !known.has(c));
    if (missing.length > 0) {
      throw new AppNotFoundException(
        'TRAINING_CATEGORIES_NOT_FOUND',
        { categories: missing.join(', '), count: missing.length },
        `Vehicle categor${missing.length > 1 ? 'ies' : 'y'} ${missing.join(', ')} not found.`,
      );
    }
    return codes.sort();
  }

  async createCourse(dto: CreateCourseDto) {
    const courseCode = dto.courseCode.trim().toUpperCase();

    const existing = await this.prisma.trainingCourse.findUnique({
      where: { courseCode },
    });
    if (existing) {
      throw new AppConflictException(
        'TRAINING_COURSE_CODE_EXISTS',
        { courseCode },
        `Course code ${courseCode} already exists.`,
      );
    }

    const categoryCodes = await this.resolveCategoryCodes(dto.categoryCodes);

    return this.prisma.trainingCourse.create({
      data: {
        courseCode,
        title: dto.title.trim(),
        categoryCodes,
        durationHours: dto.durationHours,
        durationDays: dto.durationDays ?? 30,
        syllabus: dto.syllabus?.trim() || null,
      },
      include: COURSE_COUNTS,
    });
  }

  async updateCourse(id: string, dto: UpdateCourseDto) {
    const existing = await this.prisma.trainingCourse.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new AppNotFoundException(
        'TRAINING_COURSE_NOT_FOUND',
        {},
        'Training course not found.',
      );
    }

    let nextCategoryCodes: string[] | undefined;
    if (dto.categoryCodes !== undefined) {
      nextCategoryCodes = await this.resolveCategoryCodes(dto.categoryCodes);

      // A category that already has trainees on this course cannot be dropped.
      const removed = existing.categoryCodes.filter(
        (c) => !nextCategoryCodes!.includes(c),
      );
      if (removed.length > 0) {
        const inUse = await this.prisma.trainingEnrollment.groupBy({
          by: ['categoryCode'],
          where: { courseId: id, categoryCode: { in: removed } },
          _count: { _all: true },
        });
        const sessions = await this.prisma.trainingBatchSession.findMany({
          where: { courseId: id, categoryCode: { in: removed } },
          select: { categoryCode: true },
          distinct: ['categoryCode'],
        });
        const blocked = [
          ...new Set([
            ...inUse.map((g) => g.categoryCode),
            ...sessions.map((s) => s.categoryCode),
          ]),
        ];
        if (blocked.length > 0) {
          throw new AppConflictException(
            'TRAINING_CATEGORY_REMOVE_BLOCKED',
            { categories: blocked.join(', '), count: blocked.length },
            `Cannot remove ${blocked.join(', ')}: this course already has trainees or batch sessions for ${blocked.length > 1 ? 'those categories' : 'that category'}.`,
          );
        }
      }
    }

    return this.prisma.trainingCourse.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        ...(nextCategoryCodes ? { categoryCodes: nextCategoryCodes } : {}),
        ...(dto.durationHours !== undefined
          ? { durationHours: dto.durationHours }
          : {}),
        ...(dto.durationDays !== undefined
          ? { durationDays: dto.durationDays }
          : {}),
        ...(dto.syllabus !== undefined
          ? { syllabus: dto.syllabus.trim() || null }
          : {}),
      },
      include: COURSE_COUNTS,
    });
  }

  /**
   * Remove a course from the catalog. Courses with any training history
   * (enrollments or batch sessions) are kept so records stay traceable.
   */
  async deleteCourse(id: string) {
    const course = await this.prisma.trainingCourse.findUnique({
      where: { id },
      include: COURSE_COUNTS,
    });
    if (!course) {
      throw new AppNotFoundException(
        'TRAINING_COURSE_NOT_FOUND',
        {},
        'Training course not found.',
      );
    }
    const { enrollments, batchSessions } = course._count;
    if (enrollments > 0 || batchSessions > 0) {
      const parts = [
        enrollments > 0
          ? `${enrollments} enrollment${enrollments === 1 ? '' : 's'}`
          : null,
        batchSessions > 0
          ? `${batchSessions} batch session${batchSessions === 1 ? '' : 's'}`
          : null,
      ].filter(Boolean);
      throw new AppConflictException(
        'TRAINING_COURSE_DELETE_BLOCKED',
        {
          courseCode: course.courseCode,
          enrollments,
          batchSessions,
          both: enrollments > 0 && batchSessions > 0 ? 'yes' : 'no',
        },
        `${course.courseCode} has ${parts.join(' and ')} and cannot be deleted.`,
      );
    }

    await this.prisma.trainingCourse.delete({ where: { id } });
    return { id, courseCode: course.courseCode, deleted: true };
  }

  /**
   * Pick the category an enrollment trains for: the explicit one when given,
   * otherwise the single course category that fits (optionally narrowed to
   * the application's requested categories).
   */
  private resolveEnrollmentCategory(
    courseCodes: string[],
    courseCode: string,
    requested?: string,
    allowed?: string[],
  ): string {
    const courseLabel = `Course ${courseCode}`;
    if (requested) {
      const code = requested.trim().toUpperCase();
      if (!courseCodes.includes(code)) {
        throw new AppBadRequestException(
          'TRAINING_COURSE_CATEGORY_MISMATCH',
          { course: courseCode, category: code, covers: courseCodes.join(', ') },
          `${courseLabel} does not cover ${code} (covers ${courseCodes.join(', ')}).`,
        );
      }
      if (allowed && !allowed.includes(code)) {
        throw new AppBadRequestException(
          'TRAINING_CATEGORY_NOT_REQUESTED',
          { category: code, requested: allowed.join(', ') },
          `Category ${code} was not requested by the application (${allowed.join(', ')}).`,
        );
      }
      return code;
    }

    const options = allowed
      ? courseCodes.filter((c) => allowed.includes(c))
      : courseCodes;
    if (options.length === 0) {
      throw new AppBadRequestException(
        'TRAINING_COURSE_NO_APPLICABLE_CATEGORY',
        {
          course: courseCode,
          covers: courseCodes.join(', '),
          requested: (allowed ?? []).join(', '),
        },
        `${courseLabel} (${courseCodes.join(', ')}) does not match the application's requested categories (${(allowed ?? []).join(', ')}).`,
      );
    }
    if (options.length > 1) {
      throw new AppBadRequestException(
        'TRAINING_COURSE_AMBIGUOUS_CATEGORY',
        { course: courseCode, options: options.join(', ') },
        `${courseLabel} covers several applicable categories (${options.join(', ')}); specify which one.`,
      );
    }
    return options[0];
  }

  async findAllEnrollments(
    query: QueryEnrollmentsDto,
    user: RequestUserContext,
  ) {
    const perms = new Set(user.resolvedPermissions || []);
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    const where: any = {};

    const canViewStaffQueue =
      perms.has(Permission.TRAINING_MANAGE_COURSES) ||
      perms.has(Permission.TRAINING_LOG_ATTENDANCE) ||
      perms.has(Permission.APPLICATIONS_VIEW_ALL);

    if (!canViewStaffQueue) {
      where.driverProfile = { userId: user.id };
    }

    if (query.courseId) where.courseId = query.courseId;
    if (query.applicationId) where.applicationId = query.applicationId;
    if (query.driverProfileId) where.driverProfileId = query.driverProfileId;
    if (query.status) where.status = query.status;
    if (query.batchId) where.batchSession = { batchId: query.batchId };
    if (query.categoryCode) {
      where.categoryCode = query.categoryCode.trim().toUpperCase();
    }
    if (query.overdue) {
      where.status = { in: OPEN_ENROLLMENT_STATUSES };
      where.batchSession = {
        ...(where.batchSession ?? {}),
        endDate: { lt: new Date() },
      };
    }

    if (query.search) {
      where.OR = [
        {
          course: {
            courseCode: { contains: query.search, mode: 'insensitive' },
          },
        },
        {
          course: { title: { contains: query.search, mode: 'insensitive' } },
        },
        {
          driverProfile: {
            serviceNumber: { contains: query.search, mode: 'insensitive' },
          },
        },
        {
          driverProfile: {
            fullName: { contains: query.search, mode: 'insensitive' },
          },
        },
        {
          application: {
            applicationNumber: { contains: query.search, mode: 'insensitive' },
          },
        },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.trainingEnrollment.findMany({
        where,
        include: ENROLLMENT_INCLUDE,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.trainingEnrollment.count({ where }),
    ]);

    const withAttempts = await this.attachAttemptHistory(items);
    return new PaginatedResult(withAttempts, total, page, limit);
  }

  /**
   * Annotate enrollments with their attempt number (1 = first try) and the
   * most recent earlier failed attempt for the same driver, application and
   * category.
   */
  private async attachAttemptHistory<
    T extends {
      id: string;
      driverProfileId: string;
      applicationId: string | null;
      categoryCode: string;
      createdAt: Date;
    },
  >(items: T[]) {
    if (items.length === 0) return [];

    const failures = await this.prisma.trainingEnrollment.findMany({
      where: {
        status: CourseStatus.FAILED,
        OR: items.map((i) => ({
          driverProfileId: i.driverProfileId,
          applicationId: i.applicationId,
          categoryCode: i.categoryCode,
        })),
      },
      select: FAILED_ATTEMPT_SELECT,
      orderBy: { createdAt: 'desc' },
    });

    return items.map((item) => {
      const prior = failures.filter(
        (f) =>
          f.id !== item.id &&
          f.driverProfileId === item.driverProfileId &&
          f.applicationId === item.applicationId &&
          f.categoryCode === item.categoryCode &&
          f.createdAt < item.createdAt,
      );
      return {
        ...item,
        attempt: prior.length + 1,
        previousAttempt: prior[0] ? toAttemptSummary(prior[0]) : null,
      };
    });
  }

  async enrollCandidate(dto: CreateEnrollmentDto) {
    const [driver, course] = await Promise.all([
      this.prisma.driverProfile.findUnique({
        where: { id: dto.driverProfileId },
      }),
      this.prisma.trainingCourse.findUnique({ where: { id: dto.courseId } }),
    ]);

    if (!driver) {
      throw new AppNotFoundException(
        'TRAINING_DRIVER_NOT_FOUND',
        {},
        'Driver profile not found.',
      );
    }
    if (!course) {
      throw new AppNotFoundException(
        'TRAINING_COURSE_NOT_FOUND',
        {},
        'Training course not found.',
      );
    }
    if (INELIGIBLE_PERSONNEL.includes(driver.personnelStatus)) {
      throw new AppBadRequestException(
        'TRAINING_DRIVER_INELIGIBLE',
        { status: driver.personnelStatus },
        `Driver with status ${driver.personnelStatus} cannot be enrolled in training.`,
      );
    }

    let allowedCodes: string[] | undefined;
    if (dto.applicationId) {
      const app = await this.prisma.application.findUnique({
        where: { id: dto.applicationId },
        include: {
          requestedCategories: { include: { category: true } },
        },
      });

      if (!app) {
        throw new AppNotFoundException(
          'TRAINING_LINKED_APPLICATION_NOT_FOUND',
          {},
          'Linked application not found.',
        );
      }
      if (app.driverProfileId !== dto.driverProfileId) {
        throw new AppBadRequestException(
          'TRAINING_APPLICATION_DRIVER_MISMATCH',
          {},
          'Linked application does not belong to the selected driver.',
        );
      }
      if (app.status !== ApplicationStatus.TRAINING_PENDING) {
        throw new AppBadRequestException(
          'TRAINING_APPLICATION_NOT_PENDING',
          { status: app.status },
          `Application must be in TRAINING_PENDING status for course enrollment (current: ${app.status}).`,
        );
      }

      allowedCodes = app.requestedCategories.map((rc) => rc.category.code);
    }

    const categoryCode = this.resolveEnrollmentCategory(
      course.categoryCodes,
      course.courseCode,
      dto.categoryCode,
      allowedCodes,
    );

    const duplicate = await this.prisma.trainingEnrollment.findFirst({
      where: {
        driverProfileId: dto.driverProfileId,
        courseId: dto.courseId,
        categoryCode,
        applicationId: dto.applicationId ?? null,
        status: { in: [CourseStatus.PLANNED, CourseStatus.IN_PROGRESS] },
      },
    });
    if (duplicate) {
      throw new AppConflictException(
        'TRAINING_ENROLLMENT_DUPLICATE',
        { category: categoryCode },
        `Driver already has an active ${categoryCode} enrollment in this training course.`,
      );
    }

    return this.prisma.trainingEnrollment.create({
      data: {
        driverProfileId: dto.driverProfileId,
        courseId: dto.courseId,
        categoryCode,
        applicationId: dto.applicationId ?? null,
        instructorId: dto.instructorId?.trim() || null,
        hoursAttended: 0,
        status: CourseStatus.IN_PROGRESS,
        notes: dto.notes?.trim() || null,
      },
      include: ENROLLMENT_INCLUDE,
    });
  }

  /* ------------------------------------------------------------------ */
  /* Batch enrollment workspace                                          */
  /* ------------------------------------------------------------------ */

  async findInstructors() {
    return this.prisma.user.findMany({
      where: { isActive: true, roles: { has: SystemRole.INSTRUCTOR } },
      select: {
        id: true,
        serviceNumber: true,
        fullName: true,
        rank: true,
        unit: { select: { code: true, name: true } },
      },
      orderBy: [{ fullName: 'asc' }, { serviceNumber: 'asc' }],
    });
  }

  /**
   * TRAINING_PENDING applications that request the given category and have
   * no planned / running / completed enrollment for that category yet.
   */
  async findCandidates(categoryCode: string) {
    const code = categoryCode.trim().toUpperCase();

    const candidates = await this.prisma.application.findMany({
      where: {
        status: ApplicationStatus.TRAINING_PENDING,
        requestedCategories: { some: { category: { code } } },
        trainingEnrollments: {
          none: {
            status: { in: BLOCKING_ENROLLMENT_STATUSES },
            categoryCode: code,
          },
        },
        driverProfile: {
          personnelStatus: { notIn: INELIGIBLE_PERSONNEL },
        },
      },
      select: {
        id: true,
        applicationNumber: true,
        type: true,
        updatedAt: true,
        driverProfile: {
          select: {
            id: true,
            serviceNumber: true,
            fullName: true,
            rank: true,
            photoUrl: true,
            unit: { select: { code: true, name: true } },
          },
        },
        requestedCategories: {
          select: { category: { select: { code: true } } },
        },
        trainingEnrollments: {
          where: { categoryCode: code, status: CourseStatus.FAILED },
          select: FAILED_ATTEMPT_SELECT,
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { updatedAt: 'asc' },
    });

    // A candidate who failed before is re-enrolling: attempt = failures + 1.
    return candidates.map(({ trainingEnrollments: failed, ...c }) => ({
      ...c,
      attempt: failed.length + 1,
      previousAttempt: failed[0] ? toAttemptSummary(failed[0]) : null,
    }));
  }

  async getNextBatchCode() {
    return { batchCode: formatBatchCode(await this.nextBatchNumber()) };
  }

  private async nextBatchNumber(
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const latest = await client.trainingBatch.findFirst({
      where: { batchCode: { startsWith: BATCH_PREFIX } },
      orderBy: { batchCode: 'desc' },
      select: { batchCode: true },
    });
    const n = latest
      ? parseInt(latest.batchCode.slice(BATCH_PREFIX.length), 10)
      : 0;
    return (Number.isFinite(n) ? n : 0) + 1;
  }

  async findAllBatches() {
    return this.prisma.trainingBatch.findMany({
      include: BATCH_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  async createBatch(dto: CreateBatchDto, officer: RequestUserContext) {
    // ---- Courses / categories ----
    const courseIds = dto.sessions.map((s) => s.courseId);
    const courses = await this.prisma.trainingCourse.findMany({
      where: { id: { in: courseIds } },
    });
    const courseById = new Map(courses.map((c) => [c.id, c]));

    // Category each session trains (index-aligned with dto.sessions).
    const sessionCodes: string[] = [];
    const seenCategories = new Set<string>();
    for (const s of dto.sessions) {
      const course = courseById.get(s.courseId);
      if (!course) {
        throw new AppNotFoundException(
          'TRAINING_COURSE_ID_NOT_FOUND',
          { courseId: s.courseId },
          `Training course ${s.courseId} not found.`,
        );
      }
      const code = this.resolveEnrollmentCategory(
        course.categoryCodes,
        course.courseCode,
        s.categoryCode,
      );
      if (seenCategories.has(code)) {
        throw new AppBadRequestException(
          'TRAINING_BATCH_CATEGORY_DUPLICATE',
          { category: code },
          `Category ${code} appears more than once in this batch.`,
        );
      }
      seenCategories.add(code);
      sessionCodes.push(code);
    }

    // ---- Instructors ----
    const instructorIds = [
      ...new Set(dto.sessions.map((s) => s.instructorUserId)),
    ];
    const instructors = await this.prisma.user.findMany({
      where: { id: { in: instructorIds } },
      select: { id: true, serviceNumber: true, roles: true, isActive: true },
    });
    const instructorById = new Map(instructors.map((u) => [u.id, u]));
    for (const id of instructorIds) {
      const u = instructorById.get(id);
      if (!u || !u.isActive || !u.roles.includes(SystemRole.INSTRUCTOR)) {
        throw new AppBadRequestException(
          'TRAINING_BATCH_INSTRUCTOR_INVALID',
          {},
          'Each category must be assigned an active user with the Instructor role.',
        );
      }
    }

    // ---- Schedule ----
    const schedules = dto.sessions.map((s, i) => {
      const course = courseById.get(s.courseId)!;
      const start = new Date(s.startDate);
      const end = s.endDate
        ? new Date(s.endDate)
        : new Date(start.getTime() + course.durationDays * DAY_MS);
      if (end <= start) {
        throw new AppBadRequestException(
          'TRAINING_BATCH_END_BEFORE_START',
          { category: sessionCodes[i] },
          `${sessionCodes[i]}: end date must be after the start date.`,
        );
      }
      return { start, end };
    });

    // ---- Applications ----
    const allAppIds = dto.sessions.flatMap((s) => s.applicationIds);
    const apps = await this.prisma.application.findMany({
      where: { id: { in: allAppIds } },
      include: {
        driverProfile: {
          select: { id: true, personnelStatus: true, fullName: true },
        },
        requestedCategories: {
          include: { category: { select: { code: true } } },
        },
        trainingEnrollments: {
          where: { status: { in: BLOCKING_ENROLLMENT_STATUSES } },
          select: { categoryCode: true },
        },
      },
    });
    const appById = new Map(apps.map((a) => [a.id, a]));

    for (const [i, s] of dto.sessions.entries()) {
      const code = sessionCodes[i];
      for (const appId of s.applicationIds) {
        const app = appById.get(appId);
        if (!app) {
          throw new AppNotFoundException(
            'TRAINING_APPLICATION_ID_NOT_FOUND',
            { applicationId: appId },
            `Application ${appId} not found.`,
          );
        }
        const label = `${app.applicationNumber} (${app.driverProfile.fullName})`;
        const who = {
          applicationNumber: app.applicationNumber,
          driverName: app.driverProfile.fullName,
        };
        if (app.status !== ApplicationStatus.TRAINING_PENDING) {
          throw new AppBadRequestException(
            'TRAINING_APPLICATION_NOT_AWAITING',
            { ...who, status: app.status },
            `${label} is not awaiting training (current: ${app.status}).`,
          );
        }
        if (INELIGIBLE_PERSONNEL.includes(app.driverProfile.personnelStatus)) {
          throw new AppBadRequestException(
            'TRAINING_BATCH_DRIVER_INELIGIBLE',
            { ...who, status: app.driverProfile.personnelStatus },
            `${label}: driver status ${app.driverProfile.personnelStatus} is not eligible for training.`,
          );
        }
        if (!app.requestedCategories.some((rc) => rc.category.code === code)) {
          throw new AppBadRequestException(
            'TRAINING_APPLICATION_CATEGORY_NOT_REQUESTED',
            { ...who, category: code },
            `${label} did not request ${code}.`,
          );
        }
        if (
          app.trainingEnrollments.some((e) => e.categoryCode === code)
        ) {
          throw new AppConflictException(
            'TRAINING_APPLICATION_ALREADY_ENROLLED',
            { ...who, category: code },
            `${label} is already enrolled for ${code}.`,
          );
        }
      }
    }

    // ---- Persist (retry if a concurrent request grabbed the same code) ----
    const now = new Date();
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const batchCode = formatBatchCode(await this.nextBatchNumber(tx));

          const batch = await tx.trainingBatch.create({
            data: {
              batchCode,
              notes: dto.notes?.trim() || null,
              createdById: officer.id,
            },
          });

          for (const [i, s] of dto.sessions.entries()) {
            const course = courseById.get(s.courseId)!;
            const instructor = instructorById.get(s.instructorUserId)!;
            const { start, end } = schedules[i];
            const code = sessionCodes[i];

            const session = await tx.trainingBatchSession.create({
              data: {
                batchId: batch.id,
                courseId: course.id,
                categoryCode: code,
                instructorUserId: instructor.id,
                startDate: start,
                endDate: end,
              },
            });

            await tx.trainingEnrollment.createMany({
              data: s.applicationIds.map((appId) => ({
                driverProfileId: appById.get(appId)!.driverProfile.id,
                applicationId: appId,
                courseId: course.id,
                categoryCode: code,
                batchSessionId: session.id,
                instructorId: instructor.serviceNumber,
                hoursAttended: 0,
                status:
                  start > now ? CourseStatus.PLANNED : CourseStatus.IN_PROGRESS,
                notes: `${batchCode} · ${code}`,
              })),
            });
          }

          return tx.trainingBatch.findUniqueOrThrow({
            where: { id: batch.id },
            include: BATCH_INCLUDE,
          });
        });
      } catch (err) {
        const isCodeClash =
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002' &&
          String(err.meta?.target ?? '').includes('batchCode');
        if (!isCodeClash || attempt === 2) throw err;
      }
    }
    throw new AppConflictException(
      'TRAINING_BATCH_CODE_ALLOCATION_FAILED',
      {},
      'Could not allocate a batch code. Please retry.',
    );
  }

  /**
   * Log one attendance entry for many trainees at once. Each enrollment is
   * processed independently with the same rules as single logging (no
   * self-logging, completion needs the course hours, failure needs notes), so
   * one bad row doesn't block the rest.
   */
  async bulkLogAttendance(
    dto: BulkLogAttendanceDto,
    officer: RequestUserContext,
  ) {
    const ids = [...new Set(dto.enrollmentIds)];
    const note = dto.notes?.trim() || '';
    const enrollments = await this.prisma.trainingEnrollment.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        status: true,
        hoursAttended: true,
        notes: true,
        course: { select: { durationHours: true } },
        driverProfile: { select: { serviceNumber: true, fullName: true } },
      },
    });
    const byId = new Map(enrollments.map((e) => [e.id, e]));
    const hours = dto.hours ?? 0;

    const results: Array<{
      enrollmentId: string;
      serviceNumber?: string;
      fullName?: string;
      status: 'UPDATED' | 'FAILED';
      hoursAttended?: number;
      courseStatus?: CourseStatus;
      error?: string;
      errorCode?: string;
      errorParams?: Record<string, unknown>;
    }> = [];

    for (const id of ids) {
      const current = byId.get(id);
      if (!current) {
        results.push({
          enrollmentId: id,
          status: 'FAILED',
          error: 'Training enrollment record not found.',
          errorCode: 'TRAINING_ENROLLMENT_NOT_FOUND',
          errorParams: {},
        });
        continue;
      }
      const who = {
        serviceNumber: current.driverProfile.serviceNumber,
        fullName: current.driverProfile.fullName,
      };

      try {
        if (
          current.status === CourseStatus.COMPLETED ||
          current.status === CourseStatus.FAILED
        ) {
          throw new AppBadRequestException(
            'TRAINING_ATTENDANCE_ALREADY_FINAL',
            {
              outcome:
                current.status === CourseStatus.COMPLETED
                  ? 'completed'
                  : 'failed',
            },
            `Already ${current.status === CourseStatus.COMPLETED ? 'completed' : 'failed'}; open the trainee's record to change it.`,
          );
        }

        const hoursAttended =
          dto.mode === 'FULL'
            ? current.course.durationHours
            : dto.mode === 'ADD'
              ? current.hoursAttended + hours
              : hours;
        const status =
          dto.status ??
          (current.status === CourseStatus.PLANNED && hoursAttended > 0
            ? CourseStatus.IN_PROGRESS
            : current.status);
        const stamp = new Date().toISOString().slice(0, 10);
        const notes = note
          ? [current.notes?.trim(), `[${stamp}] ${note}`]
              .filter(Boolean)
              .join('\n')
          : undefined;

        const updated = await this.logAttendance(
          id,
          { hoursAttended, status, ...(notes ? { notes } : {}) },
          officer,
        );

        await this.prisma.auditLog.create({
          data: {
            userId: officer.id,
            action: 'LOG_TRAINING_ATTENDANCE',
            entityType: 'TrainingEnrollment',
            entityId: id,
            oldValue: {
              hoursAttended: current.hoursAttended,
              status: current.status,
            },
            newValue: {
              hoursAttended: updated.hoursAttended,
              status: updated.status,
              via: 'BULK_LOG_ATTENDANCE',
              mode: dto.mode,
              hours: dto.mode === 'FULL' ? null : hours,
              notes: note || null,
            },
          },
        });

        results.push({
          enrollmentId: id,
          ...who,
          status: 'UPDATED',
          hoursAttended: updated.hoursAttended,
          courseStatus: updated.status,
        });
      } catch (err: any) {
        results.push({
          enrollmentId: id,
          ...who,
          status: 'FAILED',
          error: err?.message || 'Could not log attendance.',
          ...(err?.getResponse?.()?.code
            ? {
                errorCode: err.getResponse().code,
                errorParams: err.getResponse().params ?? {},
              }
            : {}),
        });
      }
    }

    const updatedCount = results.filter((r) => r.status === 'UPDATED').length;
    return {
      totalRequested: ids.length,
      updatedCount,
      failedCount: ids.length - updatedCount,
      results,
    };
  }

  async logAttendance(
    id: string,
    dto: LogAttendanceDto,
    officer: RequestUserContext,
  ) {
    const enrollment = await this.prisma.trainingEnrollment.findUnique({
      where: { id },
      include: {
        course: true,
        driverProfile: true,
      },
    });

    if (!enrollment) {
      throw new AppNotFoundException(
        'TRAINING_ENROLLMENT_NOT_FOUND',
        {},
        'Training enrollment record not found.',
      );
    }

    if (enrollment.driverProfile.userId === officer.id) {
      throw new AppForbiddenException(
        'TRAINING_SEPARATION_OF_DUTIES',
        {},
        'Separation of Duties: You cannot log or sign off your own training hours.',
      );
    }

    if (
      dto.status === CourseStatus.COMPLETED &&
      dto.hoursAttended < enrollment.course.durationHours
    ) {
      throw new AppBadRequestException(
        'TRAINING_COMPLETE_INSUFFICIENT_HOURS',
        {
          hours: dto.hoursAttended,
          required: enrollment.course.durationHours,
        },
        `Cannot mark course COMPLETED with ${dto.hoursAttended}h attended; minimum ${enrollment.course.durationHours}h required.`,
      );
    }

    if (dto.status === CourseStatus.FAILED && !dto.notes?.trim()) {
      throw new AppBadRequestException(
        'TRAINING_FAILED_NOTES_REQUIRED',
        {},
        'Instructor notes are required when marking a training enrollment as FAILED.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.trainingEnrollment.update({
        where: { id },
        data: {
          hoursAttended: dto.hoursAttended,
          status: dto.status,
          instructorId: officer.serviceNumber,
          completionDate:
            dto.status === CourseStatus.COMPLETED
              ? dto.completionDate
                ? new Date(dto.completionDate)
                : new Date()
              : null,
          certificateUrl: dto.certificateUrl?.trim() ?? enrollment.certificateUrl,
          notes: dto.notes?.trim() ?? enrollment.notes,
        },
        include: ENROLLMENT_INCLUDE,
      });

      if (
        dto.status === CourseStatus.COMPLETED &&
        enrollment.applicationId
      ) {
        const app = await tx.application.findUnique({
          where: { id: enrollment.applicationId },
          include: {
            requestedCategories: { include: { category: true } },
          },
        });

        if (app && app.status === ApplicationStatus.TRAINING_PENDING) {
          const completedEnrollments = await tx.trainingEnrollment.findMany({
            where: {
              applicationId: app.id,
              status: CourseStatus.COMPLETED,
            },
            select: { categoryCode: true },
          });
          const completedCodes = new Set(
            completedEnrollments.map((e) => e.categoryCode),
          );
          const requiredCodes = app.requestedCategories.map(
            (rc) => rc.category.code,
          );

          if (
            requiredCodes.length > 0 &&
            requiredCodes.every((code) => completedCodes.has(code))
          ) {
            await tx.application.update({
              where: { id: app.id },
              data: {
                status: ApplicationStatus.EXAM_PENDING,
                currentStage: 'Awaiting Theory & Practical Exams',
              },
            });
          }
        }
      }

      return updated;
    });
  }
}
