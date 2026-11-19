import { PrismaClient, SystemRole, PersonnelStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { SEED_PASSWORD } from './seed-password';
import { autoVerifiedIdentity } from '../src/modules/personnel/helpers/identity-verification.helper';
import { Permission } from '../src/common/enums/permissions.enum';

const prisma = new PrismaClient();

async function main() {
  console.log('--- Starting MoD IDLMS Database Seed ---');

  // -------------------------------------------------------------------------
  // 1. Seed All 12 Official MoD Role Templates & Granular Permissions
  //    (Directly aligned with Section 6 of the MoD Requirements Document)
  // -------------------------------------------------------------------------
  const roleTemplates: {
    role: SystemRole;
    displayName: string;
    description: string;
    permissions: Permission[];
  }[] = [
    {
      role: SystemRole.SYSTEM_ADMIN,
      displayName: 'System Administrator',
      description:
        'Super administrator: holds every permission in the system, including technical configuration, accounts, role templates and reference data.',
      // Every permission in the catalog, so new permissions are picked up on the next seed.
      permissions: Object.values(Permission),
    },
    {
      role: SystemRole.CENTRAL_LICENSING_ADMIN,
      displayName: 'Central Licensing Administrator',
      description:
        'Manage central records, verify national licences, screen applications, and coordinate approvals.',
      permissions: [
        Permission.DRIVERS_VIEW_ALL,
        Permission.DRIVERS_REGISTER,
        Permission.DRIVERS_UPDATE,
        Permission.NATIONAL_DL_SUBMIT,
        Permission.NATIONAL_DL_VERIFY,
        Permission.CATEGORIES_READ,
        Permission.APPLICATIONS_CREATE,
        Permission.APPLICATIONS_VIEW_ALL,
        Permission.APPLICATIONS_SCREEN,
        Permission.MEDICAL_VIEW_OUTCOME,
        Permission.CREDENTIALS_VERIFY_QR,
        Permission.STORAGE_UPLOAD,
        Permission.STORAGE_DOWNLOAD,
        Permission.REPORTS_VIEW,
      ],
    },
    {
      role: SystemRole.UNIT_COORDINATOR,
      displayName: 'Unit / Department Coordinator',
      description:
        'Register unit drivers, submit applications, validate administrative details, and track unit cases.',
      permissions: [
        Permission.DRIVERS_VIEW_OWN,
        Permission.DRIVERS_VIEW_UNIT,
        Permission.DRIVERS_REGISTER,
        Permission.NATIONAL_DL_SUBMIT,
        Permission.CATEGORIES_READ,
        Permission.APPLICATIONS_CREATE,
        Permission.APPLICATIONS_VIEW_OWN,
        Permission.MEDICAL_VIEW_OUTCOME,
        Permission.SAFETY_REPORT_INCIDENT,
        Permission.STORAGE_UPLOAD,
        Permission.STORAGE_DOWNLOAD,
      ],
    },
    {
      role: SystemRole.TRAINING_ADMIN,
      displayName: 'Training Administrator',
      description:
        'Manage approved driver training courses, instructors, class sessions, and completion records.',
      permissions: [
        Permission.CATEGORIES_READ,
        Permission.TRAINING_MANAGE_COURSES,
        Permission.TRAINING_LOG_ATTENDANCE,
        Permission.APPLICATIONS_VIEW_ALL,
        Permission.STORAGE_UPLOAD,
        Permission.STORAGE_DOWNLOAD,
        Permission.REPORTS_VIEW,
      ],
    },
    {
      role: SystemRole.INSTRUCTOR,
      displayName: 'Instructor',
      description:
        'Record training participation, attendance hours, and practical competency observations.',
      permissions: [
        Permission.CATEGORIES_READ,
        Permission.TRAINING_LOG_ATTENDANCE,
        Permission.STORAGE_UPLOAD,
        Permission.STORAGE_DOWNLOAD,
      ],
    },
    {
      role: SystemRole.EXAMINER,
      displayName: 'Examiner',
      description:
        'Schedule and conduct theoretical and practical assessments and enter locked scores.',
      permissions: [
        Permission.CATEGORIES_READ,
        Permission.EXAMS_MANAGE_SCHEDULES,
        Permission.EXAMS_GRADE_LOCKED,
        Permission.STORAGE_UPLOAD,
        Permission.STORAGE_DOWNLOAD,
      ],
    },
    {
      role: SystemRole.MEDICAL_REVIEWER,
      displayName: 'Medical Reviewer',
      description:
        'Record fitness-to-drive outcome, review date, and operational driving restrictions.',
      permissions: [
        Permission.MEDICAL_RECORD_FIT,
        Permission.MEDICAL_VIEW_OUTCOME,
        Permission.STORAGE_UPLOAD,
        Permission.STORAGE_DOWNLOAD,
      ],
    },
    {
      role: SystemRole.APPROVING_AUTHORITY,
      displayName: 'Approving Authority',
      description:
        'Review eligibility and approve, reject, suspend, or reinstate within delegated command authority.',
      permissions: [
        Permission.DRIVERS_VIEW_ALL,
        Permission.CATEGORIES_READ,
        Permission.APPLICATIONS_VIEW_ALL,
        Permission.APPLICATIONS_APPROVE,
        Permission.MEDICAL_VIEW_OUTCOME,
        Permission.CREDENTIALS_VERIFY_QR,
        Permission.CREDENTIALS_REPRINT_OVERRIDE,
        Permission.SAFETY_INVESTIGATE,
        Permission.SAFETY_SUSPEND,
        Permission.SAFETY_REINSTATE,
        Permission.STORAGE_DOWNLOAD,
        Permission.REPORTS_VIEW,
      ],
    },
    {
      role: SystemRole.CREDENTIAL_ISSUER,
      displayName: 'Credential Issuer',
      description:
        'Generate, print, activate, replace, and manage approved MoD driving credentials.',
      permissions: [
        Permission.DRIVERS_VIEW_ALL,
        Permission.CATEGORIES_READ,
        Permission.APPLICATIONS_VIEW_ALL,
        Permission.CREDENTIALS_ISSUE,
        Permission.CREDENTIALS_PRINT,
        Permission.CREDENTIALS_VERIFY_QR,
        Permission.STORAGE_DOWNLOAD,
      ],
    },
    {
      role: SystemRole.VERIFICATION_OFFICER,
      displayName: 'Verification Officer',
      description:
        'Verify credential authenticity via QR and perform real-time vehicle dispatch eligibility checks.',
      permissions: [
        Permission.CREDENTIALS_VERIFY_QR,
        Permission.ELIGIBILITY_CHECK,
      ],
    },
    {
      role: SystemRole.AUDITOR,
      displayName: 'Auditor / Compliance Officer',
      description:
        'Read-only inspection of tamper-evident audit logs, decisions, exceptions, and compliance reports.',
      permissions: [
        Permission.DRIVERS_VIEW_ALL,
        Permission.APPLICATIONS_VIEW_ALL,
        Permission.AUDIT_VIEW_LOGS,
        Permission.AUDIT_EXPORT,
        Permission.REPORTS_VIEW,
        Permission.STORAGE_DOWNLOAD,
      ],
    },
    {
      role: SystemRole.STAFF_DRIVER,
      displayName: 'Ministry Staff Member / Applicant',
      description:
        'Submit own applications, view application status, check training schedules, and access digital QR permit.',
      permissions: [
        Permission.DRIVERS_VIEW_OWN,
        Permission.CATEGORIES_READ,
        Permission.NATIONAL_DL_SUBMIT,
        Permission.APPLICATIONS_CREATE,
        Permission.APPLICATIONS_VIEW_OWN,
        Permission.TRAINING_VIEW_OWN,
        Permission.CREDENTIALS_VIEW_OWN,
        Permission.STORAGE_UPLOAD,
        Permission.STORAGE_DOWNLOAD,
      ],
    },
  ];

  for (const rt of roleTemplates) {
    await prisma.rolePermission.upsert({
      where: { role: rt.role },
      update: {
        displayName: rt.displayName,
        description: rt.description,
        permissions: rt.permissions,
      },
      create: {
        role: rt.role,
        displayName: rt.displayName,
        description: rt.description,
        permissions: rt.permissions,
      },
    });
  }
  console.log(`Seeded ${roleTemplates.length} RolePermission templates.`);

  // -------------------------------------------------------------------------
  // 2. Core Organizational Units
  // -------------------------------------------------------------------------
  const logUnit = await prisma.organizationalUnit.upsert({
    where: { code: 'LOG-CORPS' },
    update: {},
    create: {
      code: 'LOG-CORPS',
      name: 'Main Logistics & Transport Directorate',
    },
  });

  const baseUnit = await prisma.organizationalUnit.upsert({
    where: { code: 'CENTRAL-BASE-01' },
    update: {},
    create: {
      code: 'CENTRAL-BASE-01',
      name: 'Central Military Base Transport Division',
      parentUnitId: logUnit.id,
    },
  });

  const additionalUnits = [
    { code: 'ENG-CORPS', name: 'Engineering & Construction Directorate' },
    { code: 'AIR-TRANS', name: 'Air Force Ground Transport Wing' },
    { code: 'MED-CORPS', name: 'Military Health & Ambulance Directorate' },
    { code: 'HQ-ADMIN', name: 'Ministry Headquarters Support Pool' },
  ];

  for (const unit of additionalUnits) {
    await prisma.organizationalUnit.upsert({
      where: { code: unit.code },
      update: { name: unit.name },
      create: {
        code: unit.code,
        name: unit.name,
      },
    });
  }

  console.log(
    'Seeded Organizational Units:',
    logUnit.code,
    baseUnit.code,
    additionalUnits.map((u) => u.code).join(', '),
  );

  // -------------------------------------------------------------------------
  // 3. Standard MoD Vehicle Categories
  // -------------------------------------------------------------------------
  const categories = [
    {
      code: 'CAT-LV',
      name: 'Light Passenger & Utility Vehicle',
      description: 'Sedans, 4WD patrols, light utility transports up to 3,500 kg',
      minAge: 18,
      validity: 3,
      requiresNatLicense: false,
      requiresMedical: true,
    },
    {
      code: 'CAT-MV',
      name: 'Medium Cargo & Transport Vehicle',
      description: 'Medium transport trucks, supply carriers up to 7,500 kg',
      minAge: 20,
      validity: 3,
      requiresNatLicense: false,
      requiresMedical: true,
    },
    {
      code: 'CAT-HV',
      name: 'Heavy Freight & Logistics Vehicle',
      description: 'Heavy duty tactical cargo, fuel tankers, heavy haulers over 7,500 kg',
      minAge: 22,
      validity: 3,
      requiresNatLicense: false,
      requiresMedical: true,
    },
    {
      code: 'CAT-PT',
      name: 'Troop & Passenger Transport Bus',
      description: 'Personnel carriers and military buses carrying more than 16 passengers',
      minAge: 23,
      validity: 3,
      requiresNatLicense: false,
      requiresMedical: true,
    },
    {
      code: 'CAT-SP',
      name: 'Special Purpose & Base Equipment',
      description: 'Recovery vehicles, forklifts, airfield tugs, tracked compound machinery',
      minAge: 21,
      validity: 2,
      requiresNatLicense: false, // Internal base compound equipment
      requiresMedical: true,
    },
  ];

  for (const cat of categories) {
    await prisma.vehicleCategory.upsert({
      where: { code: cat.code },
      update: {
        name: cat.name,
        description: cat.description,
        minAgeRequired: cat.minAge,
        validityYears: cat.validity,
        requiresNationalLicense: cat.requiresNatLicense,
        requiresMedical: cat.requiresMedical,
      },
      create: {
        code: cat.code,
        name: cat.name,
        description: cat.description,
        minAgeRequired: cat.minAge,
        validityYears: cat.validity,
        requiresNationalLicense: cat.requiresNatLicense,
        requiresMedical: cat.requiresMedical,
      },
    });
  }
  console.log(`Seeded ${categories.length} Vehicle Categories.`);

  // -------------------------------------------------------------------------
  // 3b. Standard MoD Driver Training Courses (Form 4 Baseline)
  // -------------------------------------------------------------------------
  const baselineCourses = [
    {
      courseCode: 'TRN-LV-01',
      title: 'Defensive Light Utility & Patrol Driving',
      categoryCodes: ['CAT-LV'],
      durationHours: 24,
      syllabus: 'Convoy discipline, light 4WD defensive handling, night blackout driving.',
    },
    {
      courseCode: 'TRN-MV-01',
      title: 'Medium Logistics Convoy Operations',
      categoryCodes: ['CAT-MV'],
      durationHours: 32,
      syllabus: 'Medium truck load securing, off-road gradient recovery, convoy spacing.',
    },
    {
      courseCode: 'TRN-HV-01',
      title: 'Heavy Freight & Articulated Vehicle Course',
      categoryCodes: ['CAT-HV'],
      durationHours: 40,
      syllabus: 'Heavy cargo haulage, air-brake systems, mountain pass convoy control.',
    },
    {
      courseCode: 'TRN-PT-01',
      title: 'Troop & Passenger Bus Safety Operations',
      categoryCodes: ['CAT-PT'],
      durationHours: 36,
      syllabus: 'Passenger safety evacuation drills, long-distance troop transport checks.',
    },
    {
      courseCode: 'TRN-SP-01',
      title: 'Base Equipment & Recovery Machinery',
      categoryCodes: ['CAT-SP'],
      durationHours: 24,
      syllabus: 'Compound safety rules, crane/recovery winch operation, forklift maneuvers.',
    },
  ];

  for (const course of baselineCourses) {
    await prisma.trainingCourse.upsert({
      where: { courseCode: course.courseCode },
      update: {
        title: course.title,
        categoryCodes: course.categoryCodes,
        durationHours: course.durationHours,
        syllabus: course.syllabus,
      },
      create: course,
    });
  }
  console.log(`Seeded ${baselineCourses.length} MoD Training Courses.`);

  // -------------------------------------------------------------------------
  // 4. Seed Test Accounts for ALL 12 Official MoD Roles
  // -------------------------------------------------------------------------
  const defaultPassword = await bcrypt.hash(SEED_PASSWORD, 10);

  const testAccounts = [
    {
      serviceNumber: 'MOD-ADMIN-001',
      firstName: 'Tewodros',
      middleName: 'Alemu',
      lastName: 'Gebremedhin',
      fullName: 'Tewodros Alemu Gebremedhin',
      rank: 'Colonel',
      phone: '+251911100001',
      email: 'sysadmin@mod.gov.et',
      role: SystemRole.SYSTEM_ADMIN,
    },
    {
      serviceNumber: 'MOD-LIC-001',
      firstName: 'Mekdes',
      middleName: 'Tadesse',
      lastName: 'Wolde',
      fullName: 'Mekdes Tadesse Wolde',
      rank: 'Major',
      phone: '+251911100002',
      email: 'licensing@mod.gov.et',
      role: SystemRole.CENTRAL_LICENSING_ADMIN,
    },
    {
      serviceNumber: 'MOD-COORD-001',
      firstName: 'Solomon',
      middleName: 'Bekele',
      lastName: 'Abate',
      fullName: 'Solomon Bekele Abate',
      rank: 'Captain',
      phone: '+251911100003',
      email: 'coordinator@mod.gov.et',
      role: SystemRole.UNIT_COORDINATOR,
    },
    {
      serviceNumber: 'MOD-TRN-001',
      firstName: 'Bereket',
      middleName: 'Haile',
      lastName: 'Mulugeta',
      fullName: 'Bereket Haile Mulugeta',
      rank: 'Major',
      phone: '+251911100004',
      email: 'training.admin@mod.gov.et',
      role: SystemRole.TRAINING_ADMIN,
    },
    {
      serviceNumber: 'MOD-INST-001',
      firstName: 'Girma',
      middleName: 'Kebede',
      lastName: 'Negash',
      fullName: 'Girma Kebede Negash',
      rank: 'Sergeant',
      phone: '+251911100005',
      email: 'instructor@mod.gov.et',
      role: SystemRole.INSTRUCTOR,
    },
    {
      serviceNumber: 'MOD-EXAM-001',
      firstName: 'Hana',
      middleName: 'Tesfaye',
      lastName: 'Gizaw',
      fullName: 'Hana Tesfaye Gizaw',
      rank: 'Captain',
      phone: '+251911100006',
      email: 'examiner@mod.gov.et',
      role: SystemRole.EXAMINER,
    },
    {
      serviceNumber: 'MOD-MED-001',
      firstName: 'Selamawit',
      middleName: 'Assefa',
      lastName: 'Tsegaye',
      fullName: 'Selamawit Assefa Tsegaye',
      rank: 'Major (MD)',
      phone: '+251911100007',
      email: 'medical@mod.gov.et',
      role: SystemRole.MEDICAL_REVIEWER,
    },
    {
      serviceNumber: 'MOD-CMDR-001',
      firstName: 'Abebe',
      middleName: 'Worku',
      lastName: 'Demissie',
      fullName: 'Abebe Worku Demissie',
      rank: 'Brigadier General',
      phone: '+251911100008',
      email: 'commander@mod.gov.et',
      role: SystemRole.APPROVING_AUTHORITY,
    },
    {
      serviceNumber: 'MOD-ISSUER-001',
      firstName: 'Kidist',
      middleName: 'Mengistu',
      lastName: 'Zewdie',
      fullName: 'Kidist Mengistu Zewdie',
      rank: 'Lieutenant',
      phone: '+251911100009',
      email: 'issuer@mod.gov.et',
      role: SystemRole.CREDENTIAL_ISSUER,
    },
    {
      serviceNumber: 'MOD-GUARD-001',
      firstName: 'Yonas',
      middleName: 'Desta',
      lastName: 'Berhe',
      fullName: 'Yonas Desta Berhe',
      rank: 'Corporal',
      phone: '+251911100010',
      email: 'checkpoint@mod.gov.et',
      role: SystemRole.VERIFICATION_OFFICER,
    },
    {
      serviceNumber: 'MOD-AUDIT-001',
      firstName: 'Rahel',
      middleName: 'Lemma',
      lastName: 'Fikre',
      fullName: 'Rahel Lemma Fikre',
      rank: 'Lieutenant Colonel',
      phone: '+251911100011',
      email: 'auditor@mod.gov.et',
      role: SystemRole.AUDITOR,
    },
  ];

  for (const acc of testAccounts) {
    await prisma.user.upsert({
      where: { serviceNumber: acc.serviceNumber },
      update: {
        fullName: acc.fullName,
        firstName: acc.firstName,
        middleName: acc.middleName,
        lastName: acc.lastName,
        rank: acc.rank,
        phone: acc.phone,
        roles: [acc.role],
        passwordHash: defaultPassword,
        isActive: true,
      },
      create: {
        serviceNumber: acc.serviceNumber,
        fullName: acc.fullName,
        firstName: acc.firstName,
        middleName: acc.middleName,
        lastName: acc.lastName,
        rank: acc.rank,
        phone: acc.phone,
        email: acc.email,
        passwordHash: defaultPassword,
        roles: [acc.role],
        unitId: logUnit.id,
        isActive: true,
      },
    });
  }

  // Staff Driver with full DriverProfile
  await prisma.user.upsert({
    where: { serviceNumber: 'MOD-88219' },
    update: {
      firstName: 'Dawit',
      middleName: 'Tesfaye',
      lastName: 'Bogale',
      fullName: 'Dawit Tesfaye Bogale',
      rank: 'Corporal',
      phone: '+251911223344',
      roles: [SystemRole.STAFF_DRIVER],
      passwordHash: defaultPassword,
      isActive: true,
      driverProfile: {
        update: {
          firstName: 'Dawit',
          middleName: 'Tesfaye',
          lastName: 'Bogale',
          fullName: 'Dawit Tesfaye Bogale',
          fullNameAm: 'ዳዊት ተስፋዬ ቦጋለ',
          ...autoVerifiedIdentity(),
        },
      },
    },
    create: {
      serviceNumber: 'MOD-88219',
      firstName: 'Dawit',
      middleName: 'Tesfaye',
      lastName: 'Bogale',
      fullName: 'Dawit Tesfaye Bogale',
      rank: 'Corporal',
      phone: '+251911223344',
      email: 'dawit.tesfaye@mod.gov.et',
      passwordHash: defaultPassword,
      roles: [SystemRole.STAFF_DRIVER],
      unitId: logUnit.id,
      isActive: true,
      driverProfile: {
        create: {
          serviceNumber: 'MOD-88219',
          firstName: 'Dawit',
          middleName: 'Tesfaye',
          lastName: 'Bogale',
          fullName: 'Dawit Tesfaye Bogale',
          fullNameAm: 'ዳዊት ተስፋዬ ቦጋለ',
          rank: 'Corporal',
          gender: 'MALE',
          nationalIdNumber: 'FAN-882190001',
          dateOfBirth: new Date('1998-05-12'),
          bloodGroup: 'O+',
          contactPhone: '+251911223344',
          emergencyContactName: 'Tigist Tesfaye',
          emergencyContactPhone: '+251911223399',
          unitId: logUnit.id,
          personnelStatus: PersonnelStatus.ACTIVE,
          // Dev convenience: the demo driver can apply straight away (no photo to upload).
          profileStatus: 'COMPLETE',
          profileCompletedAt: new Date(),
          ...autoVerifiedIdentity(),
        },
      },
    },
  });

  console.log(`Seeded all 12 test user accounts (Default password: ${SEED_PASSWORD})`);
  console.log('--- Seed Completed Successfully! ---');
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
