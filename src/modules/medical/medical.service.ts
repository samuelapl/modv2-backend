import { Injectable } from '@nestjs/common';
import {
  ApplicationStatus,
  MedicalFitnessOutcome,
  PersonnelStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/paginated-result.dto';
import { Permission } from '../../common/enums/permissions.enum';
import { RequestUserContext } from '../personnel/services/drivers.service';
import { RecordMedicalReviewDto } from './dto/record-medical-review.dto';
import { QueryMedicalDto } from './dto/query-medical.dto';
import { QueryMedicalCandidatesDto } from './dto/query-medical-candidates.dto';
import { AppBadRequestException, AppForbiddenException, AppNotFoundException } from '../../common/errors';

const DAY_MS = 24 * 60 * 60 * 1000;
const DUE_SOON_DAYS = 90;

const TRAINING_BATCH_SELECT = {
  select: {
    id: true,
    categoryCode: true,
    batchSession: {
      select: { id: true, batch: { select: { id: true, batchCode: true } } },
    },
  },
};

const INELIGIBLE_PERSONNEL: PersonnelStatus[] = [
  PersonnelStatus.SUSPENDED,
  PersonnelStatus.SEPARATED,
  PersonnelStatus.RETIRED,
];

const SANITIZED_MEDICAL_SELECT = {
  id: true,
  driverProfileId: true,
  applicationId: true,
  outcome: true,
  operationalRestrictions: true,
  assessmentDate: true,
  reviewDueDate: true,
  createdAt: true,
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
      requestedCategories: {
        select: { category: { select: { code: true, name: true } } },
      },
      trainingEnrollments: TRAINING_BATCH_SELECT,
    },
  },
};

const FULL_MEDICAL_SELECT = {
  ...SANITIZED_MEDICAL_SELECT,
  medicalFacility: true,
  reviewerBadgeNumber: true,
  documentProofUrl: true,
};

@Injectable()
export class MedicalService {
  constructor(private readonly prisma: PrismaService) {}

  getStatus() {
    return {
      module: 'medical',
      description: 'Privacy-Guarded Medical Fitness Review',
      status: 'READY',
    };
  }

  async getStats() {
    const now = new Date();
    const soon = new Date(now.getTime() + DUE_SOON_DAYS * DAY_MS);
    const cleared = [
      MedicalFitnessOutcome.FIT,
      MedicalFitnessOutcome.FIT_WITH_RESTRICTIONS,
    ];

    const [awaiting, reevaluations, clearedCount, unfit, dueSoon] =
      await Promise.all([
        this.prisma.application.count({
          where: { status: ApplicationStatus.MEDICAL_PENDING },
        }),
        this.prisma.application.count({
          where: {
            status: ApplicationStatus.MEDICAL_PENDING,
            medicalReviews: { some: {} },
          },
        }),
        this.prisma.medicalFitnessReview.count({
          where: { outcome: { in: cleared } },
        }),
        this.prisma.medicalFitnessReview.count({
          where: { outcome: MedicalFitnessOutcome.UNFIT },
        }),
        this.prisma.medicalFitnessReview.count({
          where: {
            outcome: { in: cleared },
            reviewDueDate: { gte: now, lte: soon },
          },
        }),
      ]);

    return {
      awaitingCandidates: awaiting,
      reevaluations,
      cleared: clearedCount,
      unfit,
      reviewsDueSoon: dueSoon,
    };
  }

