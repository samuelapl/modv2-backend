import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { TransformInterceptor } from './../src/common/interceptors/transform.interceptor';
import { AllExceptionsFilter } from './../src/common/filters/http-exception.filter';

import { completeDriver } from './helpers/driver-payload';
import { SEED_PASSWORD } from './../prisma/seed-password';
describe('Training & Attendance Workflow (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let coordToken: string;
  let licToken: string;
  let trnAdminToken: string;
  let instructorToken: string;
  let coordUnitId: string;
  let createdDriverId: string;
  let createdLicenseId: string;
  let createdAppId: string;
  let createdEnrollmentId: string;
  let catHvId: string;
  let courseHvId: string;
  let uploadedCertKey: string;

  const suffix = Date.now();
  const testServiceNum = `MOD-TRN-E2E-${suffix}`;
  const testLicenseNum = `ETH-TRN-E2E-${suffix}`;

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
    if (createdEnrollmentId) {
      await prisma.trainingEnrollment.deleteMany({
        where: { id: createdEnrollmentId },
      });
    }
    if (createdAppId) {
      await prisma.applicationApproval.deleteMany({
        where: { applicationId: createdAppId },
      });
      await prisma.applicationItem.deleteMany({
        where: { applicationId: createdAppId },
      });
      await prisma.application.deleteMany({
        where: { id: createdAppId },
      });
    }
    if (createdLicenseId) {
      await prisma.nationalLicense.deleteMany({
        where: { id: createdLicenseId },
      });
    }
    if (createdDriverId) {
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

  it('Authenticates actors and prepares a TRAINING_PENDING application', async () => {
    const [resCoord, resLic, resTrn, resInst] = await Promise.all([
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
    ]);

    coordToken = resCoord.body.data.accessToken;
    coordUnitId = resCoord.body.data.user.unitId;
    licToken = resLic.body.data.accessToken;
    trnAdminToken = resTrn.body.data.accessToken;
    instructorToken = resInst.body.data.accessToken;

    const catsRes = await request(app.getHttpServer())
      .get('/api/v1/categories')
      .set('Authorization', `Bearer ${coordToken}`)
      .expect(200);
    catHvId = catsRes.body.data.find((c: any) => c.code === 'CAT-HV').id;

    const coursesRes = await request(app.getHttpServer())
      .get('/api/v1/training/courses')
      .set('Authorization', `Bearer ${instructorToken}`)
      .expect(200);
    const hvCourse = coursesRes.body.data.find(
      (c: any) => c.courseCode === 'TRN-HV-01',
    );
    expect(hvCourse).toBeDefined();
    courseHvId = hvCourse.id;

    const drvRes = await request(app.getHttpServer())
      .post('/api/v1/personnel/drivers')
      .set('Authorization', `Bearer ${coordToken}`)
      .send(completeDriver({
        serviceNumber: testServiceNum,
        firstName: 'Abebe',
        middleName: 'Bikila',
        lastName: 'Training',
        dateOfBirth: '1992-07-01',
        unitId: coordUnitId,
      }))
      .expect(201);
    createdDriverId = drvRes.body.data.id;

    const nlRes = await request(app.getHttpServer())
      .post('/api/v1/national-license')
      .set('Authorization', `Bearer ${coordToken}`)
      .send({
        driverProfileId: createdDriverId,
        licenseNumber: testLicenseNum,
        issuingAuthority: 'Federal Transport Authority (FTA)',
        categories: ['Auto', 'Derek 2'],
        issuedDate: '2024-01-01',
        expiryDate: '2030-01-01',
      })
      .expect(201);
    createdLicenseId = nlRes.body.data.id;

    await request(app.getHttpServer())
      .patch(`/api/v1/national-license/${createdLicenseId}/verify`)
      .set('Authorization', `Bearer ${licToken}`)
      .send({ status: 'VERIFIED', verificationNotes: 'Verified' })
      .expect(200);

    const appRes = await request(app.getHttpServer())
      .post('/api/v1/applications')
      .set('Authorization', `Bearer ${coordToken}`)
      .send({
        driverProfileId: createdDriverId,
        type: 'NEW_AUTHORIZATION',
        categoryIds: [catHvId],
      })
      .expect(201);
    createdAppId = appRes.body.data.id;

    const screenRes = await request(app.getHttpServer())
      .patch(`/api/v1/applications/${createdAppId}/screen`)
      .set('Authorization', `Bearer ${licToken}`)
      .send({ action: 'ADVANCE_STAGE', comments: 'Cleared for training' })
      .expect(200);
    expect(screenRes.body.data.status).toBe('TRAINING_PENDING');
  });

  it('Enrolls candidate, uploads certificate, logs hours, and auto-advances application to EXAM_PENDING', async () => {
    const enrollRes = await request(app.getHttpServer())
      .post('/api/v1/training/enrollments')
      .set('Authorization', `Bearer ${trnAdminToken}`)
      .send({
        driverProfileId: createdDriverId,
        courseId: courseHvId,
        applicationId: createdAppId,
        notes: 'Batch A Convoy Training',
      })
      .expect(201);
    createdEnrollmentId = enrollRes.body.data.id;
    expect(enrollRes.body.data.status).toBe('IN_PROGRESS');

    const fakePdf = Buffer.from('%PDF-1.4\n%E2E-Certificate\n', 'utf8');
    const uploadRes = await request(app.getHttpServer())
      .post('/api/v1/storage/upload?bucket=certificates')
      .set('Authorization', `Bearer ${instructorToken}`)
      .attach('file', fakePdf, 'training-cert.pdf')
      .expect(201);
    uploadedCertKey = uploadRes.body.data.objectKey;

    // Premature completion (< 40h) rejected -> 400
    await request(app.getHttpServer())
      .patch(`/api/v1/training/enrollments/${createdEnrollmentId}/attendance`)
      .set('Authorization', `Bearer ${instructorToken}`)
      .send({
        hoursAttended: 16,
        status: 'COMPLETED',
      })
      .expect(400);

    // Full 40h + certificate + COMPLETED -> 200 & advances parent application
    const completeRes = await request(app.getHttpServer())
      .patch(`/api/v1/training/enrollments/${createdEnrollmentId}/attendance`)
      .set('Authorization', `Bearer ${instructorToken}`)
      .send({
        hoursAttended: 40,
        status: 'COMPLETED',
        certificateUrl: uploadedCertKey,
        notes: 'Passed heavy vehicle convoy hours.',
      })
      .expect(200);

    expect(completeRes.body.data.status).toBe('COMPLETED');
    expect(completeRes.body.data.hoursAttended).toBe(40);
    expect(completeRes.body.data.instructorId).toBe('MOD-INST-001');

    const appCheckRes = await request(app.getHttpServer())
      .get(`/api/v1/applications/${createdAppId}`)
      .set('Authorization', `Bearer ${licToken}`)
      .expect(200);
    expect(appCheckRes.body.data.status).toBe('EXAM_PENDING');
  });
});
