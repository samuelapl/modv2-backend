/**
 * MoD IDLMS — DEMO DATA SEED (100 drivers with permits)
 * ----------------------------------------------------------------------------
 * Purpose: fill the dashboards with realistic data so every permit state can be
 * tested (valid, expiring soon, expired, suspended, revoked, restricted ...).
 *
 * This file is SEPARATE from prisma/seed.ts and never changes it.
 *
 * Run order:
 *   1. npm run prisma:seed        (base data: roles, units, categories, staff accounts)
 *   2. npm run prisma:seed:demo   (this file)
 *
 * Re-running:
 *   - Safe. Drivers that already exist (MOD-DEMO-xxx) are skipped.
 *   - npm run prisma:seed:demo -- --reset   wipes ONLY the MOD-DEMO-* drivers
 *     (and everything hanging off them), then recreates them.
 *   - npm run prisma:seed:demo -- --reset-only   wipes them and stops.
 *
 * Every demo driver logs in with:  serviceNumber MOD-DEMO-001 ... MOD-DEMO-100
 * password Password12   (same as the base seed accounts)
 *
 * Data is deterministic (fixed pseudo-random seed); only dates move, because
 * they are computed relative to the day you run the seed.
 */
import {
  PrismaClient,
  SystemRole,
  PersonnelStatus,
  Gender,
  ApplicationType,
  ApplicationStatus,
  ApprovalAction,
  CourseStatus,
  ExamType,
  ExamOutcome,
  MedicalFitnessOutcome,
  CredentialStatus,
  VerificationStatus,
  IncidentSeverity,
  InvestigationStatus,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { SEED_PASSWORD } from './seed-password';
import * as crypto from 'crypto';
import { signCredentialPayload } from '../src/modules/credentials/helpers/qr-signer.helper';

const prisma = new PrismaClient();

const DEMO_PREFIX = 'MOD-DEMO-';
const TOTAL = 100;
const DAY = 24 * 60 * 60 * 1000;
const DEFAULT_PASSWORD = SEED_PASSWORD;

// Must match the secret the backend signs/verifies QR tokens with, otherwise
// QR verification of seeded permits would say "tampered".
const QR_SECRET = process.env.QR_SIGNING_SECRET || process.env.JWT_SECRET || '';

// ---------------------------------------------------------------------------
// Scenario plan — which permit state each driver index gets (0-based).
// ---------------------------------------------------------------------------
type Scenario =
  | 'VALID'
  | 'EXPIRING_SOON'
  | 'EXPIRED_SWEPT'
  | 'EXPIRED_UNSWEPT'
  | 'SUSPENDED'
  | 'REVOKED'
  | 'VALID_PERSONNEL_CHANGE';

function scenarioFor(i: number): Scenario {
  if (i < 50) return 'VALID'; //                  50  valid, > 90 days left
  if (i < 70) return 'EXPIRING_SOON'; //          20  expire within 90 days
  if (i < 80) return 'EXPIRED_SWEPT'; //          10  status EXPIRED (nightly job ran)
  if (i < 85) return 'EXPIRED_UNSWEPT'; //         5  date passed, status still ACTIVE
  if (i < 92) return 'SUSPENDED'; //               7  suspended permit + incident
  if (i < 95) return 'REVOKED'; //                 3  permanently revoked
  return 'VALID_PERSONNEL_CHANGE'; //              5  valid permit, driver on leave/retired...
}

// Days until expiry for EXPIRING_SOON drivers (negative handled elsewhere).
// Covers the typical alert thresholds: 3, 7, 14, 30, 60, 90.
const EXPIRING_DAYS = [3, 5, 7, 10, 14, 18, 21, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 78, 85, 89];
const PERSONNEL_CHANGE: PersonnelStatus[] = [
  PersonnelStatus.ON_LEAVE,
  PersonnelStatus.ON_LEAVE,
  PersonnelStatus.TRANSFERRED,
  PersonnelStatus.RETIRED,
  PersonnelStatus.SEPARATED,
];

// ---------------------------------------------------------------------------
// Reference data for realistic Ethiopian profiles
// ---------------------------------------------------------------------------
const MALE_NAMES = [
  'Abel', 'Abebe', 'Alemayehu', 'Amanuel', 'Bekele', 'Berhanu', 'Biruk', 'Dagim',
  'Dawit', 'Elias', 'Endalkachew', 'Eyob', 'Fikadu', 'Getachew', 'Habtamu', 'Henok',
  'Kaleab', 'Kebede', 'Leul', 'Mulugeta', 'Natnael', 'Samuel', 'Tadesse', 'Tamrat',
  'Tesfaye', 'Wondwosen', 'Yared', 'Yohannes', 'Zerihun', 'Million',
];
const FEMALE_NAMES = [
  'Aster', 'Bethlehem', 'Birtukan', 'Eden', 'Etenesh', 'Genet', 'Hiwot', 'Kidist',
  'Liya', 'Marta', 'Meron', 'Rahel', 'Rediet', 'Saron', 'Selam', 'Tigist',
  'Tsion', 'Hana', 'Mahlet', 'Sena',
];
// Amharic spellings, so every demo driver has the Amharic full name a card needs.
const AM_NAMES: Record<string, string> = {
  Abel: 'አቤል', Abebe: 'አበበ', Alemayehu: 'ዓለማየሁ', Amanuel: 'አማኑኤል', Bekele: 'በቀለ', Berhanu: 'ብርሃኑ',
  Biruk: 'ብሩክ', Dagim: 'ዳግም', Dawit: 'ዳዊት', Elias: 'ኤልያስ', Endalkachew: 'እንዳልካቸው', Eyob: 'ኢዮብ',
  Fikadu: 'ፍቃዱ', Getachew: 'ጌታቸው', Habtamu: 'ሀብታሙ', Henok: 'ሄኖክ', Kaleab: 'ካሌብ', Kebede: 'ከበደ',
  Leul: 'ልዑል', Mulugeta: 'ሙሉጌታ', Natnael: 'ናትናኤል', Samuel: 'ሳሙኤል', Tadesse: 'ታደሰ', Tamrat: 'ታምራት',
  Tesfaye: 'ተስፋዬ', Wondwosen: 'ወንድወሰን', Yared: 'ያሬድ', Yohannes: 'ዮሐንስ', Zerihun: 'ዘሪሁን', Million: 'ሚሊዮን',
  Aster: 'አስቴር', Bethlehem: 'ቤተልሔም', Birtukan: 'ብርቱካን', Eden: 'ኤደን', Etenesh: 'እትነሽ', Genet: 'ገነት',
  Hiwot: 'ሕይወት', Kidist: 'ቅድስት', Liya: 'ሊያ', Marta: 'ማርታ', Meron: 'ሜሮን', Rahel: 'ራሄል',
  Rediet: 'ረድኤት', Saron: 'ሳሮን', Selam: 'ሰላም', Tigist: 'ትግስት', Tsion: 'ጽዮን', Hana: 'ሃና',
  Mahlet: 'ማህሌት', Sena: 'ሰና',
};
const RANKS = [
  'Private', 'Corporal', 'Sergeant', 'Staff Sergeant', 'Warrant Officer',
  'Second Lieutenant', 'Lieutenant', 'Captain', 'Major', 'Civilian Staff',
];
const BLOOD_GROUPS = ['O+', 'A+', 'B+', 'AB+', 'O-', 'A-', 'B-', 'AB-'];
const MEDICAL_FACILITIES = [
  'Armed Forces General Hospital',
  'Defence Referral Clinic',
  'Central Base Medical Post',
  'Air Force Medical Centre',
];
const INCIDENT_PLANS: { severity: IncidentSeverity; description: string; action: string; location: string }[] = [
  { severity: IncidentSeverity.MODERATE, description: 'Vehicle reversed into a fixed barrier at the motor pool.', action: 'Remedial reversing and spotter training', location: 'Central motor pool' },
  { severity: IncidentSeverity.SEVERE, description: 'Collision with a stationary convoy vehicle during night movement.', action: 'Remedial convoy driving course', location: 'Bishoftu road' },
  { severity: IncidentSeverity.MODERATE, description: 'Overspeeding recorded on base perimeter road.', action: 'Speed-discipline briefing', location: 'Base perimeter road' },
  { severity: IncidentSeverity.SEVERE, description: 'Driver operated vehicle with an expired medical clearance.', action: 'Medical re-evaluation required', location: 'Unit compound' },
  { severity: IncidentSeverity.CRITICAL, description: 'Rollover of a loaded cargo vehicle on a gradient.', action: 'Full re-training and re-examination', location: 'Debre Zeit highway' },
  { severity: IncidentSeverity.MODERATE, description: 'Minor collision at a checkpoint gate.', action: 'Defensive driving refresher', location: 'North gate checkpoint' },
  { severity: IncidentSeverity.SEVERE, description: 'Unauthorised use of a unit vehicle outside duty hours.', action: 'Disciplinary review', location: 'City centre' },
];

// Application types used for the extra (non-permit-producing) applications.
const EXTRA_TYPES = [
  ApplicationType.RENEWAL,
  ApplicationType.ADDITIONAL_CATEGORY,
  ApplicationType.REPLACEMENT,
  ApplicationType.REINSTATEMENT,
  ApplicationType.PRE_TRAINED,
  ApplicationType.RENEWAL,
  ApplicationType.REPLACEMENT,
];

function formatStage(status: ApplicationStatus): string {
  switch (status) {
    case ApplicationStatus.SUBMITTED:
      return 'Submitted for Screening';
    case ApplicationStatus.SCREENING:
      return 'Under Administrative Screening';
    case ApplicationStatus.TRAINING_PENDING:
      return 'Awaiting Training Completion';
    case ApplicationStatus.MEDICAL_PENDING:
      return 'Awaiting Medical Fitness Clearance';
    case ApplicationStatus.PENDING_VERIFICATION:
      return 'Awaiting Permit Verification';
    case ApplicationStatus.RETURNED_FOR_CORRECTION:
      return 'Returned for Correction';
    case ApplicationStatus.REJECTED:
      return 'Application Rejected';
    default:
      return status;
  }
}

// Small deterministic PRNG so the dataset is the same on every run.
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261117);
const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
const randInt = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));

