import { SetMetadata } from '@nestjs/common';

export const AUDIT_META_KEY = 'audit_meta';
export const SKIP_AUTO_AUDIT_KEY = 'skip_auto_audit';

export type AuditPrismaModel =
  | 'application'
  | 'nationalLicense'
  | 'examinationRecord'
  | 'medicalFitnessReview'
  | 'trainingEnrollment'
  | 'trainingCourse'
  | 'trainingBatch'
  | 'driverProfile'
  | 'user'
  | 'vehicleCategory'
  | 'organizationalUnit'
  | 'rolePermission';

export interface AuditMetaOptions {
  action: string;
  entityType: string;
  prismaModel?: AuditPrismaModel;
  idParam?: string;
}

export const AuditMeta = (
  action: string,
  entityType: string,
  prismaModel?: AuditPrismaModel,
  idParam = 'id',
) =>
  SetMetadata(AUDIT_META_KEY, {
    action,
    entityType,
    prismaModel,
    idParam,
  } satisfies AuditMetaOptions);

export const SkipAutoAudit = () => SetMetadata(SKIP_AUTO_AUDIT_KEY, true);
