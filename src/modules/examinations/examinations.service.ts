import { Injectable } from '@nestjs/common';
import {
  ApplicationStatus,
  ExamOutcome,
  ExamType,
  PersonnelStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/paginated-result.dto';
import { Permission } from '../../common/enums/permissions.enum';
import { RequestUserContext } from '../personnel/services/drivers.service';
import { RecordExamResultDto } from './dto/record-exam-result.dto';
import { QueryExaminationsDto } from './dto/query-examinations.dto';
import { QueryExamCandidatesDto } from './dto/query-exam-candidates.dto';
import { AppBadRequestException, AppConflictException, AppForbiddenException, AppNotFoundException } from '../../common/errors';

/** Training enrollments with their batch, used to show which batch a candidate came from. */
const TRAINING_BATCH_SELECT = {
  select: {
    id: true,
    status: true,
    categoryCode: true,
    batchSession: {
      select: {
        id: true,
        startDate: true,
        endDate: true,
        batch: { select: { id: true, batchCode: true } },
      },
    },
  },
};

const INELIGIBLE_PERSONNEL: PersonnelStatus[] = [
  PersonnelStatus.SUSPENDED,
  PersonnelStatus.SEPARATED,
  PersonnelStatus.RETIRED,
];

const EXAM_INCLUDE = {
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
      trainingEnrollments: TRAINING_BATCH_SELECT,
    },
  },
  examiner: {
    select: {
      id: true,
      serviceNumber: true,
      fullName: true,
    },
  },
};

@Injectable()
export class ExaminationsService {
  constructor(private readonly prisma: PrismaService) {}

  getStatus() {
    return {
      module: 'examinations',
      description: 'Theoretical & Practical Assessments',
      status: 'READY',
    };
  }

  async getStats() {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [awaiting, total, passed, notPassed, lockedToday] = await Promise.all([
      this.prisma.application.count({
        where: { status: ApplicationStatus.EXAM_PENDING },
      }),
      this.prisma.examinationRecord.count(),
      this.prisma.examinationRecord.count({
        where: { outcome: ExamOutcome.PASS },
      }),
      this.prisma.examinationRecord.count({
        where: { outcome: { in: [ExamOutcome.FAIL, ExamOutcome.INCOMPLETE] } },
      }),
      this.prisma.examinationRecord.count({
        where: { examDate: { gte: startOfDay } },
      }),
    ]);

    return {
      awaitingCandidates: awaiting,
      totalRecords: total,
      passed,
      notPassed,
      lockedToday,
      passRate: total > 0 ? Math.round((passed / total) * 100) : null,
    };
  }