const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
function addYears(d: Date, n: number) {
  const r = new Date(d);
  r.setFullYear(r.getFullYear() + n);
  return r;
}
function addMonths(d: Date, n: number) {
  const r = new Date(d);
  r.setMonth(r.getMonth() + n);
  return r;
}
const pad = (n: number, w: number) => String(n).padStart(w, '0');

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------
async function resetDemoData() {
  const users = await prisma.user.findMany({
    where: { serviceNumber: { startsWith: DEMO_PREFIX } },
    select: { id: true, driverProfile: { select: { id: true } } },
  });
  if (users.length === 0) {
    console.log('Reset: no demo drivers found, nothing to delete.');
    return;
  }
  const userIds = users.map((u) => u.id);
  const profileIds = users.flatMap((u) => (u.driverProfile ? [u.driverProfile.id] : []));
  const apps = await prisma.application.findMany({
    where: { driverProfileId: { in: profileIds } },
    select: { id: true },
  });
  const appIds = apps.map((a) => a.id);
  const creds = await prisma.issuedCredential.findMany({
    where: { driverProfileId: { in: profileIds } },
    select: { id: true },
  });
  const credIds = creds.map((c) => c.id);

  await prisma.$transaction([
    prisma.suspensionRecord.deleteMany({ where: { driverProfileId: { in: profileIds } } }),
    prisma.incidentReport.deleteMany({ where: { driverProfileId: { in: profileIds } } }),
    prisma.credentialCategoryItem.deleteMany({ where: { credentialId: { in: credIds } } }),
    prisma.issuedCredential.deleteMany({ where: { id: { in: credIds } } }),
    prisma.applicationApproval.deleteMany({ where: { applicationId: { in: appIds } } }),
    prisma.trainingEnrollment.deleteMany({ where: { driverProfileId: { in: profileIds } } }),
    prisma.examinationRecord.deleteMany({ where: { driverProfileId: { in: profileIds } } }),
    prisma.medicalFitnessReview.deleteMany({ where: { driverProfileId: { in: profileIds } } }),
    prisma.applicationItem.deleteMany({ where: { applicationId: { in: appIds } } }),
    prisma.priorPermit.deleteMany({ where: { applicationId: { in: appIds } } }),
    prisma.application.deleteMany({ where: { id: { in: appIds } } }),
    prisma.nationalLicense.deleteMany({ where: { driverProfileId: { in: profileIds } } }),
    prisma.driverProfile.deleteMany({ where: { id: { in: profileIds } } }),
    prisma.notification.deleteMany({ where: { userId: { in: userIds } } }),
    prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } }),
    prisma.user.deleteMany({ where: { id: { in: userIds } } }),
  ]);
  console.log(`Reset: removed ${users.length} demo drivers and their records.`);
}

