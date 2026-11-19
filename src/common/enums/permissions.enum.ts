export enum Permission {
  // 1. Users, Roles & System Config
  USERS_MANAGE = 'users:manage',
  ROLES_MANAGE = 'roles:manage',
  SYSTEM_CONFIGURE = 'system:configure',

  // 2. Personnel & Organizational Units
  DRIVERS_VIEW_OWN = 'drivers:view_own',
  DRIVERS_VIEW_UNIT = 'drivers:view_unit',
  DRIVERS_VIEW_ALL = 'drivers:view_all',
  DRIVERS_REGISTER = 'drivers:register',
  DRIVERS_UPDATE = 'drivers:update',
  UNITS_MANAGE = 'units:manage',

  // 3. National Driving License
  NATIONAL_DL_SUBMIT = 'national_dl:submit',
  NATIONAL_DL_VERIFY = 'national_dl:verify',

  // 4. Vehicle Categories
  CATEGORIES_READ = 'categories:read',
  CATEGORIES_MANAGE = 'categories:manage',

  // 5. Authorization Applications (Workflows 1, 2, 3, 5)
  APPLICATIONS_CREATE = 'applications:create',
  APPLICATIONS_VIEW_OWN = 'applications:view_own',
  APPLICATIONS_VIEW_ALL = 'applications:view_all',
  APPLICATIONS_SCREEN = 'applications:screen',
  APPLICATIONS_APPROVE = 'applications:approve',

  // 6. Training & Course Management
  TRAINING_MANAGE_COURSES = 'training:manage_courses',
  TRAINING_LOG_ATTENDANCE = 'training:log_attendance',
  TRAINING_VIEW_OWN = 'training:view_own',

  // 7. Examinations & Assessments
  EXAMS_MANAGE_SCHEDULES = 'exams:manage_schedules',
  EXAMS_GRADE_LOCKED = 'exams:grade_locked',

  // 8. Medical Fitness (Data Minimized)
  MEDICAL_RECORD_FIT = 'medical:record_fit',
  MEDICAL_VIEW_OUTCOME = 'medical:view_outcome',

  // 9. Credentials & Digital QR
  CREDENTIALS_ISSUE = 'credentials:issue',
  CREDENTIALS_PRINT = 'credentials:print',
  CREDENTIALS_REPRINT_OVERRIDE = 'credentials:reprint_override',
  CREDENTIALS_VIEW_OWN = 'credentials:view_own',
  CREDENTIALS_VERIFY_QR = 'credentials:verify_qr',

  // 10. Vehicle Assignment Eligibility
  ELIGIBILITY_CHECK = 'eligibility:check',

  // 11. Safety, Incidents & Suspensions (Workflow 4)
  SAFETY_REPORT_INCIDENT = 'safety:report_incident',
  SAFETY_INVESTIGATE = 'safety:investigate',
  SAFETY_SUSPEND = 'safety:suspend',
  SAFETY_REINSTATE = 'safety:reinstate',

  // 12. Storage (MinIO)
  STORAGE_UPLOAD = 'storage:upload',
  STORAGE_DOWNLOAD = 'storage:download',

  // 13. Audit & Reports
  AUDIT_VIEW_LOGS = 'audit:view_logs',
  AUDIT_EXPORT = 'audit:export',
  REPORTS_VIEW = 'reports:view',
}
