import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { TransformInterceptor } from './../src/common/interceptors/transform.interceptor';
import { AllExceptionsFilter } from './../src/common/filters/http-exception.filter';

import { completeDriver } from './helpers/driver-payload';
describe('Examinations & Locked Scoring Workflow (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let coordToken: string;
  let licToken: string;
  let trnToken: string;
  let instToken: string;
  let examToken: string;
  let coordUnitId: string;
  let catSpId: string;
  let courseSpId: string;
  let createdDriverId: string;
  let createdAppId: string;
  let createdEnrollmentId: string;

  const suffix = Date.now();
  const testServiceNum = `MOD-EXM-E2E-${suffix}`;

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

  it('Prepares an EXAM_PENDING application via Screening and Training completion', async () => {
    const [rCoord, rLic, rTrn, rInst, rExam] = await Promise.all([
      request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ serviceNumber: 'MOD-COORD-001', password: 'MoD@2026!' })
        .expect(200),
      request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ serviceNumber: 'MOD-LIC-001', password: 'MoD@2026!' })
        .expect(200),
      request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ serviceNumber: 'MOD-TRN-001', password: 'MoD@2026!' })
        .expect(200),
      request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ serviceNumber: 'MOD-INST-001', password: 'MoD@2026!' })
        .expect(200),
      request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ serviceNumber: 'MOD-EXAM-001', password: 'MoD@2026!' })
        .expect(200),
    ]);

    coordToken = rCoord.body.data.accessToken;
    coordUnitId = rCoord.body.data.user.unitId;
    licToken = rLic.body.data.accessToken;
    trnToken = rTrn.body.data.accessToken;
    instToken = rInst.body.data.accessToken;
    examToken = rExam.body.data.accessToken;

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
        lastName: 'Examcand',
        dateOfBirth: '1991-03-15',
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
      .send({ action: 'ADVANCE_STAGE', comments: 'Advance to training' })
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
  });

  it('Enforces locked Theory/Practical rules and auto-advances EXAM_PENDING to MEDICAL_PENDING', async () => {
    const queueRes = await request(app.getHttpServer())
      .get('/api/v1/examinations/candidates')
      .set('Authorization', `Bearer ${examToken}`)
      .expect(200);
    expect(
      queueRes.body.data.items.some((i: any) => i.id === createdAppId),
    ).toBe(true);

    // Passing below 75% rejected -> 400
    await request(app.getHttpServer())
      .post('/api/v1/examinations')
      .set('Authorization', `Bearer ${examToken}`)
      .send({
        driverProfileId: createdDriverId,
        applicationId: createdAppId,
        examType: 'THEORETICAL',
        categoryCode: 'CAT-SP',
        scorePercent: 65,
        outcome: 'PASS',
      })
      .expect(400);

    // Failed attempt saved immutably -> 201
    await request(app.getHttpServer())
      .post('/api/v1/examinations')
      .set('Authorization', `Bearer ${examToken}`)
      .send({
        driverProfileId: createdDriverId,
        applicationId: createdAppId,
        examType: 'THEORETICAL',
        categoryCode: 'CAT-SP',
        scorePercent: 60,
        outcome: 'FAIL',
        notes: 'Need to review night convoy signals.',
      })
      .expect(201);

    // Retake Theory PASS -> 201
    const theoryPass = await request(app.getHttpServer())
      .post('/api/v1/examinations')
      .set('Authorization', `Bearer ${examToken}`)
      .send({
        driverProfileId: createdDriverId,
        applicationId: createdAppId,
        examType: 'THEORETICAL',
        categoryCode: 'CAT-SP',
        scorePercent: 88,
        outcome: 'PASS',
      })
      .expect(201);
    expect(theoryPass.body.data.isLocked).toBe(true);

    // Duplicate locked PASS -> 409
    await request(app.getHttpServer())
      .post('/api/v1/examinations')
      .set('Authorization', `Bearer ${examToken}`)
      .send({
        driverProfileId: createdDriverId,
        applicationId: createdAppId,
        examType: 'THEORETICAL',
        categoryCode: 'CAT-SP',
        scorePercent: 92,
        outcome: 'PASS',
      })
      .expect(409);

    // Practical sheet upload + PASS -> advances application to MEDICAL_PENDING
    const fakePdf = Buffer.from('%PDF-1.4\n%PracticalSheet\n', 'utf8');
    const uploadRes = await request(app.getHttpServer())
      .post('/api/v1/storage/upload?bucket=certificates')
      .set('Authorization', `Bearer ${examToken}`)
      .attach('file', fakePdf, 'practical-sheet.pdf')
      .expect(201);

    const pracRes = await request(app.getHttpServer())
      .post('/api/v1/examinations')
      .set('Authorization', `Bearer ${examToken}`)
      .send({
        driverProfileId: createdDriverId,
        applicationId: createdAppId,
        examType: 'PRACTICAL',
        categoryCode: 'CAT-SP',
        outcome: 'PASS',
        evidenceUrl: uploadRes.body.data.objectKey,
        notes: 'Passed yard forklift & recovery test.',
      })
      .expect(201);
    expect(pracRes.body.data.isLocked).toBe(true);

    const appCheck = await request(app.getHttpServer())
      .get(`/api/v1/applications/${createdAppId}`)
      .set('Authorization', `Bearer ${licToken}`)
      .expect(200);
    expect(appCheck.body.data.status).toBe('MEDICAL_PENDING');
  });
});