  async findPendingCandidates(query: QueryMedicalCandidatesDto) {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    const where: any = {
      status: ApplicationStatus.MEDICAL_PENDING,
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
    if (query.reviewState === 'FIRST') where.medicalReviews = { none: {} };
    if (query.reviewState === 'REEVALUATION') {
      where.medicalReviews = { some: {} };
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
              dateOfBirth: true,
              gender: true,
              bloodGroup: true,
              unit: { select: { id: true, code: true, name: true } },
            },
          },
          trainingEnrollments: TRAINING_BATCH_SELECT,
          requestedCategories: {
            include: {
              category: {
                select: {
                  id: true,
                  code: true,
                  name: true,
                  validityYears: true,
                },
              },
            },
          },
          medicalReviews: {
            orderBy: { assessmentDate: 'desc' },
            take: 3,
            select: {
              id: true,
              outcome: true,
              operationalRestrictions: true,
              assessmentDate: true,
              reviewDueDate: true,
              medicalFacility: true,
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

  async findAll(query: QueryMedicalDto, user: RequestUserContext) {
    const perms = new Set(user.resolvedPermissions || []);
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    const hasFullMedicalAccess = perms.has(Permission.MEDICAL_RECORD_FIT);
    const hasOutcomeAccess = perms.has(Permission.MEDICAL_VIEW_OUTCOME);

    const where: any = {};

    if (!hasFullMedicalAccess) {
      if (!hasOutcomeAccess) {
        where.driverProfile = { userId: user.id };
      } else if (
        !perms.has(Permission.DRIVERS_VIEW_ALL) &&
        !perms.has(Permission.APPLICATIONS_VIEW_ALL)
      ) {
        if (perms.has(Permission.DRIVERS_VIEW_UNIT) && user.unitId) {
          where.driverProfile = { unitId: user.unitId };
        } else {
          where.driverProfile = { userId: user.id };
        }
      }
    }

    if (query.outcome) where.outcome = query.outcome;
    if (query.restriction) {
      where.operationalRestrictions = { has: query.restriction };
    }
    if (query.dueStatus) {
      const now = new Date();
      const soon = new Date(now.getTime() + DUE_SOON_DAYS * DAY_MS);
      where.reviewDueDate =
        query.dueStatus === 'OVERDUE'
          ? { lt: now }
          : query.dueStatus === 'DUE_SOON'
            ? { gte: now, lte: soon }
            : { gt: soon };
    }
    const appFilters: any[] = [];
    if (query.categoryCode) {
      appFilters.push({
        requestedCategories: {
          some: {
            category: { code: query.categoryCode.trim().toUpperCase() },
          },
        },
      });
    }
    if (query.batchId) {
      appFilters.push({
        trainingEnrollments: {
          some: { batchSession: { batchId: query.batchId } },
        },
      });
    }
    if (appFilters.length) where.application = { AND: appFilters };
    if (query.driverProfileId) where.driverProfileId = query.driverProfileId;
    if (query.applicationId) where.applicationId = query.applicationId;

    if (query.search) {
      where.OR = [
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

    const select = hasFullMedicalAccess
      ? FULL_MEDICAL_SELECT
      : SANITIZED_MEDICAL_SELECT;

    const [items, total] = await Promise.all([
      this.prisma.medicalFitnessReview.findMany({
        where,
        select,
        skip,
        take: limit,
        orderBy: { assessmentDate: 'desc' },
      }),
      this.prisma.medicalFitnessReview.count({ where }),
    ]);

    return new PaginatedResult(items, total, page, limit);
  }

  async recordReview(
    dto: RecordMedicalReviewDto,
    reviewer: RequestUserContext,
  ) {
    const driver = await this.prisma.driverProfile.findUnique({
      where: { id: dto.driverProfileId },
    });

    if (!driver) {
      throw new AppNotFoundException(
      'MEDICAL_DRIVER_NOT_FOUND', {}, 'Driver profile not found.');
    }

    if (INELIGIBLE_PERSONNEL.includes(driver.personnelStatus)) {
      throw new AppBadRequestException(
      'MEDICAL_DRIVER_INELIGIBLE_STATUS', { status: driver.personnelStatus }, 
        `Driver with status ${driver.personnelStatus} cannot undergo medical clearance.`,
      );
    }

    if (driver.userId === reviewer.id) {
      throw new AppForbiddenException(
      'MEDICAL_SEPARATION_OF_DUTIES', {}, 
        'Separation of Duties: A medical reviewer cannot certify their own fitness review.',
      );
    }

    const assessmentDate = new Date(dto.assessmentDate);
    const reviewDueDate = new Date(dto.reviewDueDate);

    if (
      Number.isNaN(assessmentDate.getTime()) ||
      Number.isNaN(reviewDueDate.getTime()) ||
      reviewDueDate <= assessmentDate
    ) {
      throw new AppBadRequestException(
      'MEDICAL_REVIEW_DATE_ORDER', {}, 
        'Review due date must be strictly after assessment date.',
      );
    }

    const isClearing =
      dto.outcome === MedicalFitnessOutcome.FIT ||
      dto.outcome === MedicalFitnessOutcome.FIT_WITH_RESTRICTIONS;

    if (isClearing && reviewDueDate <= new Date()) {
      throw new AppBadRequestException(
      'MEDICAL_REVIEW_DATE_NOT_FUTURE', {}, 
        'Medical review due date must be in the future for fitness clearance.',
      );
    }

    const restrictions = Array.from(new Set(dto.operationalRestrictions || []));

    if (
      dto.outcome === MedicalFitnessOutcome.FIT_WITH_RESTRICTIONS &&
      restrictions.length === 0
    ) {
      throw new AppBadRequestException(
      'MEDICAL_RESTRICTION_REQUIRED', {}, 
        'At least one operational restriction must be selected for FIT_WITH_RESTRICTIONS.',
      );
    }

    if (dto.outcome === MedicalFitnessOutcome.FIT && restrictions.length > 0) {
      throw new AppBadRequestException(
      'MEDICAL_RESTRICTION_NOT_ALLOWED', {}, 
        'Operational restrictions cannot be attached when outcome is unqualified FIT.',
      );
    }

    if (dto.applicationId) {
      const app = await this.prisma.application.findUnique({
        where: { id: dto.applicationId },
      });
      if (!app) {
        throw new AppNotFoundException(
      'MEDICAL_APPLICATION_NOT_FOUND', {}, 'Linked application not found.');
      }
      if (app.driverProfileId !== dto.driverProfileId) {
        throw new AppBadRequestException(
      'MEDICAL_APPLICATION_DRIVER_MISMATCH', {}, 
          'Linked application does not belong to the selected driver.',
        );
      }
      if (app.status !== ApplicationStatus.MEDICAL_PENDING) {
        throw new AppBadRequestException(
      'MEDICAL_APPLICATION_NOT_MEDICAL_PENDING', { status: app.status }, 
          `Application must be in MEDICAL_PENDING status for medical clearance (current: ${app.status}).`,
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const review = await tx.medicalFitnessReview.create({
        data: {
          driverProfileId: dto.driverProfileId,
          applicationId: dto.applicationId ?? null,
          medicalFacility: dto.medicalFacility.trim(),
          reviewerBadgeNumber: dto.reviewerBadgeNumber.trim().toUpperCase(),
          outcome: dto.outcome,
          operationalRestrictions: restrictions,
          assessmentDate,
          reviewDueDate,
          documentProofUrl: dto.documentProofUrl?.trim() || null,
        },
        select: FULL_MEDICAL_SELECT,
      });

      if (dto.applicationId) {
        if (isClearing) {
          await tx.application.update({
            where: { id: dto.applicationId },
            data: {
              status: ApplicationStatus.READY_FOR_APPROVAL,
              currentStage: 'Ready for Command Approval',
              rejectionReason: null,
            },
          });
        } else if (dto.outcome === MedicalFitnessOutcome.TEMPORARILY_UNFIT) {
          await tx.application.update({
            where: { id: dto.applicationId },
            data: {
              currentStage: 'Deferred — Temporarily Unfit Pending Re-evaluation',
            },
          });
        } else if (dto.outcome === MedicalFitnessOutcome.UNFIT) {
          await tx.application.update({
            where: { id: dto.applicationId },
            data: {
              status: ApplicationStatus.REJECTED,
              currentStage: 'Application Rejected',
              rejectionReason:
                'Medical Fitness Outcome: UNFIT (does not meet operational fitness standards).',
            },
          });
        }
      }

      return review;
    });
  }
}
