import { APPLICATIONS_ERROR_CODES } from './codes/applications';
import { AUDIT_ERROR_CODES } from './codes/audit';
import { AUTH_ERROR_CODES } from './codes/auth';
import { CATEGORIES_ERROR_CODES } from './codes/categories';
import { COMMON_ERROR_CODES } from './codes/common';
import { CREDENTIALS_ERROR_CODES } from './codes/credentials';
import { ELIGIBILITY_ERROR_CODES } from './codes/eligibility';
import { EXAMINATIONS_ERROR_CODES } from './codes/examinations';
import { MEDICAL_ERROR_CODES } from './codes/medical';
import { NATIONAL_LICENSE_ERROR_CODES } from './codes/national-license';
import { NOTIFICATIONS_ERROR_CODES } from './codes/notifications';
import { PERSONNEL_ERROR_CODES } from './codes/personnel';
import { SAFETY_ERROR_CODES } from './codes/safety';
import { STORAGE_ERROR_CODES } from './codes/storage';
import { TRAINING_ERROR_CODES } from './codes/training';
import { USERS_ERROR_CODES } from './codes/users';

/**
 * Catalogue of every API error code. The frontend has one translated message
 * per code (messages/<locale>/errors.json, key = the code). Codes are
 * SCREAMING_SNAKE_CASE and unique across modules (checked by a unit test).
 */
export const ERROR_CODES = [
  ...APPLICATIONS_ERROR_CODES,
  ...AUDIT_ERROR_CODES,
  ...AUTH_ERROR_CODES,
  ...CATEGORIES_ERROR_CODES,
  ...COMMON_ERROR_CODES,
  ...CREDENTIALS_ERROR_CODES,
  ...ELIGIBILITY_ERROR_CODES,
  ...EXAMINATIONS_ERROR_CODES,
  ...MEDICAL_ERROR_CODES,
  ...NATIONAL_LICENSE_ERROR_CODES,
  ...NOTIFICATIONS_ERROR_CODES,
  ...PERSONNEL_ERROR_CODES,
  ...SAFETY_ERROR_CODES,
  ...STORAGE_ERROR_CODES,
  ...TRAINING_ERROR_CODES,
  ...USERS_ERROR_CODES,
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];
