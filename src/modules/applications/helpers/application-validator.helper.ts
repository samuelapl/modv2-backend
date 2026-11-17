import {
  AppBadRequestException,
  AppConflictException,
  AppNotFoundException,
} from '../../../common/errors';
import {
  CredentialStatus,
  PersonnelStatus,
  VerificationStatus,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  OPEN_APPLICATION_STATUSES,
  calculateDriverAge,
} from './application-state.helper';

const INELIGIBLE_PERSONNEL: PersonnelStatus[] = [
  PersonnelStatus.SUSPENDED,
  PersonnelStatus.SEPARATED,
  PersonnelStatus.RETIRED,
];

export async function validateApplicationPrerequisites(
  prisma: PrismaService,
  params: {
    driverProfileId: string;
    categoryIds: string[];
    excludeApplicationId?: string;
    /**
     * PRE_TRAINED applications: the existing permit is the evidence, so the
     * civilian-license and category-prerequisite checks do not apply.
     */
    preTrained?: boolean;
  },
) {
  const uniqueCategoryIds = Array.from(new Set(params.categoryIds));

  const driver = await prisma.driverProfile.findUnique({
    where: { id: params.driverProfileId },
    include: { nationalLicense: true },
  });

  if (!driver) {
    throw new AppNotFoundException(
      'APPLICATION_DRIVER_PROFILE_NOT_FOUND',
      {},
      'Driver profile not found.',
    );
  }

  if (INELIGIBLE_PERSONNEL.includes(driver.personnelStatus)) {
    throw new AppBadRequestException(
      'DRIVER_STATUS_CANNOT_SUBMIT_APPLICATION',
      { status: driver.personnelStatus },
      `Driver with status ${driver.personnelStatus} cannot submit a driving authorization application.`,
    );
  }

  const categories = await prisma.vehicleCategory.findMany({
    where: { id: { in: uniqueCategoryIds }, isActive: true },
    include: { prerequisite: { select: { id: true, code: true, name: true } } },
  });

  if (categories.length !== uniqueCategoryIds.length) {
    throw new AppBadRequestException(
      'APPLICATION_CATEGORIES_INVALID_OR_INACTIVE',
      {},
      'One or more selected vehicle categories do not exist or are inactive.',
    );
  }

  if (!driver.dateOfBirth) {
    throw new AppBadRequestException(
      'PROFILE_INCOMPLETE',
      { fields: 'dateOfBirth' },
      'Complete your driver profile before applying. Missing: dateOfBirth.',
    );
  }
  const driverAge = calculateDriverAge(new Date(driver.dateOfBirth));
  for (const cat of categories) {
    if (driverAge < cat.minAgeRequired) {
      throw new AppBadRequestException(
        'APPLICATION_DRIVER_BELOW_MIN_AGE',
        { age: driverAge, minAge: cat.minAgeRequired, category: cat.code },
        `Driver age (${driverAge}) is below minimum required age (${cat.minAgeRequired}) for ${cat.code}.`,
      );
    }
  }

  if (!params.preTrained && categories.some((c) => c.requiresNationalLicense)) {
    if (!driver.nationalLicense) {
      throw new AppBadRequestException(
        'NATIONAL_LICENSE_REQUIRED_FOR_APPLICATION',
        {},
        'A verified Ethiopian National Driving License is required before applying for road vehicle categories.',
      );
    }
    if (
      driver.nationalLicense.verificationStatus !== VerificationStatus.VERIFIED
    ) {
      throw new AppBadRequestException(
        'NATIONAL_LICENSE_NOT_VERIFIED_FOR_APPLICATION',
        { status: driver.nationalLicense.verificationStatus },
        `National Driving License status is ${driver.nationalLicense.verificationStatus}. Complete Phase 3 officer verification first.`,
      );
    }
    if (new Date(driver.nationalLicense.expiryDate) <= new Date()) {
      throw new AppBadRequestException(
        'NATIONAL_LICENSE_EXPIRED_FOR_APPLICATION',
        {},
        'Driver National Driving License is expired. Submit an updated civilian license first.',
      );
    }
  }

  const requiredPrereqIds = categories
    .map((c) => c.prerequisiteCatId)
    .filter((id): id is string => Boolean(id));

  if (!params.preTrained && requiredPrereqIds.length > 0) {
    const heldCategories = await prisma.credentialCategoryItem.findMany({
      where: {
        categoryId: { in: requiredPrereqIds },
        credential: {
          driverProfileId: driver.id,
          status: CredentialStatus.ACTIVE,
        },
      },
      select: { categoryId: true },
    });
    const heldSet = new Set(heldCategories.map((h) => h.categoryId));

    for (const cat of categories) {
      if (cat.prerequisiteCatId && !heldSet.has(cat.prerequisiteCatId)) {
        const prereqCode = cat.prerequisite?.code || 'prerequisite category';
        throw new AppBadRequestException(
          'CATEGORY_PREREQUISITE_ENTITLEMENT_MISSING',
          { category: cat.code, prerequisite: prereqCode },
          `${cat.code} requires an active MoD entitlement for ${prereqCode}.`,
        );
      }
    }
  }

  const existingOpen = await prisma.application.findFirst({
    where: {
      ...(params.excludeApplicationId
        ? { id: { not: params.excludeApplicationId } }
        : {}),
      driverProfileId: driver.id,
      status: { in: OPEN_APPLICATION_STATUSES },
      requestedCategories: {
        some: { categoryId: { in: uniqueCategoryIds } },
      },
    },
    select: { applicationNumber: true },
  });

  if (existingOpen) {
    throw new AppConflictException(
      'OPEN_APPLICATION_EXISTS_FOR_CATEGORIES',
      { application: existingOpen.applicationNumber },
      `An open application (${existingOpen.applicationNumber}) already covers one or more selected categories for this driver.`,
    );
  }

  return { driver, categories };
}