  async findPendingCandidates(query: QueryExamCandidatesDto) {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    const where: any = {
      status: ApplicationStatus.EXAM_PENDING,
    };

    if (query.categoryCode) {
      where.requestedCategories = {
        some: { category: { code: query.categoryCode.trim().toUpperCase() } },
      };
    }
    if (query.batchId) {
      where.trainingEnrollments = {
        some: { batchSession: { batchId: query.batchId } },
      };
    }

    if (query.search) {
      where.OR = [
        { applicationNumber: { contains: query.search, mode: 'insensitive' } },
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
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.application.findMany({
        where,
        include: {
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
          trainingEnrollments: TRAINING_BATCH_SELECT,
          requestedCategories: {
            include: {
              category: { select: { id: true, code: true, name: true } },
            },
          },
          examRecords: {
            orderBy: { examDate: 'desc' },
            include: {
              examiner: {
                select: { id: true, serviceNumber: true, fullName: true },
              },
            },
          },
        },
        skip,
        take: limit,
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.application.count({ where }),
    ]);

    return new PaginatedResult(items, total, page, limit);
  }

  async findAll(query: QueryExaminationsDto, user: RequestUserContext) {
    const perms = new Set(user.resolvedPermissions || []);
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    const canViewAllExams =
      perms.has(Permission.EXAMS_MANAGE_SCHEDULES) ||
      perms.has(Permission.EXAMS_GRADE_LOCKED) ||
      perms.has(Permission.APPLICATIONS_VIEW_ALL);

    const where: any = {
      examRecords: { some: {} },
    };

    if (!canViewAllExams) {
      where.driverProfile = { userId: user.id };
    }

    if (query.applicationId) {
      where.id = query.applicationId;
    }

    if (query.driverProfileId) {
      where.driverProfileId = query.driverProfileId;
    }

    if (query.batchId) {
      where.trainingEnrollments = {
        some: { batchSession: { batchId: query.batchId } },
      };
    }

    const examRecordConditions: any = {};
    if (query.examType) {
      examRecordConditions.examType = query.examType;
    }
    if (query.outcome) {
      examRecordConditions.outcome = query.outcome;
    }
    if (query.categoryCode) {
      examRecordConditions.categoryCode = query.categoryCode.trim().toUpperCase();
    }

    if (Object.keys(examRecordConditions).length > 0) {
      where.examRecords = {
        some: examRecordConditions,
      };
    }

    if (query.search) {
      where.AND = [
        {
          OR: [
            { applicationNumber: { contains: query.search, mode: 'insensitive' } },
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
              examRecords: {
                some: {
                  categoryCode: { contains: query.search, mode: 'insensitive' },
                },
              },
            },
          ],
        },
      ];
    }

    const [applications, total] = await Promise.all([
      this.prisma.application.findMany({
        where,
        include: {
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
          trainingEnrollments: TRAINING_BATCH_SELECT,
          requestedCategories: {
            include: {
              category: { select: { id: true, code: true, name: true } },
            },
          },
          examRecords: {
            orderBy: { examDate: 'desc' },
            include: {
              examiner: {
                select: { id: true, serviceNumber: true, fullName: true },
              },
            },
          },
        },
        skip,
        take: limit,
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.application.count({ where }),
    ]);

    const items = applications.flatMap((app) => {
      let categoryCodes =
        app.requestedCategories.length > 0
          ? app.requestedCategories.map((rc) => rc.category.code)
          : [...new Set(app.examRecords.map((r) => r.categoryCode))];

      if (query.categoryCode) {
        const filterCat = query.categoryCode.trim().toUpperCase();
        categoryCodes = categoryCodes.filter((c) => c === filterCat);
      }

      return categoryCodes.map((catCode) => {
        const recordsForCat = app.examRecords.filter(
          (r) => r.categoryCode === catCode,
        );
        const theoryRecord =
          recordsForCat.find(
            (r) =>
              r.examType === ExamType.THEORETICAL &&
              r.outcome === ExamOutcome.PASS,
          ) ||
          recordsForCat.find((r) => r.examType === ExamType.THEORETICAL) ||
          null;

        const practicalRecord =
          recordsForCat.find(
            (r) =>
              r.examType === ExamType.PRACTICAL &&
              r.outcome === ExamOutcome.PASS,
          ) ||
          recordsForCat.find((r) => r.examType === ExamType.PRACTICAL) ||
          null;

        let overallOutcome = 'PENDING';
        if (
          theoryRecord?.outcome === ExamOutcome.PASS &&
          practicalRecord?.outcome === ExamOutcome.PASS
        ) {
          overallOutcome = 'PASS';
        } else if (
          theoryRecord?.outcome === ExamOutcome.FAIL ||
          practicalRecord?.outcome === ExamOutcome.FAIL
        ) {
          overallOutcome = 'FAIL';
        } else if (theoryRecord || practicalRecord) {
          overallOutcome = 'IN_PROGRESS';
        }

        const latestExam = recordsForCat[0] || app.examRecords[0] || null;

        return {
          id: `${app.id}-${catCode}`,
          driverProfileId: app.driverProfileId,
          applicationId: app.id,
          categoryCode: catCode,
          driverProfile: app.driverProfile,
          application: {
            id: app.id,
            applicationNumber: app.applicationNumber,
            type: app.type,
            status: app.status,
            trainingEnrollments: app.trainingEnrollments,
          },
          theoryRecord,
          practicalRecord,
          allRecords: recordsForCat,
          overallOutcome,
          latestExamDate: latestExam ? latestExam.examDate : null,
          latestExaminer: latestExam ? latestExam.examiner : null,
        };
      });
    });

    return new PaginatedResult(items, total, page, limit);
  }

  async recordResult(dto: RecordExamResultDto, examiner: RequestUserContext) {
    const categoryCode = dto.categoryCode.trim().toUpperCase();

    const [driver, category] = await Promise.all([
      this.prisma.driverProfile.findUnique({
        where: { id: dto.driverProfileId },
      }),
      this.prisma.vehicleCategory.findUnique({
        where: { code: categoryCode },
      }),
    ]);

    if (!driver) {
      throw new AppNotFoundException(
      'EXAM_DRIVER_NOT_FOUND', {}, 'Driver profile not found.');
    }
    if (!category) {
      throw new AppNotFoundException(
      'EXAM_CATEGORY_NOT_FOUND', { categoryCode }, `Vehicle category ${categoryCode} not found.`);
    }
    if (INELIGIBLE_PERSONNEL.includes(driver.personnelStatus)) {
      throw new AppBadRequestException(
      'EXAM_DRIVER_INELIGIBLE_STATUS', { status: driver.personnelStatus }, 
        `Driver with status ${driver.personnelStatus} cannot take examinations.`,
      );
    }

    if (driver.userId === examiner.id) {
      throw new AppForbiddenException(
      'EXAM_SEPARATION_OF_DUTIES', {}, 
        'Separation of Duties: An examiner cannot grade their own examination.',
      );
    }

    if (
      dto.examType === ExamType.THEORETICAL &&
      dto.scorePercent === undefined
    ) {
      throw new AppBadRequestException(
      'EXAM_THEORY_SCORE_REQUIRED', {}, 
        'Score percentage (0–100) is required for theoretical examinations.',
      );
    }

    if (
      dto.outcome === ExamOutcome.PASS &&
      dto.scorePercent !== undefined &&
      dto.scorePercent < 75
    ) {
      throw new AppBadRequestException(
      'EXAM_PASS_BELOW_MINIMUM', {}, 
        'Minimum passing score is 75%. Cannot record PASS below 75%.',
      );
    }

    if (
      (dto.outcome === ExamOutcome.FAIL ||
        dto.outcome === ExamOutcome.INCOMPLETE) &&
      !dto.notes?.trim()
    ) {
      throw new AppBadRequestException(
      'EXAM_NOTES_REQUIRED', {}, 
        'Examiner notes are required when recording FAIL or INCOMPLETE.',
      );
    }

    if (dto.applicationId) {
      const app = await this.prisma.application.findUnique({
        where: { id: dto.applicationId },
        include: { requestedCategories: { include: { category: true } } },
      });

      if (!app) {
        throw new AppNotFoundException(
      'EXAM_APPLICATION_NOT_FOUND', {}, 'Linked application not found.');
      }
      if (app.driverProfileId !== dto.driverProfileId) {
        throw new AppBadRequestException(
      'EXAM_APPLICATION_DRIVER_MISMATCH', {}, 
          'Linked application does not belong to the selected driver.',
        );
      }
      if (app.status !== ApplicationStatus.EXAM_PENDING) {
        throw new AppBadRequestException(
      'EXAM_APPLICATION_NOT_EXAM_PENDING', { status: app.status }, 
          `Application must be in EXAM_PENDING status for assessment grading (current: ${app.status}).`,
        );
      }

      const appCatCodes = app.requestedCategories.map((rc) => rc.category.code);
      if (!appCatCodes.includes(categoryCode)) {
        throw new AppBadRequestException(
      'EXAM_CATEGORY_NOT_REQUESTED', { categoryCode, applicationNumber: app.applicationNumber }, 
          `Category ${categoryCode} is not requested by application ${app.applicationNumber}.`,
        );
      }
    }

    if (dto.outcome === ExamOutcome.PASS) {
      const existingPass = await this.prisma.examinationRecord.findFirst({
        where: {
          driverProfileId: dto.driverProfileId,
          applicationId: dto.applicationId ?? null,
          categoryCode,
          examType: dto.examType,
          outcome: ExamOutcome.PASS,
        },
      });
      if (existingPass) {
        throw new AppConflictException(
      'EXAM_PASS_ALREADY_LOCKED', { categoryCode, examType: dto.examType }, 
          `Candidate already holds a locked PASS record for ${categoryCode} (${dto.examType}).`,
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const record = await tx.examinationRecord.create({
        data: {
          driverProfileId: dto.driverProfileId,
          applicationId: dto.applicationId ?? null,
          examType: dto.examType,
          categoryCode,
          scorePercent: dto.scorePercent ?? null,
          outcome: dto.outcome,
          examinerUserId: examiner.id,
          isLocked: true,
          examDate: dto.examDate ? new Date(dto.examDate) : new Date(),
          evidenceUrl: dto.evidenceUrl?.trim() || null,
          notes: dto.notes?.trim() || null,
        },
        include: EXAM_INCLUDE,
      });

      if (dto.outcome === ExamOutcome.PASS && dto.applicationId) {
        const app = await tx.application.findUnique({
          where: { id: dto.applicationId },
          include: {
            requestedCategories: { include: { category: true } },
          },
        });

        if (app && app.status === ApplicationStatus.EXAM_PENDING) {
          const passedRecords = await tx.examinationRecord.findMany({
            where: {
              applicationId: app.id,
              outcome: ExamOutcome.PASS,
            },
            select: { categoryCode: true, examType: true },
          });

          const passedTheory = new Set(
            passedRecords
              .filter((r) => r.examType === ExamType.THEORETICAL)
              .map((r) => r.categoryCode),
          );
          const passedPractical = new Set(
            passedRecords
              .filter((r) => r.examType === ExamType.PRACTICAL)
              .map((r) => r.categoryCode),
          );

          const requiredCats = app.requestedCategories.map((rc) => rc.category);
          const allPassed =
            requiredCats.length > 0 &&
            requiredCats.every(
              (c) => passedTheory.has(c.code) && passedPractical.has(c.code),
            );

          if (allPassed) {
            // Medical clearance now happens before training, so the exam
            // is the last gate before command approval.
            await tx.application.update({
              where: { id: app.id },
              data: {
                status: ApplicationStatus.READY_FOR_APPROVAL,
                currentStage: 'Ready for Command Approval',
              },
            });
          }
        }
      }

      return record;
    });
  }
}
