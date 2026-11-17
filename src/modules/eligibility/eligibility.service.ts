import {
  Injectable,
} from '@nestjs/common';
import {
  AppBadRequestException,
  AppNotFoundException,
} from '../../common/errors';
import { CredentialStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RequestUserContext } from '../personnel/services/drivers.service';
import { CredentialsService } from '../credentials/credentials.service';
import { CheckEligibilityDto } from './dto/check-eligibility.dto';
import { ScanQrDto } from './dto/scan-qr.dto';
import { evaluateEligibilityRules } from './helpers/eligibility-evaluator.helper';

@Injectable()
export class EligibilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly credentialsService: CredentialsService,
  ) {}

  getStatus() {
    return {
      module: 'eligibility',
      description: 'Real-Time Vehicle Assignment Eligibility Engine',
      status: 'READY',
    };
  }

  async getActiveCategories() {
    return this.prisma.vehicleCategory.findMany({
      where: { isActive: true },
      select: {
        id: true,
        code: true,
        name: true,
        minAgeRequired: true,
        requiresNationalLicense: true,
        requiresMedical: true,
      },
      orderBy: [{ minAgeRequired: 'asc' }, { code: 'asc' }],
    });
  }

  async checkEligibility(
    dto: CheckEligibilityDto,
    officer: RequestUserContext,
  ) {
    const serviceNumber = dto.serviceNumber?.trim().toUpperCase();
    const credentialNumber = dto.credentialNumber?.trim().toUpperCase();
    const categoryCode = dto.categoryCode.trim().toUpperCase();

    if (!serviceNumber && !credentialNumber) {
      throw new AppBadRequestException(
        'ELIGIBILITY_IDENTIFIER_REQUIRED',
        {},
        'Provide a Driver Service Number or MoD Credential Number.',
      );
    }

    const targetCategory = await this.prisma.vehicleCategory.findUnique({
      where: { code: categoryCode },
      select: {
        id: true,
        code: true,
        name: true,
        requiresNationalLicense: true,
        requiresMedical: true,
        isActive: true,
      },
    });

    if (!targetCategory || !targetCategory.isActive) {
      throw new AppNotFoundException(
        'ELIGIBILITY_ACTIVE_CATEGORY_NOT_FOUND',
        { category: categoryCode },
        `Active vehicle category ${categoryCode} not found.`,
      );
    }

    let matchedDriverId: string | undefined;
    if (credentialNumber && !serviceNumber) {
      const credLookup = await this.prisma.issuedCredential.findUnique({
        where: { credentialNumber },
        select: { driverProfileId: true },
      });
      if (!credLookup) {
        throw new AppNotFoundException(
          'ELIGIBILITY_CREDENTIAL_NOT_FOUND',
          { credential: credentialNumber },
          `MoD Credential ${credentialNumber} not found.`,
        );
      }
      matchedDriverId = credLookup.driverProfileId;
    }

    const driver = await this.prisma.driverProfile.findUnique({
      where: matchedDriverId ? { id: matchedDriverId } : { serviceNumber },
      include: {
        unit: { select: { id: true, code: true, name: true } },
        nationalLicense: {
          select: {
            licenseNumber: true,
            verificationStatus: true,
            expiryDate: true,
          },
        },
        medicalReviews: {
          orderBy: { assessmentDate: 'desc' },
          take: 1,
          select: {
            outcome: true,
            operationalRestrictions: true,
            reviewDueDate: true,
          },
        },
        suspensions: {
          where: { isActive: true },
          orderBy: { startDate: 'desc' },
          take: 1,
          select: { reason: true, legalBasis: true },
        },
        issuedCredentials: {
          orderBy: { issueDate: 'desc' },
          include: {
            categories: {
              include: { category: { select: { code: true, name: true } } },
            },
          },
        },
      },
    });

    if (!driver) {
      throw new AppNotFoundException(
        'ELIGIBILITY_DRIVER_NOT_FOUND',
        { identifier: serviceNumber || credentialNumber },
        `Driver profile ${serviceNumber || credentialNumber} not found.`,
      );
    }

    const credential =
      (credentialNumber
        ? driver.issuedCredentials.find(
            (c) => c.credentialNumber === credentialNumber,
          )
        : undefined) ||
      driver.issuedCredentials.find(
        (c) => c.status === CredentialStatus.ACTIVE,
      ) ||
      driver.issuedCredentials[0] ||
      null;

    const evaluation = evaluateEligibilityRules({
      driver,
      credential,
      targetCategory,
    });

    await this.prisma.auditLog.create({
      data: {
        userId: officer.id,
        action: 'ELIGIBILITY_CHECK',
        entityType: 'DriverProfile',
        entityId: driver.id,
        newValue: {
          serviceNumber: driver.serviceNumber,
          categoryCode: targetCategory.code,
          eligible: evaluation.eligible,
          reasons: evaluation.reasons,
        },
      },
    });

    return {
      ...evaluation,
      checkedAt: new Date().toISOString(),
      category: {
        code: targetCategory.code,
        name: targetCategory.name,
      },
      driver: {
        id: driver.id,
        serviceNumber: driver.serviceNumber,
        fullName: driver.fullName,
        photoUrl: driver.photoUrl,
        personnelStatus: driver.personnelStatus,
        unit: driver.unit,
      },
      credential: credential
        ? {
            credentialNumber: credential.credentialNumber,
            serialNumber: credential.serialNumber,
            cardIssued: credential.cardIssued,
            status: credential.status,
            issueDate: credential.issueDate,
            expiryDate: credential.expiryDate,
          }
        : null,
    };
  }

  async scanQrCheckpoint(dto: ScanQrDto, officer: RequestUserContext) {
    const qrResult = await this.credentialsService.verifyQrToken(dto.token);

    if (!qrResult.cryptographicValid || !qrResult.credential) {
      return {
        cryptographicValid: qrResult.cryptographicValid,
        eligible: false,
        reasons: [qrResult.reason],
        warnings: [],
        activeRestrictions: [],
        authorizedCategories: [],
        checkedAt: new Date().toISOString(),
        category: null,
        driver: null,
        credential: null,
      };
    }

    let targetCategory: {
      id: string;
      code: string;
      name: string;
      requiresNationalLicense: boolean;
      requiresMedical: boolean;
      isActive: boolean;
    } | null = null;

    if (dto.categoryCode?.trim()) {
      const code = dto.categoryCode.trim().toUpperCase();
      targetCategory = await this.prisma.vehicleCategory.findUnique({
        where: { code },
        select: {
          id: true,
          code: true,
          name: true,
          requiresNationalLicense: true,
          requiresMedical: true,
          isActive: true,
        },
      });
      if (!targetCategory || !targetCategory.isActive) {
        throw new AppNotFoundException(
          'ELIGIBILITY_ACTIVE_CATEGORY_NOT_FOUND',
          { category: code },
          `Active vehicle category ${code} not found.`,
        );
      }
    }

    const driver = await this.prisma.driverProfile.findUnique({
      where: { id: qrResult.credential.driverProfileId },
      include: {
        unit: { select: { id: true, code: true, name: true } },
        nationalLicense: {
          select: {
            licenseNumber: true,
            verificationStatus: true,
            expiryDate: true,
          },
        },
        medicalReviews: {
          orderBy: { assessmentDate: 'desc' },
          take: 1,
          select: {
            outcome: true,
            operationalRestrictions: true,
            reviewDueDate: true,
          },
        },
        suspensions: {
          where: { isActive: true },
          orderBy: { startDate: 'desc' },
          take: 1,
          select: { reason: true, legalBasis: true },
        },
      },
    });

    if (!driver) {
      throw new AppNotFoundException(
        'ELIGIBILITY_QR_DRIVER_NOT_FOUND',
        {},
        'Driver profile linked to QR not found.',
      );
    }

    const evaluation = evaluateEligibilityRules({
      driver,
      credential: qrResult.credential,
      targetCategory,
    });

    await this.prisma.auditLog.create({
      data: {
        userId: officer.id,
        action: 'QR_CHECKPOINT_SCAN',
        entityType: 'IssuedCredential',
        entityId: qrResult.credential.id,
        newValue: {
          credentialNumber: qrResult.credential.credentialNumber,
          categoryCode: targetCategory?.code || 'ANY',
          eligible: evaluation.eligible,
          reasons: evaluation.reasons,
        },
      },
    });

    return {
      cryptographicValid: true,
      ...evaluation,
      checkedAt: new Date().toISOString(),
      category: targetCategory
        ? { code: targetCategory.code, name: targetCategory.name }
        : null,
      driver: {
        id: driver.id,
        serviceNumber: driver.serviceNumber,
        fullName: driver.fullName,
        photoUrl: driver.photoUrl,
        personnelStatus: driver.personnelStatus,
        unit: driver.unit,
      },
      credential: {
        credentialNumber: qrResult.credential.credentialNumber,
        serialNumber: qrResult.credential.serialNumber,
        status: qrResult.credential.status,
        issueDate: qrResult.credential.issueDate,
        expiryDate: qrResult.credential.expiryDate,
      },
    };
  }
}
