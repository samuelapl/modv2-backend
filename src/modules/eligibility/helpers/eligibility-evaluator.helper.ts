import {
  CredentialStatus,
  MedicalFitnessOutcome,
  PersonnelStatus,
  VerificationStatus,
} from '@prisma/client';

export interface EligibilityEvaluationInput {
  driver: {
    personnelStatus: PersonnelStatus;
    suspensions: { reason: string; legalBasis: string }[];
    nationalLicense?: {
      verificationStatus: VerificationStatus;
      expiryDate: Date;
    } | null;
    medicalReviews: {
      outcome: MedicalFitnessOutcome;
      operationalRestrictions: string[];
      reviewDueDate: Date;
    }[];
  };
  credential?: {
    credentialNumber: string;
    serialNumber: string;
    status: CredentialStatus;
    expiryDate: Date;
    activeRestrictions: string[];
    categories: { category: { code: string; name: string } }[];
  } | null;
  targetCategory?: {
    code: string;
    name: string;
    requiresNationalLicense: boolean;
    requiresMedical: boolean;
  } | null;
}

export interface EligibilityEvaluationResult {
  eligible: boolean;
  reasons: string[];
  warnings: string[];
  activeRestrictions: string[];
  authorizedCategories: string[];
}

export function evaluateEligibilityRules(
  input: EligibilityEvaluationInput,
): EligibilityEvaluationResult {
  const { driver, credential, targetCategory } = input;
  const reasons: string[] = [];
  const warnings: string[] = [];
  const now = new Date();

  if (driver.personnelStatus !== PersonnelStatus.ACTIVE) {
    reasons.push(
      `Driver personnel status is ${driver.personnelStatus} (must be ACTIVE).`,
    );
  }

  if (driver.suspensions.length > 0) {
    const activeSusp = driver.suspensions[0];
    reasons.push(
      `Active disciplinary suspension: ${activeSusp.reason} (${activeSusp.legalBasis}).`,
    );
  }

  let authorizedCategories: string[] = [];
  if (!credential) {
    reasons.push('No issued MoD driving credential found for this driver.');
  } else {
    authorizedCategories = credential.categories.map((c) => c.category.code);
    if (credential.status !== CredentialStatus.ACTIVE) {
      reasons.push(
        `MoD credential ${credential.credentialNumber} is ${credential.status}.`,
      );
    }
    if (new Date(credential.expiryDate) <= now) {
      reasons.push(
        `MoD credential ${credential.credentialNumber} expired on ${new Date(credential.expiryDate).toLocaleDateString()}.`,
      );
    }
  }

  if (targetCategory && credential) {
    if (!authorizedCategories.includes(targetCategory.code)) {
      reasons.push(
        `Not authorized for Category ${targetCategory.code}${authorizedCategories.length > 0 ? ` (holds: ${authorizedCategories.join(', ')})` : ''}.`,
      );
    }
  }

  if (targetCategory?.requiresNationalLicense) {
    if (!driver.nationalLicense) {
      reasons.push(
        `Category ${targetCategory.code} requires a verified Ethiopian National Driving License.`,
      );
    } else {
      if (
        driver.nationalLicense.verificationStatus !==
        VerificationStatus.VERIFIED
      ) {
        reasons.push(
          `Civilian National Driving License status is ${driver.nationalLicense.verificationStatus}.`,
        );
      }
      if (new Date(driver.nationalLicense.expiryDate) <= now) {
        reasons.push('Civilian National Driving License is expired.');
      }
    }
  }

  const latestMedical = driver.medicalReviews[0];
  const needsMedicalCheck = targetCategory ? targetCategory.requiresMedical : true;
  if (needsMedicalCheck && latestMedical) {
    if (
      latestMedical.outcome === MedicalFitnessOutcome.UNFIT ||
      latestMedical.outcome === MedicalFitnessOutcome.TEMPORARILY_UNFIT
    ) {
      reasons.push(`Medical fitness clearance is ${latestMedical.outcome}.`);
    }
    if (new Date(latestMedical.reviewDueDate) <= now) {
      reasons.push(
        `Medical fitness clearance expired on ${new Date(latestMedical.reviewDueDate).toLocaleDateString()}.`,
      );
    }
  }

  const restrictionSet = new Set<string>([
    ...(credential?.activeRestrictions || []),
    ...(latestMedical?.operationalRestrictions || []),
  ]);
  const activeRestrictions = Array.from(restrictionSet);

  if (activeRestrictions.includes('DAYTIME_ONLY')) {
    warnings.push('Operational Advisory: Authorized for Daytime Dispatch Only.');
  }
  if (activeRestrictions.includes('NO_HAZARDOUS_CARGO')) {
    warnings.push('Operational Advisory: Excluded from Fuel / Hazardous Cargo.');
  }

  return {
    eligible: reasons.length === 0,
    reasons,
    warnings,
    activeRestrictions,
    authorizedCategories,
  };
}
