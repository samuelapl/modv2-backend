import { Permission } from '../../../common/enums/permissions.enum';

export interface PermissionCatalogGroup {
  group: string;
  permissions: { key: Permission; label: string }[];
}

export const PERMISSION_CATALOG: PermissionCatalogGroup[] = [
  {
    group: 'System & Access Control',
    permissions: [
      { key: Permission.USERS_MANAGE, label: 'Manage Staff Accounts' },
      { key: Permission.ROLES_MANAGE, label: 'Manage Role Permission Templates' },
      { key: Permission.SYSTEM_CONFIGURE, label: 'Configure System Settings' },
    ],
  },
  {
    group: 'Personnel & Organizational Units',
    permissions: [
      { key: Permission.DRIVERS_VIEW_OWN, label: 'View Own Driver Profile' },
      { key: Permission.DRIVERS_VIEW_UNIT, label: 'View Unit Drivers' },
      { key: Permission.DRIVERS_VIEW_ALL, label: 'View All Ministry Drivers' },
      { key: Permission.DRIVERS_REGISTER, label: 'Register New Drivers' },
      { key: Permission.DRIVERS_UPDATE, label: 'Update Driver Records' },
      { key: Permission.UNITS_MANAGE, label: 'Manage Organizational Units' },
    ],
  },
  {
    group: 'National Driving License',
    permissions: [
      { key: Permission.NATIONAL_DL_SUBMIT, label: 'Submit National License Info' },
      { key: Permission.NATIONAL_DL_VERIFY, label: 'Verify / Reject National Licenses' },
    ],
  },
  {
    group: 'Categories & Applications',
    permissions: [
      { key: Permission.CATEGORIES_READ, label: 'View Vehicle Categories' },
      { key: Permission.CATEGORIES_MANAGE, label: 'Manage Vehicle Categories' },
      { key: Permission.APPLICATIONS_CREATE, label: 'Submit Driving Applications' },
      { key: Permission.APPLICATIONS_VIEW_OWN, label: 'View Own Applications' },
      { key: Permission.APPLICATIONS_VIEW_ALL, label: 'View All Applications' },
      { key: Permission.APPLICATIONS_SCREEN, label: 'Screen & Return Applications' },
      { key: Permission.APPLICATIONS_APPROVE, label: 'Approve Authorizations (Checker)' },
    ],
  },
  {
    group: 'Training & Examinations',
    permissions: [
      { key: Permission.TRAINING_MANAGE_COURSES, label: 'Manage Training Courses' },
      { key: Permission.TRAINING_LOG_ATTENDANCE, label: 'Log Training Hours & Complete' },
      { key: Permission.TRAINING_VIEW_OWN, label: 'View Own Training' },
      { key: Permission.EXAMS_MANAGE_SCHEDULES, label: 'Schedule Examinations' },
      { key: Permission.EXAMS_GRADE_LOCKED, label: 'Record & Lock Exam Scores' },
    ],
  },
  {
    group: 'Medical Fitness (Privacy Guarded)',
    permissions: [
      { key: Permission.MEDICAL_RECORD_FIT, label: 'Record Medical Fitness Outcome' },
      { key: Permission.MEDICAL_VIEW_OUTCOME, label: 'View Fitness Outcome Only' },
    ],
  },
  {
    group: 'Credentials, Dispatch & Safety',
    permissions: [
      { key: Permission.CREDENTIALS_ISSUE, label: 'Issue MoD Credentials' },
      { key: Permission.CREDENTIALS_PRINT, label: 'Print PVC Permit Cards (one-time)' },
      { key: Permission.CREDENTIALS_REPRINT_OVERRIDE, label: 'Authorize Card Reprint (Supervisor)' },
      { key: Permission.CREDENTIALS_VIEW_OWN, label: 'View Own Digital Credential' },
      { key: Permission.CREDENTIALS_VERIFY_QR, label: 'Verify QR Credentials' },
      { key: Permission.ELIGIBILITY_CHECK, label: 'Run Vehicle Dispatch Checks' },
      { key: Permission.SAFETY_REPORT_INCIDENT, label: 'Report Safety Incidents' },
      { key: Permission.SAFETY_INVESTIGATE, label: 'Investigate Incidents' },
      { key: Permission.SAFETY_SUSPEND, label: 'Impose Permit Suspensions' },
      { key: Permission.SAFETY_REINSTATE, label: 'Reinstate Suspended Permits' },
    ],
  },
  {
    group: 'Storage, Audit & Reports',
    permissions: [
      { key: Permission.STORAGE_UPLOAD, label: 'Upload Evidence Documents' },
      { key: Permission.STORAGE_DOWNLOAD, label: 'View & Download Documents' },
      { key: Permission.AUDIT_VIEW_LOGS, label: 'Inspect Audit Trail Logs' },
      { key: Permission.AUDIT_EXPORT, label: 'Export Audit Logs' },
      { key: Permission.REPORTS_VIEW, label: 'View Executive KPI Reports' },
    ],
  },
];
