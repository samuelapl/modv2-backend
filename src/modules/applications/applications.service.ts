import { Injectable, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  AppBadRequestException,
  AppForbiddenException,
  AppNotFoundException,
} from '../../common/errors';
import {
  ApplicationStatus,
  ApplicationType,
  ApprovalAction,
  CredentialStatus,
  PersonnelStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/paginated-result.dto';
import { Permission } from '../../common/enums/permissions.enum';
import { RequestUserContext } from '../personnel/services/drivers.service';
import { CreateApplicationDto } from './dto/create-application.dto';
import { SubmitApplicationDto } from './dto/submit-application.dto';
import { QueryApplicationsDto } from './dto/query-applications.dto';
import { ScreenApplicationDto } from './dto/screen-application.dto';
import { ApproveApplicationDto } from './dto/approve-application.dto';
import {
  BulkDecideApplicationsDto,
  CreatePreTrainedApplicationDto,
} from './dto/prior-permit.dto';
import {
  DIRECT_APPROVAL_TYPES,
  OPEN_APPLICATION_STATUSES,
  formatStageLabel,
  getPostScreeningStages,
  resolveNextStage,
} from './helpers/application-state.helper';
import { validateApplicationPrerequisites } from './helpers/application-validator.helper';
import {
  assertRenewalAllowed,
  evaluateRenewal,
  findRenewablePermit,
  RENEWAL_WINDOW_MONTHS_AFTER,
  RENEWAL_WINDOW_MONTHS_BEFORE,
} from './helpers/renewal.helper';
import {
  evaluateReplacement,
  resolveReplacementPermit,
} from './helpers/replacement.helper';
import {
  categoriesForMedical,
  evaluateAdditionalCategory,
  resolveAdditionalCategoryPermit,
} from './helpers/additional-category.helper';
import {
  createPreTrainedApplicationInTx,
  generateApplicationNumber,
  isApplicationNumberCollision,
  loadPriorPermitLookup,
  resolvePriorPermit,
} from './helpers/prior-permit.helper';

const INELIGIBLE_PERSONNEL: PersonnelStatus[] = [
  PersonnelStatus.SUSPENDED,
  PersonnelStatus.SEPARATED,
  PersonnelStatus.RETIRED,
];

const APPLICATION_INCLUDE = {
  driverProfile: {
    select: {
      id: true,
      userId: true,
      serviceNumber: true,
      fullName: true,
      rank: true,
      gender: true,
      nationalIdNumber: true,
      dateOfBirth: true,
      bloodGroup: true,
      photoUrl: true,
      contactPhone: true,
      emergencyContactName: true,
      emergencyContactPhone: true,
      personnelStatus: true,
      identityVerifiedAt: true,
      identityVerifiedBy: true,
      unitId: true,
      unit: { select: { id: true, code: true, name: true } },
      nationalLicense: {
        select: {
          id: true,
          licenseNumber: true,
          issuingAuthority: true,
          categories: true,
          issuedDate: true,
          expiryDate: true,
          documentEvidenceUrl: true,
          verificationStatus: true,
          verifiedAt: true,
        },
      },
    },
  },
  requestedCategories: {
    include: {
      category: {
        select: {
          id: true,
          code: true,
          name: true,
          minAgeRequired: true,
          requiresNationalLicense: true,
          requiresMedical: true,
          validityYears: true,
        },
      },
    },
  },
  approvals: {
    orderBy: { decisionDate: 'desc' as const },
    include: {
      officer: {
        select: {
          id: true,
          serviceNumber: true,
          roles: true,
        },
      },
    },
  },
  medicalReviews: {
    orderBy: { assessmentDate: 'desc' as const },
    take: 1,
    select: {
      id: true,
      outcome: true,
      operationalRestrictions: true,
      assessmentDate: true,
      reviewDueDate: true,
    },
  },
  priorPermit: true,
  replacesCredential: {
    select: {
      id: true,
      credentialNumber: true,
      status: true,
      issueDate: true,
      expiryDate: true,
      categories: {
        select: {
          category: {
            select: { id: true, code: true, name: true, requiresMedical: true },
          },
        },
      },
    },
  },
  // Lets the stepper tell "awaiting enrollment" apart from "in training".
  trainingEnrollments: {
    select: { id: true, status: true },
  },
};

@Injectable()
export class ApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly eventEmitter?: EventEmitter2,
  ) {}

  getStatus() {
    return {
      module: 'applications',
      description: 'Authorization Applications State Machine (Workflows 1, 2, 3, 5)',
      status: 'READY',
    };
  }

  async findAll(query: QueryApplicationsDto, user: RequestUserContext) {
    const perms = new Set(user.resolvedPermissions || []);
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (perms.has(Permission.APPLICATIONS_VIEW_ALL)) {
      if (query.unitId) {
        where.driverProfile = { unitId: query.unitId };
      }
    } else if (perms.has(Permission.DRIVERS_VIEW_UNIT) && user.unitId) {
      where.OR = [
        { driverProfile: { unitId: user.unitId } },
        { createdById: user.id },
      ];
    } else {
      where.OR = [
        { driverProfile: { userId: user.id } },
        { createdById: user.id },
      ];
    }

    if (query.status) where.status = query.status;
    if (query.type) where.type = query.type;
    if (query.driverProfileId) where.driverProfileId = query.driverProfileId;

    if (query.search) {
      where.AND = [
        ...(where.AND || []),
        {
          OR: [
            {
              applicationNumber: {
                contains: query.search,
                mode: 'insensitive',
              },
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
          ],
        },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.application.findMany({
        where,
        include: APPLICATION_INCLUDE,
        skip,
        take: limit,
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.application.count({ where }),
    ]);

    return new PaginatedResult(items, total, page, limit);
  }

  async findOne(id: string, user: RequestUserContext) {
    const app = await this.prisma.application.findUnique({
      where: { id },
      include: APPLICATION_INCLUDE,
    });

    if (!app) {
      throw new AppNotFoundException(
        'APPLICATION_NOT_FOUND',
        {},
        'Application record not found.',
      );
    }

    const perms = new Set(user.resolvedPermissions || []);
    const canRead =
      perms.has(Permission.APPLICATIONS_VIEW_ALL) ||
      perms.has(Permission.APPLICATIONS_SCREEN) ||
      perms.has(Permission.APPLICATIONS_APPROVE) ||
      (perms.has(Permission.DRIVERS_VIEW_UNIT) &&
        app.driverProfile.unitId === user.unitId) ||
      app.driverProfile.userId === user.id ||
      app.createdById === user.id;

    if (!canRead) {
      throw new AppForbiddenException(
        'APPLICATION_ACCESS_DENIED',
        {},
        'Access denied to this application.',
      );
    }

    return app;
  }

  async create(dto: CreateApplicationDto, user: RequestUserContext) {
    const driver = await this.prisma.driverProfile.findUnique({
      where: { id: dto.driverProfileId },
      select: { id: true, userId: true, unitId: true },
    });

    if (!driver) {
      throw new AppNotFoundException(
        'APPLICATION_DRIVER_PROFILE_NOT_FOUND',
        {},
        'Driver profile not found.',
      );
    }

    this.assertSubmitScope(driver, user);

    if (dto.type === ApplicationType.PRE_TRAINED) {
      throw new AppBadRequestException(
        'PRE_TRAINED_NEEDS_PERMIT_DETAILS',
        {},
        'Pre-trained applications need existing permit details. Use driver registration or "Record Existing Permit".',
      );
    }

    const submitNow = dto.submitImmediately !== false;
    const isReplacement = dto.type === ApplicationType.REPLACEMENT;

    // A replacement card is a copy of the current permit: its categories are
    // taken from that permit, never chosen by the applicant.
    const replacement = isReplacement
      ? await resolveReplacementPermit(this.prisma, dto.driverProfileId)
      : null;
    if (isReplacement && !dto.replacementReason) {
      throw new AppBadRequestException(
        'REPLACEMENT_REASON_REQUIRED',
        {},
        'Select why the card is being replaced (LOST, STOLEN or DAMAGED).',
      );
    }
    const uniqueCategoryIds = replacement
      ? replacement.categoryIds
      : Array.from(new Set(dto.categoryIds ?? []));

    // An upgrade adds new categories to the driver's current, valid permit.
    const upgrade =
      dto.type === ApplicationType.ADDITIONAL_CATEGORY
        ? await resolveAdditionalCategoryPermit(
            this.prisma,
            dto.driverProfileId,
            uniqueCategoryIds,
          )
        : null;

    // Renewal needs an existing permit covering these categories; the date
    // window is only enforced once the application is actually submitted.
    if (dto.type === ApplicationType.RENEWAL) {
      await assertRenewalAllowed(this.prisma, {
        driverProfileId: dto.driverProfileId,
        categoryIds: uniqueCategoryIds,
        checkWindow: submitNow,
      });
    }

    if (submitNow) {
      await validateApplicationPrerequisites(this.prisma, {
        driverProfileId: dto.driverProfileId,
        categoryIds: uniqueCategoryIds,
        // A replacement re-issues categories already held; no new qualification.
        preTrained: isReplacement,
      });
    } else {
      const catCount = await this.prisma.vehicleCategory.count({
        where: { id: { in: uniqueCategoryIds }, isActive: true },
      });
      if (catCount !== uniqueCategoryIds.length) {
        throw new AppBadRequestException(
          'APPLICATION_CATEGORIES_INVALID_OR_INACTIVE',
          {},
          'One or more selected vehicle categories do not exist or are inactive.',
        );
      }
    }

    const initialStatus = submitNow
      ? ApplicationStatus.SUBMITTED
      : ApplicationStatus.DRAFT;

    const noteSuffix = dto.notes?.trim() ? ` — ${dto.notes.trim()}` : '';

    for (let attempt = 0; attempt < 5; attempt++) {
      const applicationNumber = await generateApplicationNumber(this.prisma, attempt);
      try {
        const created = await this.prisma.application.create({
          data: {
            applicationNumber,
            driverProfileId: dto.driverProfileId,
            type: dto.type,
            status: initialStatus,
            currentStage: `${formatStageLabel(initialStatus)}${noteSuffix}`,
            createdById: user.id,
            ...(replacement
              ? {
                  replacementReason: dto.replacementReason,
                  replacesCredentialId: replacement.permit.id,
                }
              : {}),
            ...(upgrade ? { replacesCredentialId: upgrade.permit.id } : {}),
            requestedCategories: {
              create: uniqueCategoryIds.map((categoryId) => ({ categoryId })),
            },
          },
          include: APPLICATION_INCLUDE,
        });

        if (initialStatus === ApplicationStatus.SUBMITTED) {
          this.eventEmitter?.emit('application.submitted', {
            applicationId: created.id,
            applicationNumber: created.applicationNumber,
            driverUserId: driver.userId,
          });
        }

        return created;
      } catch (err: any) {
        if (err?.code === 'P2002' && attempt < 4) {
          continue;
        }
        throw err;
      }
    }
  }

  /**
   * Records an existing permit for a driver who is already registered and
   * opens a PRE_TRAINED application directly at READY_FOR_APPROVAL.
   */
  async createPreTrained(
    dto: CreatePreTrainedApplicationDto,
    user: RequestUserContext,
  ) {
    const driver = await this.prisma.driverProfile.findUnique({
      where: { id: dto.driverProfileId },
      select: {
        id: true,
        userId: true,
        unitId: true,
        dateOfBirth: true,
        personnelStatus: true,
      },
    });

    if (!driver) {
      throw new AppNotFoundException(
        'APPLICATION_DRIVER_PROFILE_NOT_FOUND',
        {},
        'Driver profile not found.',
      );
    }

    this.assertSubmitScope(driver, user);

    if (driver.userId === user.id) {
      throw new AppForbiddenException(
        'SOD_CANNOT_RECORD_OWN_PERMIT',
        {},
        'Separation of Duties: You cannot record an existing permit for yourself.',
      );
    }

    if (INELIGIBLE_PERSONNEL.includes(driver.personnelStatus)) {
      throw new AppBadRequestException(
        'DRIVER_STATUS_CANNOT_BE_AUTHORIZED',
        { status: driver.personnelStatus },
        `Driver with status ${driver.personnelStatus} cannot be granted an authorization.`,
      );
    }

    const activeCredential = await this.prisma.issuedCredential.findFirst({
      where: {
        driverProfileId: driver.id,
        status: { in: [CredentialStatus.ACTIVE, CredentialStatus.SUSPENDED] },
        expiryDate: { gt: new Date() },
      },
      select: { credentialNumber: true },
    });
    if (activeCredential) {
      throw new AppBadRequestException(
        'DRIVER_ALREADY_HOLDS_CREDENTIAL',
        { credential: activeCredential.credentialNumber },
        `Driver already holds MoD credential ${activeCredential.credentialNumber}. Use the additional-category or renewal workflow instead.`,
      );
    }

    const lookup = await loadPriorPermitLookup(this.prisma, [dto.priorPermit]);
    const prior = resolvePriorPermit(
      dto.priorPermit,
      new Date(driver.dateOfBirth),
      lookup,
    );

    const openApplication = await this.prisma.application.findFirst({
      where: {
        driverProfileId: driver.id,
        status: { in: OPEN_APPLICATION_STATUSES },
        requestedCategories: { some: { categoryId: { in: prior.categoryIds } } },
      },
      select: { applicationNumber: true },
    });
    if (openApplication) {
      throw new AppBadRequestException(
        'OPEN_APPLICATION_COVERS_CATEGORIES',
        { application: openApplication.applicationNumber },
        `An open application (${openApplication.applicationNumber}) already covers one or more of these categories for this driver.`,
      );
    }

    for (let attempt = 0; ; attempt++) {
      try {
        const created = await this.prisma.$transaction(async (tx) =>
          createPreTrainedApplicationInTx(tx, {
            driverProfileId: driver.id,
            createdById: user.id,
            prior,
            applicationNumber: await generateApplicationNumber(tx, attempt),
          }),
        );
        return this.prisma.application.findUnique({
          where: { id: created.id },
          include: APPLICATION_INCLUDE,
        });
      } catch (err) {
        if (attempt < 4 && isApplicationNumberCollision(err)) continue;
        throw err;
      }
    }
  }

  async submit(id: string, dto: SubmitApplicationDto, user: RequestUserContext) {
    const existing = await this.prisma.application.findUnique({
      where: { id },
      include: {
        driverProfile: {
          select: { id: true, userId: true, unitId: true, dateOfBirth: true },
        },
        requestedCategories: { include: { category: { select: { code: true } } } },
        priorPermit: true,
      },
    });

    if (!existing) {
      throw new AppNotFoundException(
        'APPLICATION_NOT_FOUND',
        {},
        'Application record not found.',
      );
    }

    this.assertSubmitScope(existing.driverProfile, user);

    const submittable: ApplicationStatus[] = [
      ApplicationStatus.DRAFT,
      ApplicationStatus.RETURNED_FOR_CORRECTION,
    ];
    if (!submittable.includes(existing.status)) {
      throw new AppBadRequestException(
        'APPLICATION_NOT_SUBMITTABLE',
        { status: existing.status },
        `Only DRAFT or RETURNED_FOR_CORRECTION applications can be submitted (current: ${existing.status}).`,
      );
    }

    const isPreTrained = existing.type === ApplicationType.PRE_TRAINED;
    const isResubmission =
      existing.status === ApplicationStatus.RETURNED_FOR_CORRECTION;
    const notes = dto.notes?.trim() || '';

    if (dto.priorPermit && !isPreTrained) {
      throw new AppBadRequestException(
        'PRIOR_PERMIT_ONLY_FOR_PRE_TRAINED',
        {},
        'Existing permit details only apply to already-trained (pre-trained) applications.',
      );
    }
    if (isPreTrained && dto.categoryIds?.length) {
      throw new AppBadRequestException(
        'PRE_TRAINED_CORRECT_CATEGORIES_IN_PERMIT',
        {},
        'For an already-trained application, correct the categories in the existing permit details.',
      );
    }
    if (isResubmission && !notes) {
      throw new AppBadRequestException(
        'RESUBMIT_CORRECTION_NOTES_REQUIRED',
        {},
        'Describe what was corrected before resubmitting a returned application.',
      );
    }

    // Corrected permit details go through the same checks as registration;
    // this application's own permit number is not treated as a duplicate.
    const correctedPermit = dto.priorPermit
      ? resolvePriorPermit(
          dto.priorPermit,
          existing.driverProfile.dateOfBirth,
          await loadPriorPermitLookup(this.prisma, [dto.priorPermit], existing.id),
        )
      : null;

    // Replacement: re-check the permit (it may have expired or been suspended
    // since the draft) and re-copy its categories.
    const isReplacement = existing.type === ApplicationType.REPLACEMENT;
    const replacement = isReplacement
      ? await resolveReplacementPermit(this.prisma, existing.driverProfileId)
      : null;
    const replacementReason =
      dto.replacementReason ?? existing.replacementReason ?? undefined;
    if (isReplacement && !replacementReason) {
      throw new AppBadRequestException(
        'REPLACEMENT_REASON_REQUIRED',
        {},
        'Select why the card is being replaced (LOST, STOLEN or DAMAGED).',
      );
    }

    const previousCategoryIds = existing.requestedCategories.map((c) => c.categoryId);
    const nextCategoryIds = replacement
      ? replacement.categoryIds
      : correctedPermit
        ? correctedPermit.categoryIds
        : dto.categoryIds?.length
          ? Array.from(new Set(dto.categoryIds))
          : previousCategoryIds;
    const categoriesChanged =
      nextCategoryIds.length !== previousCategoryIds.length ||
      nextCategoryIds.some((cid) => !previousCategoryIds.includes(cid));

    // Upgrade: the permit must still be valid and the categories still new.
    const upgrade =
      existing.type === ApplicationType.ADDITIONAL_CATEGORY
        ? await resolveAdditionalCategoryPermit(
            this.prisma,
            existing.driverProfileId,
            nextCategoryIds,
          )
        : null;

    if (existing.type === ApplicationType.RENEWAL) {
      await assertRenewalAllowed(this.prisma, {
        driverProfileId: existing.driverProfileId,
        categoryIds: nextCategoryIds,
        checkWindow: true,
      });
    }

    await validateApplicationPrerequisites(this.prisma, {
      driverProfileId: existing.driverProfileId,
      categoryIds: nextCategoryIds,
      excludeApplicationId: existing.id,
      preTrained: isPreTrained || isReplacement,
    });

    const noteSuffix = notes ? ` — ${notes}` : '';
    const prior = existing.priorPermit;
    const snapshotPermit = (pp: {
      permitNumber: string;
      issueDate: Date;
      expiryDate: Date;
      trainingReference: string | null;
      documentUrl: string | null;
    }) => ({
      permitNumber: pp.permitNumber,
      issueDate: pp.issueDate.toISOString().slice(0, 10),
      expiryDate: pp.expiryDate.toISOString().slice(0, 10),
      trainingReference: pp.trainingReference,
      documentUrl: pp.documentUrl,
    });

    const result = await this.prisma.$transaction(async (tx) => {
      if (categoriesChanged) {
        await tx.applicationItem.deleteMany({ where: { applicationId: id } });
        await tx.applicationItem.createMany({
          data: nextCategoryIds.map((categoryId) => ({
            applicationId: id,
            categoryId,
          })),
        });
      }

      if (correctedPermit) {
        const permitData = {
          permitNumber: correctedPermit.permitNumber,
          issueDate: correctedPermit.issueDate,
          expiryDate: correctedPermit.expiryDate,
          trainingReference: correctedPermit.trainingReference,
          documentUrl: correctedPermit.documentUrl,
        };
        await tx.priorPermit.upsert({
          where: { applicationId: id },
          update: permitData,
          create: { applicationId: id, ...permitData },
        });
      }

      if (isResubmission) {
        await tx.auditLog.create({
          data: {
            userId: user.id,
            action: 'RESUBMIT_APPLICATION',
            entityType: 'Application',
            entityId: id,
            oldValue: {
              returnReason: existing.rejectionReason,
              categories: existing.requestedCategories.map((c) => c.category.code),
              ...(correctedPermit && prior ? { priorPermit: snapshotPermit(prior) } : {}),
            },
            newValue: {
              correctionNotes: notes,
              categoriesChanged,
              ...(correctedPermit
                ? {
                    categories: correctedPermit.categoryCodes,
                    priorPermit: snapshotPermit(correctedPermit),
                  }
                : {}),
            },
          },
        });
      }

      return tx.application.update({
        where: { id },
        data: {
          status: ApplicationStatus.SUBMITTED,
          rejectionReason: null,
          currentStage: `${formatStageLabel(ApplicationStatus.SUBMITTED)}${noteSuffix}`,
          ...(replacement
            ? {
                replacementReason,
                replacesCredentialId: replacement.permit.id,
              }
            : {}),
          ...(upgrade ? { replacesCredentialId: upgrade.permit.id } : {}),
        },
        include: APPLICATION_INCLUDE,
      });
    });

    this.eventEmitter?.emit('application.submitted', {
      applicationId: result.id,
      applicationNumber: result.applicationNumber,
      driverUserId: existing.driverProfile.userId,
    });

    return result;
  }

  async screen(id: string, dto: ScreenApplicationDto, officer: RequestUserContext) {
    const app = await this.prisma.application.findUnique({
      where: { id },
      include: {
        driverProfile: true,
        requestedCategories: { include: { category: true } },
        replacesCredential: {
          select: { categories: { select: { category: true } } },
        },
      },
    });

    if (!app) {
      throw new AppNotFoundException(
        'APPLICATION_NOT_FOUND',
        {},
        'Application record not found.',
      );
    }

    const screenableStatuses: ApplicationStatus[] = [
      ApplicationStatus.SUBMITTED,
      ApplicationStatus.SCREENING,
      ApplicationStatus.TRAINING_PENDING,
      ApplicationStatus.EXAM_PENDING,
      ApplicationStatus.MEDICAL_PENDING,
    ];

    if (!screenableStatuses.includes(app.status)) {
      throw new AppBadRequestException(
        'APPLICATION_NOT_SCREENABLE',
        { status: app.status },
        `Application in status ${app.status} cannot be screened.`,
      );
    }

    if (
      (dto.action === 'RETURN' || dto.action === 'REJECT') &&
      !dto.comments?.trim()
    ) {
      throw new AppBadRequestException(
        'SCREENING_COMMENTS_REQUIRED',
        {},
        'Comments are required when returning or rejecting an application.',
      );
    }

    if (dto.action === 'START_SCREENING') {
      return this.prisma.application.update({
        where: { id },
        data: {
          status: ApplicationStatus.SCREENING,
          currentStage: formatStageLabel(ApplicationStatus.SCREENING),
        },
        include: APPLICATION_INCLUDE,
      });
    }

    let nextStatus: ApplicationStatus;
    let approvalAction: ApprovalAction;

    if (dto.action === 'REJECT') {
      nextStatus = ApplicationStatus.REJECTED;
      approvalAction = ApprovalAction.REJECTED;
    } else if (dto.action === 'RETURN') {
      nextStatus = ApplicationStatus.RETURNED_FOR_CORRECTION;
      approvalAction = ApprovalAction.RETURNED;
    } else {
      // For an upgrade the categories already on the permit also decide
      // whether a medical is needed (the whole card's validity is reset).
      const categories = categoriesForMedical(
        app.requestedCategories.map((rc) => rc.category),
        app.type === ApplicationType.ADDITIONAL_CATEGORY
          ? (app.replacesCredential?.categories.map((c) => c.category) ?? [])
          : [],
      );

      if (dto.targetStage) {
        if (
          dto.targetStage === ApplicationStatus.READY_FOR_APPROVAL &&
          !DIRECT_APPROVAL_TYPES.includes(app.type)
        ) {
          throw new AppBadRequestException(
            'SCREENING_CANNOT_SKIP_TO_APPROVAL',
            { type: app.type },
            `${app.type} applications cannot skip directly to command approval; training, exam and medical stages must be completed first.`,
          );
        }

        const pipeline = [
          ApplicationStatus.SUBMITTED,
          ApplicationStatus.SCREENING,
          ...getPostScreeningStages(app.type, categories),
        ];
        const currentIdx = pipeline.indexOf(app.status);
        const targetIdx = pipeline.indexOf(dto.targetStage);
        if (targetIdx === -1 || targetIdx <= currentIdx) {
          throw new AppBadRequestException(
            'SCREENING_INVALID_STAGE_TRANSITION',
            { type: app.type, status: app.status, targetStage: dto.targetStage },
            `Cannot move a ${app.type} application from ${app.status} to ${dto.targetStage}.`,
          );
        }
        nextStatus = dto.targetStage;
      } else {
        const next = resolveNextStage(app.type, app.status, categories);
        if (!next) {
          throw new AppBadRequestException(
            'SCREENING_NO_NEXT_STAGE',
            { status: app.status, type: app.type },
            `No further screening stage after ${app.status} for ${app.type} applications.`,
          );
        }
        nextStatus = next;
      }
      approvalAction = ApprovalAction.RECOMMENDED;
    }

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.applicationApproval.create({
        data: {
          applicationId: id,
          officerUserId: officer.id,
          action: approvalAction,
          comments: dto.comments?.trim() || null,
        },
      });

      return tx.application.update({
        where: { id },
        data: {
          status: nextStatus,
          currentStage: formatStageLabel(nextStatus),
          rejectionReason:
            nextStatus === ApplicationStatus.REJECTED ||
            nextStatus === ApplicationStatus.RETURNED_FOR_CORRECTION
              ? dto.comments?.trim() || null
              : null,
        },
        include: APPLICATION_INCLUDE,
      });
    });

    if (
      nextStatus === ApplicationStatus.REJECTED ||
      nextStatus === ApplicationStatus.RETURNED_FOR_CORRECTION
    ) {
      this.eventEmitter?.emit('application.status_changed', {
        applicationId: result.id,
        applicationNumber: result.applicationNumber,
        driverUserId: app.driverProfile.userId,
        newStatus: nextStatus,
        comments: dto.comments?.trim(),
      });
    }

    return result;
  }

  async decide(
    id: string,
    dto: ApproveApplicationDto,
    approver: RequestUserContext,
  ) {
    const app = await this.prisma.application.findUnique({
      where: { id },
      include: { driverProfile: true },
    });

    if (!app) {
      throw new AppNotFoundException(
        'APPLICATION_NOT_FOUND',
        {},
        'Application record not found.',
      );
    }

    if (app.createdById === approver.id) {
      throw new AppForbiddenException(
        'MAKER_CHECKER_CANNOT_DECIDE_OWN_APPLICATION',
        {},
        'Maker-Checker Violation: You cannot decide an application that you created.',
      );
    }

    if (app.driverProfile.userId === approver.id) {
      throw new AppForbiddenException(
        'SOD_CANNOT_DECIDE_OWN_DRIVING_APPLICATION',
        {},
        'Separation of Duties: You cannot approve or reject your own driving application.',
      );
    }

    if (app.status !== ApplicationStatus.READY_FOR_APPROVAL) {
      throw new AppBadRequestException(
        'APPLICATION_NOT_READY_FOR_DECISION',
        { status: app.status },
        `Application must be in READY_FOR_APPROVAL status before final command decision (current: ${app.status}).`,
      );
    }

    if (
      (dto.action === ApprovalAction.REJECTED ||
        dto.action === ApprovalAction.RETURNED) &&
      !dto.comments?.trim()
    ) {
      throw new AppBadRequestException(
        'DECISION_COMMENTS_REQUIRED',
        {},
        'Comments are required when rejecting or returning an application.',
      );
    }

    const nextStatus =
      dto.action === ApprovalAction.APPROVED
        ? ApplicationStatus.APPROVED
        : dto.action === ApprovalAction.RETURNED
          ? ApplicationStatus.RETURNED_FOR_CORRECTION
          : ApplicationStatus.REJECTED;

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.applicationApproval.create({
        data: {
          applicationId: id,
          officerUserId: approver.id,
          action: dto.action,
          comments: dto.comments?.trim() || null,
        },
      });

      return tx.application.update({
        where: { id },
        data: {
          status: nextStatus,
          currentStage: formatStageLabel(nextStatus),
          rejectionReason:
            nextStatus === ApplicationStatus.REJECTED ||
            nextStatus === ApplicationStatus.RETURNED_FOR_CORRECTION
              ? dto.comments?.trim() || null
              : null,
        },
        include: APPLICATION_INCLUDE,
      });
    });

    this.eventEmitter?.emit('application.status_changed', {
      applicationId: result.id,
      applicationNumber: result.applicationNumber,
      driverUserId: app.driverProfile.userId,
      newStatus: nextStatus,
      comments: dto.comments?.trim(),
    });

    return result;
  }

  /**
   * Approves many READY_FOR_APPROVAL applications in one action. Each one
   * goes through the same maker-checker rules as a single decision; rows
   * that fail are reported and skipped. Bulk is approve-only, because
   * returning or rejecting needs case-specific comments.
   */
  async bulkApprove(dto: BulkDecideApplicationsDto, approver: RequestUserContext) {
    const ids = Array.from(new Set(dto.applicationIds));
    const results: Array<{
      applicationId: string;
      applicationNumber?: string;
      status: 'APPROVED' | 'FAILED';
      error?: string;
    }> = [];

    for (const id of ids) {
      try {
        const app = await this.decide(
          id,
          { action: ApprovalAction.APPROVED, comments: dto.comments },
          approver,
        );
        await this.prisma.auditLog.create({
          data: {
            userId: approver.id,
            action: 'DECIDE_APPLICATION',
            entityType: 'Application',
            entityId: id,
            newValue: {
              status: app.status,
              action: ApprovalAction.APPROVED,
              via: 'BULK_APPROVE',
              comments: dto.comments?.trim() || null,
            },
          },
        });
        results.push({
          applicationId: id,
          applicationNumber: app.applicationNumber,
          status: 'APPROVED',
        });
      } catch (err: any) {
        results.push({
          applicationId: id,
          status: 'FAILED',
          error: err?.message || 'Approval failed.',
        });
      }
    }

    const approvedCount = results.filter((r) => r.status === 'APPROVED').length;
    return {
      totalRequested: ids.length,
      approvedCount,
      failedCount: ids.length - approvedCount,
      results,
    };
  }

  /** The driver's current permit and whether categories can be added to it. */
  async getAdditionalCategoryEligibility(
    driverProfileId: string,
    user: RequestUserContext,
  ) {
    const driver = await this.prisma.driverProfile.findUnique({
      where: { id: driverProfileId },
      select: { id: true, userId: true, unitId: true },
    });
    if (!driver) {
      throw new AppNotFoundException(
        'APPLICATION_DRIVER_PROFILE_NOT_FOUND',
        {},
        'Driver profile not found.',
      );
    }
    this.assertSubmitScope(driver, user);

    const permit = await findRenewablePermit(this.prisma, driver.id);
    const verdict = evaluateAdditionalCategory(permit);
    return {
      eligible: verdict.eligible,
      message: verdict.message,
      permit: permit
        ? {
            id: permit.id,
            credentialNumber: permit.credentialNumber,
            status: permit.status,
            issueDate: permit.issueDate,
            expiryDate: permit.expiryDate,
            categories: permit.categories.map((c) => c.category),
          }
        : null,
    };
  }

  /** The driver's current permit and whether its card can be replaced. */
  async getReplacementEligibility(
    driverProfileId: string,
    user: RequestUserContext,
  ) {
    const driver = await this.prisma.driverProfile.findUnique({
      where: { id: driverProfileId },
      select: { id: true, userId: true, unitId: true },
    });
    if (!driver) {
      throw new AppNotFoundException(
        'APPLICATION_DRIVER_PROFILE_NOT_FOUND',
        {},
        'Driver profile not found.',
      );
    }
    this.assertSubmitScope(driver, user);

    const permit = await findRenewablePermit(this.prisma, driver.id);
    const verdict = evaluateReplacement(permit);
    return {
      eligible: verdict.eligible,
      message: verdict.message,
      permit: permit
        ? {
            id: permit.id,
            credentialNumber: permit.credentialNumber,
            status: permit.status,
            issueDate: permit.issueDate,
            expiryDate: permit.expiryDate,
            categories: permit.categories.map((c) => c.category),
          }
        : null,
    };
  }

  /** The driver's current permit and where it stands in the renewal window. */
  async getRenewalEligibility(
    driverProfileId: string,
    user: RequestUserContext,
  ) {
    const driver = await this.prisma.driverProfile.findUnique({
      where: { id: driverProfileId },
      select: { id: true, userId: true, unitId: true },
    });
    if (!driver) {
      throw new AppNotFoundException(
        'APPLICATION_DRIVER_PROFILE_NOT_FOUND',
        {},
        'Driver profile not found.',
      );
    }
    this.assertSubmitScope(driver, user);

    const permit = await findRenewablePermit(this.prisma, driver.id);
    const verdict = evaluateRenewal(permit);
    return {
      state: verdict.state,
      message: verdict.message,
      windowOpensAt: verdict.opensAt ?? null,
      windowClosesAt: verdict.closesAt ?? null,
      monthsBefore: RENEWAL_WINDOW_MONTHS_BEFORE,
      monthsAfter: RENEWAL_WINDOW_MONTHS_AFTER,
      permit: permit
        ? {
            id: permit.id,
            credentialNumber: permit.credentialNumber,
            status: permit.status,
            issueDate: permit.issueDate,
            expiryDate: permit.expiryDate,
            categories: permit.categories.map((c) => c.category),
          }
        : null,
    };
  }

  private assertSubmitScope(
    driver: { userId: string; unitId: string },
    user: RequestUserContext,
  ) {
    const perms = new Set(user.resolvedPermissions || []);
    const allowed =
      perms.has(Permission.APPLICATIONS_VIEW_ALL) ||
      perms.has(Permission.APPLICATIONS_SCREEN) ||
      (perms.has(Permission.DRIVERS_VIEW_UNIT) &&
        driver.unitId === user.unitId) ||
      driver.userId === user.id;

    if (!allowed) {
      throw new AppForbiddenException(
        'APPLICATION_DRIVER_OUTSIDE_SCOPE',
        {},
        'Cannot submit an application for a driver outside your scope.',
      );
    }
  }
}
