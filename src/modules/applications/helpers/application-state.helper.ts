import { ApplicationStatus, ApplicationType } from '@prisma/client';

export const OPEN_APPLICATION_STATUSES: ApplicationStatus[] = [
  ApplicationStatus.SUBMITTED,
  ApplicationStatus.SCREENING,
  ApplicationStatus.TRAINING_PENDING,
  ApplicationStatus.EXAM_PENDING,
  ApplicationStatus.MEDICAL_PENDING,
  ApplicationStatus.PENDING_VERIFICATION,
  ApplicationStatus.READY_FOR_APPROVAL,
];

export const SCREENABLE_STATUSES: ApplicationStatus[] = [
  ApplicationStatus.SUBMITTED,
  ApplicationStatus.SCREENING,
];

export function calculateDriverAge(dateOfBirth: Date): number {
  const today = new Date();
  let age = today.getFullYear() - dateOfBirth.getFullYear();
  const monthDiff = today.getMonth() - dateOfBirth.getMonth();
  if (
    monthDiff < 0 ||
    (monthDiff === 0 && today.getDate() < dateOfBirth.getDate())
  ) {
    age -= 1;
  }
  return age;
}

/**
 * Application types that may be routed straight to command approval
 * from screening. Every other type must pass its training / exam /
 * medical stages first. RENEWAL is excluded so its medical check can't be
 * skipped (without a medical category it already goes straight to approval).
 */
export const DIRECT_APPROVAL_TYPES: ApplicationType[] = [
  ApplicationType.REPLACEMENT,
  ApplicationType.PRE_TRAINED,
];

/**
 * Ordered post-screening stages for an application type, ending at
 * READY_FOR_APPROVAL. The medical stage is dropped when none of the
 * requested categories requires a medical clearance.
 */
export function getPostScreeningStages(
  type: ApplicationType,
  categories: { requiresMedical: boolean }[],
): ApplicationStatus[] {
  const needsMedical = categories.some((c) => c.requiresMedical);
  const medical = needsMedical ? [ApplicationStatus.MEDICAL_PENDING] : [];

  switch (type) {
    case ApplicationType.REPLACEMENT:
    case ApplicationType.PRE_TRAINED:
      // Pre-trained drivers already hold a permit: registration + approval only.
      return [ApplicationStatus.READY_FOR_APPROVAL];
    case ApplicationType.RENEWAL:
      return [...medical, ApplicationStatus.READY_FOR_APPROVAL];
    case ApplicationType.REINSTATEMENT:
      return [
        ...medical,
        ApplicationStatus.TRAINING_PENDING,
        ApplicationStatus.READY_FOR_APPROVAL,
      ];
    case ApplicationType.NEW_AUTHORIZATION:
    case ApplicationType.ADDITIONAL_CATEGORY:
    default:
      // Medical fitness is a cheap pass/fail gate, so it runs before the
      // costly training and exam stages.
      return [
        ...medical,
        ApplicationStatus.TRAINING_PENDING,
        ApplicationStatus.EXAM_PENDING,
        ApplicationStatus.READY_FOR_APPROVAL,
      ];
  }
}

/**
 * Resolve the stage exactly one step after the application's current
 * status. SUBMITTED / SCREENING advance to the first post-screening stage.
 * Returns null when the current status is not part of the type's pipeline.
 */
export function resolveNextStage(
  type: ApplicationType,
  currentStatus: ApplicationStatus,
  categories: { requiresMedical: boolean }[],
): ApplicationStatus | null {
  const stages = getPostScreeningStages(type, categories);

  if (
    currentStatus === ApplicationStatus.SUBMITTED ||
    currentStatus === ApplicationStatus.SCREENING
  ) {
    return stages[0];
  }

  const idx = stages.indexOf(currentStatus);
  if (idx === -1 || idx >= stages.length - 1) return null;
  return stages[idx + 1];
}

/** @deprecated use resolveNextStage — kept for callers screening fresh cases. */
export function resolveNextStageAfterScreen(
  type: ApplicationType,
  categories: { requiresMedical: boolean }[],
): ApplicationStatus {
  return getPostScreeningStages(type, categories)[0];
}

export function formatStageLabel(status: ApplicationStatus): string {
  switch (status) {
    case ApplicationStatus.DRAFT:
      return 'Draft Saved';
    case ApplicationStatus.SUBMITTED:
      return 'Submitted for Screening';
    case ApplicationStatus.SCREENING:
      return 'Under Administrative Screening';
    case ApplicationStatus.TRAINING_PENDING:
      return 'Awaiting Training Completion';
    case ApplicationStatus.EXAM_PENDING:
      return 'Awaiting Theory & Practical Exams';
    case ApplicationStatus.MEDICAL_PENDING:
      return 'Awaiting Medical Fitness Clearance';
    case ApplicationStatus.PENDING_VERIFICATION:
      return 'Awaiting Permit Verification';
    case ApplicationStatus.READY_FOR_APPROVAL:
      return 'Ready for Command Approval';
    case ApplicationStatus.APPROVED:
      return 'Approved by Command Authority';
    case ApplicationStatus.RETURNED_FOR_CORRECTION:
      return 'Returned for Correction';
    case ApplicationStatus.REJECTED:
      return 'Application Rejected';
    default:
      return status;
  }
}
