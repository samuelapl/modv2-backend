import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { TransformInterceptor } from './../src/common/interceptors/transform.interceptor';
import { AllExceptionsFilter } from './../src/common/filters/http-exception.filter';

import { completeDriver } from './helpers/driver-payload';
import { SEED_PASSWORD } from './../prisma/seed-password';
describe('Medical Fitness & Privacy Workflow (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let coordToken: string;
  let licToken: string;
  let trnToken: string;
  let instToken: string;
  let examToken: string;
  let medToken: string;
  let coordUnitId: string;
  let catSpId: string;
  let courseSpId: string;
  let createdDriverId: string;
  let createdAppId: string;
  let createdEnrollmentId: string;

  const suffix = Date.now();
  const testServiceNum = `MOD-MED-E2E-${suffix}`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalInterceptors(new TransformInterceptor());
    await app.init();

    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    if (createdAppId) {
      await prisma.medicalFitnessReview.deleteMany({
        where: { applicationId: createdAppId },
      });
      await prisma.examinationRecord.deleteMany({
        where: { applicationId: createdAppId },
      });
      await prisma.trainingEnrollment.deleteMany({
        where: { applicationId: createdAppId },
      });
      await prisma.applicationApproval.deleteMany({
        where: { applicationId: createdAppId },
      });
      await prisma.applicationItem.deleteMany({
        where: { applicationId: createdAppId },
      });
      await prisma.application.deleteMany({ where: { id: createdAppId } });
    }
    if (createdDriverId) {
      await prisma.medicalFitnessReview.deleteMany({
        where: { driverProfileId: createdDriverId },
      });
      await prisma.examinationRecord.deleteMany({
        where: { driverProfileId: createdDriverId },
      });
      const drv = await prisma.driverProfile.findUnique({
        where: { id: createdDriverId },
      });
      await prisma.driverProfile.deleteMany({ where: { id: createdDriverId } });
      if (drv?.userId) {
        await prisma.user.deleteMany({ where: { id: drv.userId } });
      }
    }
    await app.close();
  });

  it('Advances an application to MEDICAL_PENDING via Screening, Training, and Exams', async () => {
    const [rCoord, rLic, rTrn, rInst, rExam, rMed] = await Promise.all([
      request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ serviceNumber: 'MOD-COORD-001', password: SEED_PASSWORD })
        .expect(200),
      request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ serviceNumber: 'MOD-LIC-001', password: SEED_PASSWORD })
        .expect(200),
      request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ serviceNumber: 'MOD-TRN-001', password: SEED_PASSWORD })
        .expect(200),
      request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ serviceNumber: 'MOD-INST-001', password: SEED_PASSWORD })
        .expect(200),
      request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ serviceNumber: 'MOD-EXAM-001', password: SEED_PASSWORD })
        .expect(200),
      request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ serviceNumber: 'MOD-MED-001', password: SEED_PASSWORD })
        .expect(200),
    ]);

    coordToken = rCoord.body.data.accessToken;
    coordUnitId = rCoord.body.data.user.unitId;
    licToken = rLic.body.data.accessToken;
    trnToken = rTrn.body.data.accessToken;
    instToken = rInst.body.data.accessToken;
    examToken = rExam.body.data.accessToken;
    medToken = rMed.body.data.accessToken;

    const catsRes = await request(app.getHttpServer())
      .get('/api/v1/categories')
      .set('Authorization', `Bearer ${coordToken}`)
      .expect(200);
    catSpId = catsRes.body.data.find((c: any) => c.code === 'CAT-SP').id;

    const coursesRes = await request(app.getHttpServer())
      .get('/api/v1/training/courses')
      .set('Authorization', `Bearer ${trnToken}`)
      .expect(200);
    courseSpId = coursesRes.body.data.find(
      (c: any) => c.courseCode === 'TRN-SP-01',
    ).id;

    const drvRes = await request(app.getHttpServer())
      .post('/api/v1/personnel/drivers')
      .set('Authorization', `Bearer ${coordToken}`)
      .send(completeDriver({
        serviceNumber: testServiceNum,
        firstName: 'Abebe',
        middleName: 'Bikila',
        lastName: 'Medical',
        dateOfBirth: '1990-02-20',
        unitId: coordUnitId,
      }))
      .expect(201);
    createdDriverId = drvRes.body.data.id;

    const appRes = await request(app.getHttpServer())
      .post('/api/v1/applications')
      .set('Authorization', `Bearer ${coordToken}`)
      .send({
        driverProfileId: createdDriverId,
        type: 'NEW_AUTHORIZATION',
        categoryIds: [catSpId],
      })
      .expect(201);
    createdAppId = appRes.body.data.id;

    await request(app.getHttpServer())
      .patch(`/api/v1/applications/${createdAppId}/screen`)
      .set('Authorization', `Bearer ${licToken}`)
      .send({ action: 'ADVANCE_STAGE', comments: 'To training' })
      .expect(200);

    const enrRes = await request(app.getHttpServer())
      .post('/api/v1/training/enrollments')
      .set('Authorization', `Bearer ${trnToken}`)
      .send({
        driverProfileId: createdDriverId,
        courseId: courseSpId,
        applicationId: createdAppId,
      })
      .expect(201);
    createdEnrollmentId = enrRes.body.data.id;

    await request(app.getHttpServer())
      .patch(`/api/v1/training/enrollments/${createdEnrollmentId}/attendance`)
      .set('Authorization', `Bearer ${instToken}`)
      .send({ hoursAttended: 24, status: 'COMPLETED' })
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/v1/examinations')
      .set('Authorization', `Bearer ${examToken}`)
      .send({
        driverProfileId: createdDriverId,
        applicationId: createdAppId,
        examType: 'THEORETICAL',
        categoryCode: 'CAT-SP',
        scorePercent: 90,
        outcome: 'PASS',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/v1/examinations')
      .set('Authorization', `Bearer ${examToken}`)
      .send({
        driverProfileId: createdDriverId,
        applicationId: createdAppId,
        examType: 'PRACTICAL',
        categoryCode: 'CAT-SP',
        outcome: 'PASS',
      })
      .expect(201);
  });

  it('Enforces privacy rules, uploads medical proof, and advances MEDICAL_PENDING to READY_FOR_APPROVAL', async () => {
    const queueRes = await request(app.getHttpServer())
      .get('/api/v1/medical/candidates')
      .set('Authorization', `Bearer ${medToken}`)
      .expect(200);
    expect(
      queueRes.body.data.items.some((i: any) => i.id === createdAppId),
    ).toBe(true);

    // Non-allowlisted free text restriction rejected -> 400
    await request(app.getHttpServer())
      .post('/api/v1/medical')
      .set('Authorization', `Bearer ${medToken}`)
      .send({
        driverProfileId: createdDriverId,
        applicationId: createdAppId,
        medicalFacility: 'Armed Forces Comprehensive Specialized Hospital',
        reviewerBadgeNumber: 'MED-OF-4410',
        outcome: 'FIT_WITH_RESTRICTIONS',
        operationalRestrictions: ['MYOPIA_CLINICAL_DIAGNOSIS'],
        assessmentDate: '2026-11-10',
        reviewDueDate: '2029-11-10',
      })
      .expect(400);

    const fakePdf = Buffer.from('%PDF-1.4\n%MedClearance\n', 'utf8');
    const uploadRes = await request(app.getHttpServer())
      .post('/api/v1/storage/upload?bucket=medical-documents')
      .set('Authorization', `Bearer ${medToken}`)
      .attach('file', fakePdf, 'fitness-cert.pdf')
      .expect(201);

    const createRes = await request(app.getHttpServer())
      .post('/api/v1/medical')
      .set('Authorization', `Bearer ${medToken}`)
      .send({
        driverProfileId: createdDriverId,
        applicationId: createdAppId,
        medicalFacility: 'Armed Forces Comprehensive Specialized Hospital',
        reviewerBadgeNumber: 'MED-OF-4410',
        outcome: 'FIT_WITH_RESTRICTIONS',
        operationalRestrictions: ['CORRECTIVE_LENSES'],
        assessmentDate: '2026-11-10',
        reviewDueDate: '2029-11-10',
        documentProofUrl: uploadRes.body.data.objectKey,
      })
      .expect(201);

    expect(createRes.body.data.outcome).toBe('FIT_WITH_RESTRICTIONS');
    expect(createRes.body.data.operationalRestrictions).toEqual([
      'CORRECTIVE_LENSES',
    ]);

    // Licensing Admin sees sanitized outcome without raw proof URL or badge
    const licMedList = await request(app.getHttpServer())
      .get(`/api/v1/medical?driverProfileId=${createdDriverId}`)
      .set('Authorization', `Bearer ${licToken}`)
      .expect(200);
    expect(licMedList.body.data.items[0].documentProofUrl).toBeUndefined();
    expect(licMedList.body.data.items[0].reviewerBadgeNumber).toBeUndefined();
    expect(licMedList.body.data.items[0].operationalRestrictions).toEqual([
      'CORRECTIVE_LENSES',
    ]);

    const appCheck = await request(app.getHttpServer())
      .get(`/api/v1/applications/${createdAppId}`)
      .set('Authorization', `Bearer ${licToken}`)
      .expect(200);
    expect(appCheck.body.data.status).toBe('READY_FOR_APPROVAL');
    expect(appCheck.body.data.medicalReviews[0].operationalRestrictions).toEqual([
      'CORRECTIVE_LENSES',
    ]);
  });
});
