import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { TransformInterceptor } from './../src/common/interceptors/transform.interceptor';
import { AllExceptionsFilter } from './../src/common/filters/http-exception.filter';

import { completeDriver } from './helpers/driver-payload';
describe('Safety Incidents, Suspensions & QR Lockout (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let coordToken: string;
  let licToken: string;
  let cmdrToken: string;
  let issuerToken: string;
  let guardToken: string;
  let coordUnitId: string;
  let catSpId: string;
  let createdDriverId: string;
  let issuedQrToken: string;

  const suffix = Date.now();
  const testServiceNum = `MOD-SFT-E2E-${suffix}`;

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
    if (createdDriverId) {
      const suspensions = await prisma.suspensionRecord.findMany({
        where: { driverProfileId: createdDriverId },
        select: { id: true },
      });
      const incidents = await prisma.incidentReport.findMany({
        where: { driverProfileId: createdDriverId },
        select: { id: true },
      });
      const creds = await prisma.issuedCredential.findMany({
        where: { driverProfileId: createdDriverId },
        select: { id: true },
      });
      const apps = await prisma.application.findMany({
        where: { driverProfileId: createdDriverId },
        select: { id: true },
      });

      const auditEntityIds = [
        createdDriverId,
        ...suspensions.map((s) => s.id),
        ...incidents.map((i) => i.id),
        ...creds.map((c) => c.id),
      ];
      if (auditEntityIds.length > 0) {
        await prisma.auditLog.deleteMany({
          where: { entityId: { in: auditEntityIds } },
        });
      }

      await prisma.suspensionRecord.deleteMany({
        where: { driverProfileId: createdDriverId },
      });
      await prisma.incidentReport.deleteMany({
        where: { driverProfileId: createdDriverId },
      });
      if (creds.length > 0) {
        await prisma.credentialCategoryItem.deleteMany({
          where: { credentialId: { in: creds.map((c) => c.id) } },
        });
        await prisma.issuedCredential.deleteMany({
          where: { id: { in: creds.map((c) => c.id) } },
        });
      }
      if (apps.length > 0) {
        await prisma.applicationApproval.deleteMany({
          where: { applicationId: { in: apps.map((a) => a.id) } },
        });
        await prisma.applicationItem.deleteMany({
          where: { applicationId: { in: apps.map((a) => a.id) } },
        });
        await prisma.application.deleteMany({
          where: { id: { in: apps.map((a) => a.id) } },
        });
      }
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

  it('Suspends driver QR credential across gate checks and reinstates after remedial completion', async () => {
    const [rCoord, rLic, rCmdr, rIssuer, rGuard] = await Promise.all([
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
        .send({ serviceNumber: 'MOD-CMDR-001', password: 'MoD@2026!' })
        .expect(200),
      request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ serviceNumber: 'MOD-ISSUER-001', password: 'MoD@2026!' })
        .expect(200),
      request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ serviceNumber: 'MOD-GUARD-001', password: 'MoD@2026!' })
        .expect(200),
    ]);

    coordToken = rCoord.body.data.accessToken;
    coordUnitId = rCoord.body.data.user.unitId;
    licToken = rLic.body.data.accessToken;
    cmdrToken = rCmdr.body.data.accessToken;
    issuerToken = rIssuer.body.data.accessToken;
    guardToken = rGuard.body.data.accessToken;

    const catsRes = await request(app.getHttpServer())
      .get('/api/v1/categories')
      .set('Authorization', `Bearer ${coordToken}`)
      .expect(200);
    catSpId = catsRes.body.data.find((c: any) => c.code === 'CAT-SP').id;

    const drvRes = await request(app.getHttpServer())
      .post('/api/v1/personnel/drivers')
      .set('Authorization', `Bearer ${coordToken}`)
      .send(completeDriver({
        serviceNumber: testServiceNum,
        fullName: 'Sgt. Safety E2E Driver',
        dateOfBirth: '1991-06-10',
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
    const appId = appRes.body.data.id;

    await request(app.getHttpServer())
      .patch(`/api/v1/applications/${appId}/screen`)
      .set('Authorization', `Bearer ${licToken}`)
      .send({ action: 'ADVANCE_STAGE', targetStage: 'READY_FOR_APPROVAL' })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/api/v1/applications/${appId}/decision`)
      .set('Authorization', `Bearer ${cmdrToken}`)
      .send({ action: 'APPROVED', comments: 'Approved for safety test.' })
      .expect(200);

    const credRes = await request(app.getHttpServer())
      .post('/api/v1/credentials/issue')
      .set('Authorization', `Bearer ${issuerToken}`)
      .send({ applicationId: appId })
      .expect(201);
    issuedQrToken = credRes.body.data.qrHashSignature;

    // 1. Report incident with corrective action
    const incRes = await request(app.getHttpServer())
      .post('/api/v1/safety/incidents')
      .set('Authorization', `Bearer ${coordToken}`)
      .send({
        driverProfileId: createdDriverId,
        incidentDate: '2026-11-01T10:00:00.000Z',
        location: 'Central Base Yard Sector',
        severity: 'SEVERE',
        description: 'Forklift speed violation in base perimeter.',
        correctiveAction: 'Remedial Yard Safety Briefing',
      })
      .expect(201);
    const incidentId = incRes.body.data.id;
    expect(incRes.body.data.reportNumber).toMatch(/^INC-\d{4}-\d{4}$/);

    // 2. Commander imposes suspension -> flips credential SUSPENDED
    const suspRes = await request(app.getHttpServer())
      .post('/api/v1/safety/suspensions')
      .set('Authorization', `Bearer ${cmdrToken}`)
      .send({
        driverProfileId: createdDriverId,
        legalBasis: 'MoD Safety Directive 9.4',
        reason: 'Pending remedial briefing completion.',
      })
      .expect(201);
    const suspensionId = suspRes.body.data.id;

    // 3. Gate QR scan & dispatch check immediately RED / blocked
    const qrBlocked = await request(app.getHttpServer())
      .post('/api/v1/eligibility/scan-qr')
      .set('Authorization', `Bearer ${guardToken}`)
      .send({ token: issuedQrToken, categoryCode: 'CAT-SP' })
      .expect(201);
    expect(qrBlocked.body.data.eligible).toBe(false);
    expect(qrBlocked.body.data.credential.status).toBe('SUSPENDED');

    // 4. Premature reinstatement blocked until remedialCompleted=true
    await request(app.getHttpServer())
      .post(`/api/v1/safety/suspensions/${suspensionId}/reinstate`)
      .set('Authorization', `Bearer ${cmdrToken}`)
      .expect(400);

    // 5. Complete remedial task -> Reinstate -> QR scan turns GREEN again!
    await request(app.getHttpServer())
      .patch(`/api/v1/safety/incidents/${incidentId}`)
      .set('Authorization', `Bearer ${cmdrToken}`)
      .send({ status: 'CLOSED', remedialCompleted: true })
      .expect(200);

    const reinstateRes = await request(app.getHttpServer())
      .post(`/api/v1/safety/suspensions/${suspensionId}/reinstate`)
      .set('Authorization', `Bearer ${cmdrToken}`)
      .expect(201);
    expect(reinstateRes.body.data.isActive).toBe(false);

    const qrCleared = await request(app.getHttpServer())
      .post('/api/v1/eligibility/scan-qr')
      .set('Authorization', `Bearer ${guardToken}`)
      .send({ token: issuedQrToken, categoryCode: 'CAT-SP' })
      .expect(201);
    expect(qrCleared.body.data.eligible).toBe(true);
    expect(qrCleared.body.data.credential.status).toBe('ACTIVE');
  });
});
