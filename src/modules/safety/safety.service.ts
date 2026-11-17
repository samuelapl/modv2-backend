import { Injectable, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  AppBadRequestException,
  AppConflictException,
  AppForbiddenException,
  AppNotFoundException,
} from '../../common/errors';
import {
  CredentialStatus,
  InvestigationStatus,
  PersonnelStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/paginated-result.dto';
import { Permission } from '../../common/enums/permissions.enum';
import { RequestUserContext } from '../personnel/services/drivers.service';
import { CreateIncidentDto } from './dto/create-incident.dto';
import { InvestigateIncidentDto } from './dto/investigate-incident.dto';
import { CreateSuspensionDto } from './dto/create-suspension.dto';
import { QuerySafetyDto } from './dto/query-safety.dto';
import { RevokePermitDto } from './dto/revoke-permit.dto';

const DAY_MS = 24 * 60 * 60 * 1000;

const OPEN_INVESTIGATION: InvestigationStatus[] = [
  InvestigationStatus.UNDER_INVESTIGATION,
  InvestigationStatus.SUBSTANTIATED,
];

/** Incidents whose corrective action still blocks reinstatement. */
const PENDING_REMEDIAL_WHERE = {
  correctiveAction: { not: null },
  remedialCompleted: false,
  status: { in: OPEN_INVESTIGATION },
};

const INCIDENT_INCLUDE = {
  driverProfile: {
    select: {
      id: true,
      userId: true,
      serviceNumber: true,
      fullName: true,
      photoUrl: true,
      personnelStatus: true,
      unitId: true,
      unit: { select: { id: true, code: true, name: true } },
      suspensions: {
        where: { isActive: true },
        take: 1,
        select: { id: true, startDate: true },
      },
    },
  },
};

const SUSPENSION_INCLUDE = {
  driverProfile: {
    select: {
      id: true,
      userId: true,
      serviceNumber: true,
      fullName: true,
      photoUrl: true,
      personnelStatus: true,
      unitId: true,
      unit: { select: { id: true, code: true, name: true } },
      incidents: {
        where: PENDING_REMEDIAL_WHERE,
        select: {
          id: true,
          reportNumber: true,
          correctiveAction: true,
          status: true,
        },
      },
    },
  },
  credential: {
    select: {
      id: true,
      credentialNumber: true,
      status: true,
      expiryDate: true,
      revokedAt: true,
      revocationLegalBasis: true,
      revocationReason: true,
    },
  },
  authorizedBy: {
    select: {
      id: true,
      serviceNumber: true,
      fullName: true,
    },
  },
  closedBy: {
    select: {
      id: true,
      serviceNumber: true,
      fullName: true,
    },
  },
};

@Injectable()
export class SafetyService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly eventEmitter?: EventEmitter2,
  ) {}

  getStatus() {
    return {
      module: 'safety',
      description: 'Incidents, Remedial Tasks & Suspensions (Workflow 4)',
      status: 'READY',
    };
  }

  private buildScopeWhere(user: RequestUserContext) {
    const perms = new Set(user.resolvedPermissions || []);
    const hasAll =
      perms.has(Permission.SAFETY_INVESTIGATE) ||
      perms.has(Permission.SAFETY_SUSPEND) ||
      perms.has(Permission.SAFETY_REINSTATE) ||
      perms.has(Permission.DRIVERS_VIEW_ALL);

    if (hasAll) return {};
    if (perms.has(Permission.DRIVERS_VIEW_UNIT) && user.unitId) {
      return { driverProfile: { unitId: user.unitId } };
    }
    return { driverProfile: { userId: user.id } };
  }

  async getStats(user: RequestUserContext) {
    const scope = this.buildScopeWhere(user);
    const now = new Date();

    const [
      open,
      severeOpen,
      remedialPending,
      activeSuspensions,
      reviewOverdue,
    ] = await Promise.all([
      this.prisma.incidentReport.count({
        where: { ...scope, status: InvestigationStatus.UNDER_INVESTIGATION },
      }),
      this.prisma.incidentReport.count({
        where: {
          ...scope,
          severity: { in: ['SEVERE', 'CRITICAL'] },
          status: { in: OPEN_INVESTIGATION },
        },
      }),
      this.prisma.incidentReport.count({
        where: { ...scope, ...PENDING_REMEDIAL_WHERE },
      }),
      this.prisma.suspensionRecord.count({
        where: { ...scope, isActive: true },
      }),
      this.prisma.suspensionRecord.count({
        where: { ...scope, isActive: true, reviewDate: { lt: now } },
      }),
    ]);

    return {
      openInvestigations: open,
      severeOpen,
      remedialPending,
      activeSuspensions,
      reviewOverdue,
    };
  }

  async findIncidents(query: QuerySafetyDto, user: RequestUserContext) {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    const where: any = {
      ...this.buildScopeWhere(user),
    };

    if (query.severity) where.severity = query.severity;
    if (query.investigationStatus) where.status = query.investigationStatus;
    if (query.driverProfileId) where.driverProfileId = query.driverProfileId;
    if (query.remedial === 'PENDING') {
      where.correctiveAction = { not: null };
      where.remedialCompleted = false;
    } else if (query.remedial === 'COMPLETED') {
      where.correctiveAction = { not: null };
      where.remedialCompleted = true;
    } else if (query.remedial === 'NONE') {
      where.correctiveAction = null;
    }
    if (query.period) {
      const days = parseInt(query.period, 10);
      where.incidentDate = { gte: new Date(Date.now() - days * DAY_MS) };
    }

    if (query.search) {
      where.OR = [
        { reportNumber: { contains: query.search, mode: 'insensitive' } },
        { location: { contains: query.search, mode: 'insensitive' } },
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
      this.prisma.incidentReport.findMany({
        where,
        include: INCIDENT_INCLUDE,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.incidentReport.count({ where }),
    ]);

    return new PaginatedResult(items, total, page, limit);
  }

  async reportIncident(dto: CreateIncidentDto, user: RequestUserContext) {
    const driver = await this.prisma.driverProfile.findUnique({
      where: { id: dto.driverProfileId },
      select: { id: true, userId: true, unitId: true, serviceNumber: true },
    });

    if (!driver) {
      throw new AppNotFoundException(
        'DRIVER_NOT_FOUND',
        {},
        'Driver profile not found.',
      );
    }

    const perms = new Set(user.resolvedPermissions || []);
    const canReportAll =
      perms.has(Permission.DRIVERS_VIEW_ALL) ||
      perms.has(Permission.SAFETY_INVESTIGATE);
    const canReportUnit =
      perms.has(Permission.DRIVERS_VIEW_UNIT) && driver.unitId === user.unitId;

    if (!canReportAll && !canReportUnit && driver.userId !== user.id) {
      throw new AppForbiddenException(
        'INCIDENT_DRIVER_OUTSIDE_UNIT_SCOPE',
        {},
        'Cannot report a safety incident for a driver outside your unit scope.',
      );
    }

    const incidentDate = new Date(dto.incidentDate);
    if (Number.isNaN(incidentDate.getTime()) || incidentDate > new Date()) {
      throw new AppBadRequestException(
        'INCIDENT_DATE_IN_FUTURE',
        {},
        'Incident date cannot be in the future.',
      );
    }

    const year = incidentDate.getFullYear();

    for (let attempt = 0; attempt < 5; attempt++) {
      const reportNumber = await this.generateReportNumber(year, attempt);
      try {
        return await this.prisma.$transaction(async (tx) => {
          const created = await tx.incidentReport.create({
            data: {
              reportNumber,
              driverProfileId: dto.driverProfileId,
              incidentDate,
              location: dto.location?.trim() || null,
              severity: dto.severity,
              status: InvestigationStatus.UNDER_INVESTIGATION,
              description: dto.description.trim(),
              correctiveAction: dto.correctiveAction?.trim() || null,
              remedialCompleted: false,
            },
            include: INCIDENT_INCLUDE,
          });

          await tx.auditLog.create({
            data: {
              userId: user.id,
              action: 'REPORT_INCIDENT',
              entityType: 'IncidentReport',
              entityId: created.id,
              newValue: {
                reportNumber,
                driverServiceNumber: driver.serviceNumber,
                severity: dto.severity,
              },
            },
          });

          return created;
        });
      } catch (err: any) {
        if (err?.code === 'P2002' && attempt < 4) {
          continue;
        }
        throw err;
      }
    }
  }

  async investigateIncident(
    id: string,
    dto: InvestigateIncidentDto,
    officer: RequestUserContext,
  ) {
    const existing = await this.prisma.incidentReport.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new AppNotFoundException(
        'INCIDENT_NOT_FOUND',
        {},
        'Incident report not found.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.incidentReport.update({
        where: { id },
        data: {
          ...(dto.status !== undefined ? { status: dto.status } : {}),
          ...(dto.severity !== undefined ? { severity: dto.severity } : {}),
          ...(dto.correctiveAction !== undefined
            ? { correctiveAction: dto.correctiveAction.trim() || null }
            : {}),
          ...(dto.remedialCompleted !== undefined
            ? { remedialCompleted: dto.remedialCompleted }
            : {}),
        },
        include: INCIDENT_INCLUDE,
      });

      await tx.auditLog.create({
        data: {
          userId: officer.id,
          action: 'UPDATE_INCIDENT_INVESTIGATION',
          entityType: 'IncidentReport',
          entityId: id,
          oldValue: {
            status: existing.status,
            correctiveAction: existing.correctiveAction,
            remedialCompleted: existing.remedialCompleted,
          },
          newValue: {
            status: updated.status,
            correctiveAction: updated.correctiveAction,
            remedialCompleted: updated.remedialCompleted,
          },
        },
      });

      return updated;
    });
  }

  async findSuspensions(query: QuerySafetyDto, user: RequestUserContext) {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    const where: any = {
      ...this.buildScopeWhere(user),
    };

    if (query.isActive === 'true') where.isActive = true;
    if (query.isActive === 'false') where.isActive = false;
    if (query.state === 'ACTIVE') where.isActive = true;
    if (query.state === 'REINSTATED') {
      where.isActive = false;
      where.revokedAt = null;
    }
    if (query.state === 'REVOKED') where.revokedAt = { not: null };
    if (query.driverProfileId) where.driverProfileId = query.driverProfileId;
    if (query.review) {
      const now = new Date();
      where.reviewDate =
        query.review === 'OVERDUE'
          ? { lt: now }
          : query.review === 'UPCOMING'
            ? { gte: now, lte: new Date(now.getTime() + 30 * DAY_MS) }
            : null;
    }

    if (query.search) {
      where.OR = [
        { legalBasis: { contains: query.search, mode: 'insensitive' } },
        { reason: { contains: query.search, mode: 'insensitive' } },
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
      this.prisma.suspensionRecord.findMany({
        where,
        include: SUSPENSION_INCLUDE,
        skip,
        take: limit,
        orderBy: [{ isActive: 'desc' }, { startDate: 'desc' }],
      }),
      this.prisma.suspensionRecord.count({ where }),
    ]);

    return new PaginatedResult(items, total, page, limit);
  }

  async imposeSuspension(
    dto: CreateSuspensionDto,
    officer: RequestUserContext,
  ) {
    const driver = await this.prisma.driverProfile.findUnique({
      where: { id: dto.driverProfileId },
      include: {
        issuedCredentials: {
          where: { status: CredentialStatus.ACTIVE },
          orderBy: { issueDate: 'desc' },
          take: 1,
        },
      },
    });

    if (!driver) {
      throw new AppNotFoundException(
        'DRIVER_NOT_FOUND',
        {},
        'Driver profile not found.',
      );
    }

    if (driver.userId === officer.id) {
      throw new AppForbiddenException(
        'SUSPENSION_SELF_IMPOSE',
        {},
        'Separation of Duties: An officer cannot impose a suspension on themselves.',
      );
    }

    const existingActive = await this.prisma.suspensionRecord.findFirst({
      where: { driverProfileId: driver.id, isActive: true },
    });
    if (existingActive) {
      throw new AppConflictException(
        'SUSPENSION_ALREADY_ACTIVE',
        {},
        'Driver already has an active disciplinary suspension record.',
      );
    }

    const targetCredentialId =
      dto.credentialId || driver.issuedCredentials[0]?.id || null;

    const startDate = dto.startDate ? new Date(dto.startDate) : new Date();
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);
    if (Number.isNaN(startDate.getTime()) || startDate > endOfToday) {
      throw new AppBadRequestException(
        'SUSPENSION_START_IN_FUTURE',
        {},
        'Suspension effective date cannot be in the future.',
      );
    }
    const reviewDate = dto.reviewDate ? new Date(dto.reviewDate) : null;
    if (reviewDate && reviewDate <= startDate) {
      throw new AppBadRequestException(
        'SUSPENSION_REVIEW_BEFORE_START',
        {},
        'Review date must be after the suspension effective date.',
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const suspension = await tx.suspensionRecord.create({
        data: {
          driverProfileId: driver.id,
          credentialId: targetCredentialId,
          legalBasis: dto.legalBasis.trim(),
          reason: dto.reason.trim(),
          startDate,
          reviewDate,
          authorizedById: officer.id,
          isActive: true,
        },
        include: SUSPENSION_INCLUDE,
      });

      await tx.driverProfile.update({
        where: { id: driver.id },
        data: { personnelStatus: PersonnelStatus.SUSPENDED },
      });

      await tx.issuedCredential.updateMany({
        where: {
          driverProfileId: driver.id,
          status: CredentialStatus.ACTIVE,
        },
        data: { status: CredentialStatus.SUSPENDED },
      });

      await tx.auditLog.create({
        data: {
          userId: officer.id,
          action: 'IMPOSE_SUSPENSION',
          entityType: 'SuspensionRecord',
          entityId: suspension.id,
          oldValue: { personnelStatus: driver.personnelStatus },
          newValue: {
            driverServiceNumber: driver.serviceNumber,
            personnelStatus: PersonnelStatus.SUSPENDED,
            credentialId: targetCredentialId,
            legalBasis: dto.legalBasis.trim(),
            reason: dto.reason.trim(),
          },
        },
      });

      return suspension;
    });

    const durationDays = reviewDate
      ? Math.max(1, Math.round((reviewDate.getTime() - startDate.getTime()) / DAY_MS))
      : undefined;

    this.eventEmitter?.emit('safety.suspended', {
      driverUserId: driver.userId,
      permitNumber: driver.serviceNumber,
      reason: dto.reason.trim(),
      durationDays,
    });

    return result;
  }

  async reinstateDriver(suspensionId: string, officer: RequestUserContext) {
    const suspension = await this.prisma.suspensionRecord.findUnique({
      where: { id: suspensionId },
      include: { driverProfile: true },
    });

    if (!suspension) {
      throw new AppNotFoundException(
        'SUSPENSION_NOT_FOUND',
        {},
        'Suspension record not found.',
      );
    }

    if (!suspension.isActive) {
      throw new AppBadRequestException(
        'SUSPENSION_ALREADY_INACTIVE',
        {},
        'Suspension record is already inactive / reinstated.',
      );
    }

    if (suspension.driverProfile.userId === officer.id) {
      throw new AppForbiddenException(
        'SUSPENSION_SELF_REINSTATE',
        {},
        'Separation of Duties: You cannot reinstate your own driving credential.',
      );
    }

    const pendingRemedial = await this.prisma.incidentReport.findFirst({
      where: {
        driverProfileId: suspension.driverProfileId,
        correctiveAction: { not: null },
        remedialCompleted: false,
        status: {
          in: [
            InvestigationStatus.UNDER_INVESTIGATION,
            InvestigationStatus.SUBSTANTIATED,
          ],
        },
      },
      select: { reportNumber: true, correctiveAction: true },
    });

    if (pendingRemedial && pendingRemedial.correctiveAction?.trim()) {
      throw new AppBadRequestException(
        'REINSTATE_REMEDIAL_INCOMPLETE',
        {
          reportNumber: pendingRemedial.reportNumber,
          correctiveAction: pendingRemedial.correctiveAction,
        },
        `Cannot reinstate driver while remedial action for ${pendingRemedial.reportNumber} (${pendingRemedial.correctiveAction}) remains incomplete.`,
      );
    }

    const now = new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.suspensionRecord.update({
        where: { id: suspensionId },
        data: {
          isActive: false,
          reinstatedAt: now,
          closedById: officer.id,
        },
        include: SUSPENSION_INCLUDE,
      });

      await tx.driverProfile.update({
        where: { id: suspension.driverProfileId },
        data: { personnelStatus: PersonnelStatus.ACTIVE },
      });

      // Restore non-expired suspended credentials; mark elapsed ones EXPIRED
      await tx.issuedCredential.updateMany({
        where: {
          driverProfileId: suspension.driverProfileId,
          status: CredentialStatus.SUSPENDED,
          expiryDate: { gt: now },
        },
        data: { status: CredentialStatus.ACTIVE },
      });

      await tx.issuedCredential.updateMany({
        where: {
          driverProfileId: suspension.driverProfileId,
          status: CredentialStatus.SUSPENDED,
          expiryDate: { lte: now },
        },
        data: { status: CredentialStatus.EXPIRED },
      });

      await tx.auditLog.create({
        data: {
          userId: officer.id,
          action: 'REINSTATE_DRIVER',
          entityType: 'SuspensionRecord',
          entityId: suspensionId,
          oldValue: {
            isActive: true,
            personnelStatus: PersonnelStatus.SUSPENDED,
          },
          newValue: {
            isActive: false,
            personnelStatus: PersonnelStatus.ACTIVE,
            reinstatedAt: now.toISOString(),
          },
        },
      });

      return updated;
    });

    this.eventEmitter?.emit('safety.reinstated', {
      driverUserId: suspension.driverProfile.userId,
      permitNumber: suspension.driverProfile.serviceNumber,
    });

    return result;
  }

  /* ------------------------------------------------------------------ */
  /* Permit revocation (permanent)                                        */
  /* ------------------------------------------------------------------ */

  /** What a revocation would affect for this driver. */
  async previewRevocation(driverProfileId: string) {
    const driver = await this.prisma.driverProfile.findUnique({
      where: { id: driverProfileId },
      select: {
        id: true,
        serviceNumber: true,
        fullName: true,
        personnelStatus: true,
        unit: { select: { code: true, name: true } },
        issuedCredentials: {
          where: {
            status: {
              in: [CredentialStatus.ACTIVE, CredentialStatus.SUSPENDED],
            },
          },
          orderBy: { issueDate: 'desc' },
          select: {
            id: true,
            credentialNumber: true,
            status: true,
            issueDate: true,
            expiryDate: true,
            categories: { select: { category: { select: { code: true } } } },
          },
        },
        suspensions: {
          where: { isActive: true },
          take: 1,
          select: { id: true, startDate: true, legalBasis: true, reason: true },
        },
      },
    });
    if (!driver) {
      throw new AppNotFoundException(
        'DRIVER_NOT_FOUND',
        {},
        'Driver profile not found.',
      );
    }
    const { issuedCredentials, suspensions, ...rest } = driver;
    return {
      driver: rest,
      permits: issuedCredentials,
      activeSuspension: suspensions[0] ?? null,
    };
  }

  /**
   * Permanently revoke every ACTIVE/SUSPENDED permit the driver holds.
   * If the driver has an active suspension it is closed as revoked.
   * Cannot be undone — the driver needs a new application to drive again.
   */
  async revokePermit(dto: RevokePermitDto, officer: RequestUserContext) {
    const driver = await this.prisma.driverProfile.findUnique({
      where: { id: dto.driverProfileId },
      select: {
        id: true,
        userId: true,
        serviceNumber: true,
        personnelStatus: true,
      },
    });
    if (!driver) {
      throw new AppNotFoundException(
        'DRIVER_NOT_FOUND',
        {},
        'Driver profile not found.',
      );
    }
    if (driver.userId === officer.id) {
      throw new AppForbiddenException(
        'PERMIT_SELF_REVOKE',
        {},
        'Separation of Duties: You cannot revoke your own driving permit.',
      );
    }

    const legalBasis = dto.legalBasis.trim();
    const reason = dto.reason.trim();
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const targets = await tx.issuedCredential.findMany({
        where: {
          driverProfileId: driver.id,
          status: { in: [CredentialStatus.ACTIVE, CredentialStatus.SUSPENDED] },
        },
        select: { id: true, credentialNumber: true, status: true },
      });
      if (targets.length === 0) {
        throw new AppBadRequestException(
          'NO_PERMIT_TO_REVOKE',
          {},
          'This driver holds no active or suspended permit to revoke.',
        );
      }

      await tx.issuedCredential.updateMany({
        where: { id: { in: targets.map((t) => t.id) } },
        data: {
          status: CredentialStatus.REVOKED,
          revokedAt: now,
          revokedById: officer.id,
          revocationLegalBasis: legalBasis,
          revocationReason: reason,
        },
      });

      const activeSuspension = await tx.suspensionRecord.findFirst({
        where: { driverProfileId: driver.id, isActive: true },
        select: { id: true },
      });
      if (activeSuspension) {
        await tx.suspensionRecord.update({
          where: { id: activeSuspension.id },
          data: { isActive: false, revokedAt: now, closedById: officer.id },
        });
        // Disciplinary case closed: the person stays in service without a permit.
        await tx.driverProfile.update({
          where: { id: driver.id },
          data: { personnelStatus: PersonnelStatus.ACTIVE },
        });
      }

      await tx.auditLog.create({
        data: {
          userId: officer.id,
          action: 'REVOKE_CREDENTIAL',
          entityType: 'IssuedCredential',
          entityId: targets[0].id,
          oldValue: {
            credentials: targets.map((t) => ({
              credentialNumber: t.credentialNumber,
              status: t.status,
            })),
            activeSuspensionId: activeSuspension?.id ?? null,
          },
          newValue: {
            driverServiceNumber: driver.serviceNumber,
            credentialStatus: CredentialStatus.REVOKED,
            revokedAt: now.toISOString(),
            legalBasis,
            reason,
          },
        },
      });

      return {
        driverProfileId: driver.id,
        driverServiceNumber: driver.serviceNumber,
        revokedCredentials: targets.map((t) => t.credentialNumber),
        closedSuspensionId: activeSuspension?.id ?? null,
      };
    });
  }

  /** Revoked permits, newest first, scoped like the other safety lists. */
  async findRevocations(query: QuerySafetyDto, user: RequestUserContext) {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    const where: any = {
      ...this.buildScopeWhere(user),
      status: CredentialStatus.REVOKED,
    };
    if (query.period) {
      const days = parseInt(query.period, 10);
      where.revokedAt = { gte: new Date(Date.now() - days * DAY_MS) };
    }
    if (query.search) {
      where.OR = [
        { credentialNumber: { contains: query.search, mode: 'insensitive' } },
        {
          revocationLegalBasis: { contains: query.search, mode: 'insensitive' },
        },
        { revocationReason: { contains: query.search, mode: 'insensitive' } },
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
      this.prisma.issuedCredential.findMany({
        where,
        select: {
          id: true,
          credentialNumber: true,
          issueDate: true,
          expiryDate: true,
          revokedAt: true,
          revocationLegalBasis: true,
          revocationReason: true,
          revokedBy: {
            select: { id: true, serviceNumber: true, fullName: true },
          },
          categories: { select: { category: { select: { code: true } } } },
          driverProfile: {
            select: {
              id: true,
              serviceNumber: true,
              fullName: true,
              photoUrl: true,
              unit: { select: { code: true, name: true } },
            },
          },
        },
        skip,
        take: limit,
        orderBy: [{ revokedAt: 'desc' }, { updatedAt: 'desc' }],
      }),
      this.prisma.issuedCredential.count({ where }),
    ]);

    return new PaginatedResult(items, total, page, limit);
  }

  private async generateReportNumber(
    year: number,
    offset = 0,
  ): Promise<string> {
    const prefix = `INC-${year}-`;
    const latest = await this.prisma.incidentReport.findFirst({
      where: { reportNumber: { startsWith: prefix } },
      orderBy: { reportNumber: 'desc' },
      select: { reportNumber: true },
    });

    const lastSeq = latest
      ? Number.parseInt(latest.reportNumber.replace(prefix, ''), 10) || 0
      : 0;

    return `${prefix}${String(lastSeq + 1 + offset).padStart(4, '0')}`;
  }
}