// ---------------------------------------------------------------------------
// Sequence helpers (continue after whatever numbers already exist)
// ---------------------------------------------------------------------------
async function lastSeq(
  kind: 'credential' | 'application' | 'incident',
  prefix: string,
): Promise<number> {
  let value: string | undefined;
  if (kind === 'credential') {
    value = (
      await prisma.issuedCredential.findFirst({
        where: { credentialNumber: { startsWith: prefix } },
        orderBy: { credentialNumber: 'desc' },
        select: { credentialNumber: true },
      })
    )?.credentialNumber;
  } else if (kind === 'application') {
    value = (
      await prisma.application.findFirst({
        where: { applicationNumber: { startsWith: prefix } },
        orderBy: { applicationNumber: 'desc' },
        select: { applicationNumber: true },
      })
    )?.applicationNumber;
  } else {
    value = (
      await prisma.incidentReport.findFirst({
        where: { reportNumber: { startsWith: prefix } },
        orderBy: { reportNumber: 'desc' },
        select: { reportNumber: true },
      })
    )?.reportNumber;
  }
  return value ? Number.parseInt(value.replace(prefix, ''), 10) || 0 : 0;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  const resetOnly = args.includes('--reset-only');
  const reset = args.includes('--reset') || resetOnly;

  console.log('--- MoD IDLMS DEMO Seed (100 drivers with permits) ---');

  if (reset) await resetDemoData();
  if (resetOnly) {
    console.log('--- Reset complete (no new data created) ---');
    return;
  }

  // -------- Prerequisites from the base seed --------------------------------
  const units = await prisma.organizationalUnit.findMany({ orderBy: { code: 'asc' } });
  const categories = await prisma.vehicleCategory.findMany({
    where: { isActive: true },
    orderBy: { code: 'asc' },
  });
  const courses = await prisma.trainingCourse.findMany();
  const staff = await prisma.user.findMany({
    where: {
      serviceNumber: {
        in: ['MOD-LIC-001', 'MOD-CMDR-001', 'MOD-ISSUER-001', 'MOD-EXAM-001', 'MOD-MED-001', 'MOD-COORD-001', 'MOD-INST-001'],
      },
    },
  });
  const byService = new Map(staff.map((u) => [u.serviceNumber, u]));
  const lic = byService.get('MOD-LIC-001');
  const cmdr = byService.get('MOD-CMDR-001');
  const issuer = byService.get('MOD-ISSUER-001');
  const examiner = byService.get('MOD-EXAM-001');
  const medic = byService.get('MOD-MED-001');
  const coord = byService.get('MOD-COORD-001');

  if (units.length === 0 || categories.length === 0 || !lic || !cmdr || !issuer || !examiner || !medic || !coord) {
    throw new Error(
      'Base data is missing. Run the base seed first:  npm run prisma:seed   then re-run this demo seed.',
    );
  }
  console.log(`Using ${units.length} organizational units and ${categories.length} vehicle categories.`);

  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);
  const now = new Date();
  const year = now.getFullYear();

  let credSeq = await lastSeq('credential', `MOD-AUTH-${year}-`);
  let appSeq = await lastSeq('application', `APP-${year}-`);
  let incSeq = await lastSeq('incident', `INC-${year}-`);

  const counters: Record<string, number> = {};
  const bump = (k: string) => (counters[k] = (counters[k] || 0) + 1);

  let created = 0;
  let skipped = 0;
  let expiringIdx = 0;
  let suspendedIdx = 0;
  let personnelIdx = 0;

  for (let i = 0; i < TOTAL; i++) {
    const n = i + 1;
    const serviceNumber = `${DEMO_PREFIX}${pad(n, 3)}`;

    const existing = await prisma.user.findUnique({ where: { serviceNumber } });
    if (existing) {
      skipped++;
      continue;
    }

    const scenario = scenarioFor(i);

    // ---- Identity ----------------------------------------------------------
    const gender: Gender = rand() < 0.72 ? Gender.MALE : Gender.FEMALE;
    const firstName = gender === Gender.MALE ? pick(MALE_NAMES) : pick(FEMALE_NAMES);
    const middleName = pick(MALE_NAMES); // father's name
    const lastName = pick(MALE_NAMES); // grandfather's name
    const fullName = `${firstName} ${middleName} ${lastName}`;
    const fullNameAm = [firstName, middleName, lastName].map((n) => AM_NAMES[n]).join(' ');
    const unit = units[i % units.length]; // spread evenly over every unit
    const rank = pick(RANKS);

    // ---- Categories: 1 for most, 2 for every 4th, 3 for every 11th ---------
    const catIdx = new Set<number>([i % categories.length]);
    if (i % 4 === 0) catIdx.add((i + 2) % categories.length);
    if (i % 11 === 0) catIdx.add((i + 3) % categories.length);
    const driverCats = [...catIdx].map((x) => categories[x]);
    const validityYears = Math.min(...driverCats.map((c) => c.validityYears));
    const maxMinAge = Math.max(...driverCats.map((c) => c.minAgeRequired));

    // Age always satisfies every category's minimum age.
    const age = maxMinAge + randInt(1, 18);
    const dob = new Date(year - age, randInt(0, 11), randInt(1, 28));

    // ---- Permit dates for the scenario -------------------------------------
    let expiryDate: Date;
    switch (scenario) {
      case 'EXPIRING_SOON':
        expiryDate = addDays(now, EXPIRING_DAYS[expiringIdx++ % EXPIRING_DAYS.length]);
        break;
      case 'EXPIRED_SWEPT': {
        // Spread from 5 days to ~14 months ago.
        const ago = [5, 20, 45, 75, 110, 160, 220, 290, 360, 430][i - 70];
        expiryDate = addDays(now, -ago);
        break;
      }
      case 'EXPIRED_UNSWEPT':
        expiryDate = addDays(now, -[1, 3, 6, 11, 18][i - 80]);
        break;
      case 'SUSPENDED':
      case 'REVOKED':
        expiryDate = addMonths(now, randInt(6, validityYears * 12 - 1));
        break;
      default: // VALID, VALID_PERSONNEL_CHANGE: always more than 90 days left
        expiryDate = addMonths(now, randInt(4, validityYears * 12 - 1));
    }
    const issueDate = addYears(expiryDate, -validityYears);

    // Application journey timeline (medical first, then training, then exams).
    const appCreatedAt = addDays(issueDate, -75);
    const medicalDate = addDays(issueDate, -65);
    const trainingDone = addDays(issueDate, -40);
    const examDate = addDays(issueDate, -25);
    const approvalDate = addDays(issueDate, -3);

    // ---- Medical outcome: every 5th driver has restrictions ----------------
    const restricted = i % 5 === 2;
    const restrictions = restricted
      ? pick([['CORRECTIVE_LENSES'], ['DAYTIME_ONLY'], ['CORRECTIVE_LENSES', 'DAYTIME_ONLY']])
      : [];

    // ---- Personnel status --------------------------------------------------
    let personnelStatus: PersonnelStatus = PersonnelStatus.ACTIVE;
    if (scenario === 'SUSPENDED') personnelStatus = PersonnelStatus.SUSPENDED;
    if (scenario === 'VALID_PERSONNEL_CHANGE') personnelStatus = PERSONNEL_CHANGE[personnelIdx++ % PERSONNEL_CHANGE.length];

    // ---- Credential status -------------------------------------------------
    let credStatus: CredentialStatus = CredentialStatus.ACTIVE;
    if (scenario === 'EXPIRED_SWEPT') credStatus = CredentialStatus.EXPIRED;
    if (scenario === 'SUSPENDED') credStatus = CredentialStatus.SUSPENDED;
    if (scenario === 'REVOKED') credStatus = CredentialStatus.REVOKED;

    const credentialNumber = `MOD-AUTH-${year}-${pad(++credSeq, 4)}`;
    const serialNumber = `SN-MOD-${year}-${crypto
      .createHash('sha1')
      .update(serviceNumber)
      .digest('hex')
      .slice(0, 6)
      .toUpperCase()}`;
    const qrHashSignature = signCredentialPayload(
      {
        cred: credentialNumber,
        serial: serialNumber,
        drv: serviceNumber,
        name: `${firstName} ${middleName} ${lastName}`,
        nameAm: fullNameAm,
        rank,
        cats: driverCats.map((c) => c.code),
        iss: issueDate.toISOString(),
        exp: expiryDate.toISOString(),
      },
    );
    const applicationNumber = `APP-${year}-${pad(++appSeq, 5)}`;

    const emergencyName = `${pick(FEMALE_NAMES)} ${middleName}`;
    const phone = `+2519${20000000 + n * 100003}`;
    const emergencyPhone = `+2519${50000000 + n * 100019}`;

    await prisma.$transaction(
      async (tx) => {
        // 1. Account + fully complete driver profile
        const user = await tx.user.create({
          data: {
            serviceNumber,
            email: `demo${pad(n, 3)}@mod.gov.et`,
            fullName,
            firstName,
            middleName,
            lastName,
            rank,
            phone,
            passwordHash,
            roles: [SystemRole.STAFF_DRIVER],
            unitId: unit.id,
            isActive: personnelStatus === PersonnelStatus.ACTIVE || personnelStatus === PersonnelStatus.ON_LEAVE,
            mustChangePassword: false,
            passwordChangedAt: addDays(appCreatedAt, -5),
            preferredLocale: i % 7 === 0 ? 'am' : 'en',
            createdAt: addDays(appCreatedAt, -10),
          },
        });

        const profile = await tx.driverProfile.create({
          data: {
            userId: user.id,
            serviceNumber,
            fullName,
            fullNameAm,
            firstName,
            middleName,
            lastName,
            rank,
            gender,
            nationalIdNumber: `FAN-${pad(100000000000 + n * 7919, 12)}`,
            dateOfBirth: dob,
            bloodGroup: pick(BLOOD_GROUPS),
            contactPhone: phone,
            emergencyContactName: emergencyName,
            emergencyContactPhone: emergencyPhone,
            unitId: unit.id,
            personnelStatus,
            identityVerifiedAt: addDays(appCreatedAt, -3),
            identityVerifiedBy: lic.id,
            profileStatus: 'COMPLETE',
            profileCompletedAt: addDays(appCreatedAt, -4),
            selfEnteredFields: [],
            createdAt: addDays(appCreatedAt, -10),
          },
        });

        // 2. National licence (verified) for roughly 40% of drivers
        if (i % 5 < 2) {
          const nlIssued = addYears(now, -randInt(2, 8));
          await tx.nationalLicense.create({
            data: {
              driverProfileId: profile.id,
              licenseNumber: `NDL-${pad(400000 + n * 37, 7)}`,
              issuingAuthority: 'Federal Transport Authority',
              categories: [pick(['Category 1', 'Category 2', 'Category 3'])],
              issuedDate: nlIssued,
              expiryDate: addYears(nlIssued, 5) > now ? addYears(nlIssued, 5) : addYears(now, 1),
              verificationStatus: VerificationStatus.VERIFIED,
              verifiedAt: addDays(appCreatedAt, -2),
              verifiedByUserId: lic.id,
              verificationNotes: 'Verified against Federal Transport Authority register.',
            },
          });
        }

        // 3. The approved application (this is what the permit was issued from)
        const application = await tx.application.create({
          data: {
            applicationNumber,
            driverProfileId: profile.id,
            type: ApplicationType.NEW_AUTHORIZATION,
            status: ApplicationStatus.APPROVED,
            currentStage: `Credential Issued — ${credentialNumber}`,
            createdById: coord.id,
            createdAt: appCreatedAt,
            requestedCategories: {
              create: driverCats.map((c) => ({ categoryId: c.id })),
            },
          },
        });

        await tx.applicationApproval.createMany({
          data: [
            {
              applicationId: application.id,
              officerUserId: lic.id,
              action: ApprovalAction.RECOMMENDED,
              comments: 'Documents verified; eligibility confirmed.',
              decisionDate: addDays(approvalDate, -2),
            },
            {
              applicationId: application.id,
              officerUserId: cmdr.id,
              action: ApprovalAction.APPROVED,
              comments: 'Approved for permit issuance.',
              decisionDate: approvalDate,
            },
          ],
        });

        // 4. Medical clearance (first stage after screening)
        await tx.medicalFitnessReview.create({
          data: {
            driverProfileId: profile.id,
            applicationId: application.id,
            medicalFacility: MEDICAL_FACILITIES[i % MEDICAL_FACILITIES.length],
            reviewerBadgeNumber: 'MED-001',
            outcome: restricted ? MedicalFitnessOutcome.FIT_WITH_RESTRICTIONS : MedicalFitnessOutcome.FIT,
            operationalRestrictions: restrictions,
            assessmentDate: medicalDate,
            reviewDueDate: addYears(medicalDate, validityYears),
            createdAt: medicalDate,
          },
        });

        // 5. Training + exams for every category on the permit
        for (const cat of driverCats) {
          const course = courses.find((c) => c.categoryCodes.includes(cat.code));
          if (course) {
            await tx.trainingEnrollment.create({
              data: {
                driverProfileId: profile.id,
                applicationId: application.id,
                courseId: course.id,
                categoryCode: cat.code,
                hoursAttended: course.durationHours,
                status: CourseStatus.COMPLETED,
                completionDate: trainingDone,
                createdAt: addDays(trainingDone, -course.durationDays),
              },
            });
          }
          await tx.examinationRecord.createMany({
            data: [
              {
                driverProfileId: profile.id,
                applicationId: application.id,
                examType: ExamType.THEORETICAL,
                categoryCode: cat.code,
                scorePercent: randInt(72, 98),
                outcome: ExamOutcome.PASS,
                examinerUserId: examiner.id,
                isLocked: true,
                examDate,
              },
              {
                driverProfileId: profile.id,
                applicationId: application.id,
                examType: ExamType.PRACTICAL,
                categoryCode: cat.code,
                scorePercent: randInt(70, 97),
                outcome: ExamOutcome.PASS,
                examinerUserId: examiner.id,
                isLocked: true,
                examDate: addDays(examDate, 2),
              },
            ],
          });
        }

        // 5b. Permit state details
        const printed = true; // every demo permit was already printed and handed over
        const revokedAt = scenario === 'REVOKED' ? addDays(now, -randInt(10, 120)) : null;

        const credential = await tx.issuedCredential.create({
          data: {
            credentialNumber,
            driverProfileId: profile.id,
            serialNumber,
            issueDate,
            expiryDate,
            status: credStatus,
            qrHashSignature,
            issuerUserId: issuer.id,
            activeRestrictions: restrictions,
            cardIssued: true,
            printCount: printed ? 1 : 0,
            printedAt: printed ? addDays(issueDate, 1) : null,
            printedById: printed ? issuer.id : null,
            revokedAt,
            revokedById: revokedAt ? cmdr.id : null,
            revocationLegalBasis: revokedAt ? 'MoD Driving Regulation, Art. 27 (gross misconduct)' : null,
            revocationReason: revokedAt ? 'Permanent revocation following a substantiated serious safety violation.' : null,
            createdAt: issueDate,
            categories: {
              create: driverCats.map((c) => ({ categoryId: c.id, endorsementDate: issueDate })),
            },
          },
        });

        // 6. Suspension + incident for suspended / revoked drivers
        if (scenario === 'SUSPENDED' || scenario === 'REVOKED') {
          const plan = INCIDENT_PLANS[(suspendedIdx++) % INCIDENT_PLANS.length];
          const incidentDate = addDays(now, -randInt(20, 150));
          await tx.incidentReport.create({
            data: {
              reportNumber: `INC-${year}-${pad(++incSeq, 4)}`,
              driverProfileId: profile.id,
              incidentDate,
              location: plan.location,
              severity: plan.severity,
              status: InvestigationStatus.SUBSTANTIATED,
              description: plan.description,
              correctiveAction: plan.action,
              remedialCompleted: false,
              createdAt: incidentDate,
            },
          });
          await tx.suspensionRecord.create({
            data: {
              driverProfileId: profile.id,
              credentialId: credential.id,
              legalBasis: 'MoD Driving Regulation, Art. 14 (suspension pending investigation)',
              reason: plan.description,
              startDate: addDays(incidentDate, 2),
              reviewDate: scenario === 'SUSPENDED' ? addDays(now, randInt(5, 60)) : null,
              revokedAt,
              authorizedById: cmdr.id,
              isActive: scenario === 'SUSPENDED',
              createdAt: addDays(incidentDate, 2),
            },
          });
        }

        // 7. Extra applications of OTHER types, spread over the last 12 months
        //    (feeds the "Applications by Type" dashboard chart). They are all
        //    still open or closed-without-permit, so they never change the
        //    permit states created above. Recent months get more of them.
        const extraCount = i % 6 === 0 ? 3 : i % 2 === 0 ? 2 : i % 3 === 0 ? 1 : 0;
        for (let k = 0; k < extraCount; k++) {
          const type = EXTRA_TYPES[(i + k) % EXTRA_TYPES.length];
          const createdAt = addDays(now, -Math.floor(Math.pow(rand(), 1.5) * 360) - 1);
          const heldIds = new Set(driverCats.map((c) => c.id));
          const notHeld = categories.find((c) => !heldIds.has(c.id));

          let status: ApplicationStatus;
          let stage: string;
          const extra: Record<string, unknown> = {};
          let categoryId = driverCats[0].id;

          switch (type) {
            case ApplicationType.RENEWAL:
              status = pick([ApplicationStatus.SUBMITTED, ApplicationStatus.SCREENING, ApplicationStatus.MEDICAL_PENDING]);
              break;
            case ApplicationType.ADDITIONAL_CATEGORY:
              if (!notHeld) continue; // already holds every category
              categoryId = notHeld.id;
              status = pick([ApplicationStatus.SCREENING, ApplicationStatus.MEDICAL_PENDING, ApplicationStatus.TRAINING_PENDING]);
              extra.replacesCredentialId = credential.id;
              break;
            case ApplicationType.REPLACEMENT:
              status = pick([ApplicationStatus.SUBMITTED, ApplicationStatus.SCREENING, ApplicationStatus.REJECTED]);
              extra.replacesCredentialId = credential.id;
              extra.replacementReason = pick(['LOST', 'STOLEN', 'DAMAGED']);
              break;
            case ApplicationType.REINSTATEMENT:
              status = pick([ApplicationStatus.SCREENING, ApplicationStatus.MEDICAL_PENDING, ApplicationStatus.RETURNED_FOR_CORRECTION]);
              break;
            default: // PRE_TRAINED
              status = pick([ApplicationStatus.PENDING_VERIFICATION, ApplicationStatus.REJECTED]);
          }
          stage = formatStage(status);

          const extraApp = await tx.application.create({
            data: {
              applicationNumber: `APP-${year}-${pad(++appSeq, 5)}`,
              driverProfileId: profile.id,
              type,
              status,
              currentStage: stage,
              rejectionReason: status === ApplicationStatus.REJECTED ? 'Documents did not meet the requirements.' : null,
              createdById: coord.id,
              createdAt,
              ...extra,
              requestedCategories: { create: [{ categoryId }] },
            },
          });

          if (type === ApplicationType.PRE_TRAINED) {
            await tx.priorPermit.create({
              data: {
                applicationId: extraApp.id,
                permitNumber: `PRE-DEMO-${pad(n, 3)}-${k + 1}`,
                issueDate: addYears(createdAt, -2),
                expiryDate: addYears(createdAt, 1),
                trainingReference: `TRN-REF-${pad(n, 3)}`,
              },
            });
          }
        }
      },
      { timeout: 30000, maxWait: 30000 },
    );

    bump(scenario);
    created++;
    if (created % 10 === 0) console.log(`  ... ${created} drivers created`);
  }

  console.log('');
  console.log(`Created ${created} demo drivers (skipped ${skipped} that already existed).`);
  console.log('Permit states created:');
  for (const [k, v] of Object.entries(counters)) console.log(`  ${k.padEnd(24)} ${v}`);
  console.log('');
  console.log(`Log in as any driver:  ${DEMO_PREFIX}001 ... ${DEMO_PREFIX}${pad(TOTAL, 3)}   password: ${DEFAULT_PASSWORD}`);
  console.log('Tip: the nightly expiry job will flip the 5 EXPIRED_UNSWEPT permits to EXPIRED when it runs.');
  console.log('--- Demo Seed Completed Successfully! ---');
}

main()
  .catch((e) => {
    console.error('Demo seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
