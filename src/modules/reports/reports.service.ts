import { Injectable } from '@nestjs/common';
import {
  ApplicationStatus,
  CredentialStatus,
  ExamOutcome,
  ExamType,
  InvestigationStatus,
  MedicalFitnessOutcome,
  PersonnelStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { QueryReportsDto } from './dto/query-reports.dto';

function pct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  getStatus() {
    return {
      module: 'reports',
      description: 'Executive KPIs & Management Reporting',
      status: 'READY',
    };
  }

  private buildScope(query: QueryReportsDto) {
    const unitWhere = query.unitId ? { id: query.unitId } : {};
    const driverWhere = query.unitId ? { unitId: query.unitId } : {};
    const driverRelWhere = query.unitId
      ? { driverProfile: { unitId: query.unitId } }
      : {};
    const expiringDays = query.expiringDays || 60;
    const now = new Date();
    const horizon = new Date(now.getTime() + expiringDays * 86_400_000);
    return { unitWhere, driverWhere, driverRelWhere, expiringDays, now, horizon };
  }

  async getExecutiveKpis(query: QueryReportsDto) {
    const {
      unitWhere,
      driverWhere,
      driverRelWhere,
      expiringDays,
      now,
      horizon,
    } = this.buildScope(query);

    const [
      driverGroups,
      applicationGroups,
      examGroups,
      credentialGroups,
      expiringSoonCount,
      openIncidents,
      activeSuspensions,
      latestMedicalRows,
      units,
      unitDrivers,
      activeCredentialUnits,
      activeSuspensionUnits,
    ] = await Promise.all([
      this.prisma.driverProfile.groupBy({
        by: ['personnelStatus'],
        where: driverWhere,
        _count: { _all: true },
      }),
      this.prisma.application.groupBy({
        by: ['status'],
        where: driverRelWhere,
        _count: { _all: true },
      }),
      this.prisma.examinationRecord.groupBy({
        by: ['examType', 'outcome'],
        where: driverRelWhere,
        _count: { _all: true },
      }),
      this.prisma.issuedCredential.groupBy({
        by: ['status'],
        where: driverRelWhere,
        _count: { _all: true },
      }),
      this.prisma.issuedCredential.count({
        where: {
          ...driverRelWhere,
          status: CredentialStatus.ACTIVE,
          expiryDate: { lte: horizon },
        },
      }),
      this.prisma.incidentReport.count({
        where: {
          ...driverRelWhere,
          status: {
            in: [
              InvestigationStatus.UNDER_INVESTIGATION,
              InvestigationStatus.SUBSTANTIATED,
            ],
          },
        },
      }),
      this.prisma.suspensionRecord.count({
        where: { ...driverRelWhere, isActive: true },
      }),
      this.prisma.medicalFitnessReview.findMany({
        where: driverRelWhere,
        distinct: ['driverProfileId'],
        orderBy: { assessmentDate: 'desc' },
        select: { outcome: true },
      }),
      this.prisma.organizationalUnit.findMany({
        where: unitWhere,
        select: { id: true, code: true, name: true },
        orderBy: { code: 'asc' },
      }),
      this.prisma.driverProfile.groupBy({
        by: ['unitId'],
        where: driverWhere,
        _count: { _all: true },
      }),
      this.prisma.issuedCredential.findMany({
        where: { ...driverRelWhere, status: CredentialStatus.ACTIVE },
        select: { driverProfile: { select: { unitId: true } } },
      }),
      this.prisma.suspensionRecord.findMany({
        where: { ...driverRelWhere, isActive: true },
        select: { driverProfile: { select: { unitId: true } } },
      }),
    ]);

    let totalDrivers = 0;
    let activeDrivers = 0;
    let suspendedDrivers = 0;
    for (const g of driverGroups) {
      totalDrivers += g._count._all;
      if (g.personnelStatus === PersonnelStatus.ACTIVE) activeDrivers += g._count._all;
      if (g.personnelStatus === PersonnelStatus.SUSPENDED)
        suspendedDrivers += g._count._all;
    }

    let totalApps = 0;
    let approvedApps = 0;
    let rejectedApps = 0;
    let inProgressApps = 0;
    for (const g of applicationGroups) {
      totalApps += g._count._all;
      if (g.status === ApplicationStatus.APPROVED) approvedApps += g._count._all;
      else if (g.status === ApplicationStatus.REJECTED) rejectedApps += g._count._all;
      else if (g.status !== ApplicationStatus.DRAFT) inProgressApps += g._count._all;
    }

    let theoryPass = 0;
    let theoryGraded = 0;
    let practicalPass = 0;
    let practicalGraded = 0;
    for (const g of examGroups) {
      if (g.outcome === ExamOutcome.INCOMPLETE) continue;
      if (g.examType === ExamType.THEORETICAL) {
        theoryGraded += g._count._all;
        if (g.outcome === ExamOutcome.PASS) theoryPass += g._count._all;
      } else if (g.examType === ExamType.PRACTICAL) {
        practicalGraded += g._count._all;
        if (g.outcome === ExamOutcome.PASS) practicalPass += g._count._all;
      }
    }
    const totalGraded = theoryGraded + practicalGraded;
    const totalPassed = theoryPass + practicalPass;

    let activeCredentials = 0;
    let suspendedCredentials = 0;
    let expiredCredentials = 0;
    for (const g of credentialGroups) {
      if (g.status === CredentialStatus.ACTIVE) activeCredentials += g._count._all;
      if (g.status === CredentialStatus.SUSPENDED)
        suspendedCredentials += g._count._all;
      if (g.status === CredentialStatus.EXPIRED) expiredCredentials += g._count._all;
    }

    let unfitDrivers = 0;
    let restrictedDrivers = 0;
    for (const m of latestMedicalRows) {
      if (
        m.outcome === MedicalFitnessOutcome.UNFIT ||
        m.outcome === MedicalFitnessOutcome.TEMPORARILY_UNFIT
      ) {
        unfitDrivers += 1;
      } else if (m.outcome === MedicalFitnessOutcome.FIT_WITH_RESTRICTIONS) {
        restrictedDrivers += 1;
      }
    }

    const driverCountByUnit = new Map<string, number>();
    for (const row of unitDrivers) {
      driverCountByUnit.set(row.unitId, row._count._all);
    }

    const credCountByUnit = new Map<string, number>();
    for (const row of activeCredentialUnits) {
      const uid = row.driverProfile.unitId;
      credCountByUnit.set(uid, (credCountByUnit.get(uid) || 0) + 1);
    }

    const suspCountByUnit = new Map<string, number>();
    for (const row of activeSuspensionUnits) {
      const uid = row.driverProfile.unitId;
      suspCountByUnit.set(uid, (suspCountByUnit.get(uid) || 0) + 1);
    }

    return {
      generatedAt: now.toISOString(),
      expiringDaysWindow: expiringDays,
      drivers: {
        total: totalDrivers,
        active: activeDrivers,
        suspended: suspendedDrivers,
      },
      applications: {
        total: totalApps,
        approved: approvedApps,
        rejected: rejectedApps,
        inProgress: inProgressApps,
        approvalRatePct: pct(approvedApps, approvedApps + rejectedApps),
      },
      examinations: {
        totalGraded,
        passed: totalPassed,
        failed: totalGraded - totalPassed,
        overallPassRatePct: pct(totalPassed, totalGraded),
        theoreticalPassRatePct: pct(theoryPass, theoryGraded),
        practicalPassRatePct: pct(practicalPass, practicalGraded),
      },
      credentials: {
        active: activeCredentials,
        suspended: suspendedCredentials,
        expired: expiredCredentials,
        expiringSoon: expiringSoonCount,
      },
      safetyAndMedical: {
        openIncidents,
        activeSuspensions,
        unfitDrivers,
        restrictedDrivers,
      },
      unitBreakdown: units.map((u) => ({
        unitId: u.id,
        unitCode: u.code,
        unitName: u.name,
        totalDrivers: driverCountByUnit.get(u.id) || 0,
        activeCredentials: credCountByUnit.get(u.id) || 0,
        activeSuspensions: suspCountByUnit.get(u.id) || 0,
      })),
    };
  }

  async getCategoryDistribution(query: QueryReportsDto) {
    const { driverRelWhere } = this.buildScope(query);

    const [categories, counts] = await Promise.all([
      this.prisma.vehicleCategory.findMany({
        where: { isActive: true },
        select: { id: true, code: true, name: true },
        orderBy: { code: 'asc' },
      }),
      this.prisma.credentialCategoryItem.groupBy({
        by: ['categoryId'],
        where: {
          credential: {
            ...driverRelWhere,
            status: CredentialStatus.ACTIVE,
          },
        },
        _count: { _all: true },
      }),
    ]);

    const countByCat = new Map<string, number>();
    let totalEndorsements = 0;
    for (const c of counts) {
      countByCat.set(c.categoryId, c._count._all);
      totalEndorsements += c._count._all;
    }

    return categories.map((cat) => {
      const activeCredentialCount = countByCat.get(cat.id) || 0;
      return {
        categoryId: cat.id,
        code: cat.code,
        name: cat.name,
        activeCredentialCount,
        percentage: pct(activeCredentialCount, totalEndorsements),
      };
    });
  }

  async getExpiringPermits(query: QueryReportsDto) {
    const { driverRelWhere, expiringDays, now, horizon } =
      this.buildScope(query);

    const credentials = await this.prisma.issuedCredential.findMany({
      where: {
        ...driverRelWhere,
        status: CredentialStatus.ACTIVE,
        expiryDate: { lte: horizon },
      },
      include: {
        driverProfile: {
          select: {
            id: true,
            serviceNumber: true,
            fullName: true,
            unit: { select: { id: true, code: true, name: true } },
          },
        },
      },
      orderBy: { expiryDate: 'asc' },
      take: 25,
    });

    const items = credentials.map((cred) => {
      const daysRemaining = Math.ceil(
        (cred.expiryDate.getTime() - now.getTime()) / 86_400_000,
      );
      const urgency: 'CRITICAL' | 'WARNING' | 'NOTICE' =
        daysRemaining <= 14
          ? 'CRITICAL'
          : daysRemaining <= 30
            ? 'WARNING'
            : 'NOTICE';

      return {
        credentialId: cred.id,
        credentialNumber: cred.credentialNumber,
        serialNumber: cred.serialNumber,
        expiryDate: cred.expiryDate.toISOString(),
        daysRemaining,
        urgency,
        driver: cred.driverProfile,
      };
    });

    return {
      expiringDaysWindow: expiringDays,
      total: items.length,
      items,
    };
  }
}
