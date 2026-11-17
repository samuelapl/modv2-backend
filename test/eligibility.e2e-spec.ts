import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { TransformInterceptor } from './../src/common/interceptors/transform.interceptor';
import { AllExceptionsFilter } from './../src/common/filters/http-exception.filter';

import { completeDriver } from './helpers/driver-payload';
describe('Dispatch Eligibility & Gate QR Scanner (e2e)', () => {
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
  let createdAppId: string;
  let createdCredId: string;
  let issuedQrToken: string;

  const suffix = Date.now();
  const testServiceNum = `MOD-ELG-E2E-${suffix}`;

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
      const creds = await prisma.issuedCredential.findMany({
        where: { driverProfileId: createdDriverId },
        select: { id: true },
      });
      const credIds = creds.map((c) => c.id);
      if (credIds.length > 0) {
        await prisma.auditLog.deleteMany({
          where: { entityId: { in: credIds } },
        });
        await prisma.credentialCategoryItem.deleteMany({
          where: { credentialId: { in: credIds } },
        });
        await prisma.issuedCredential.deleteMany({
          where: { id: { in: credIds } },
        });
      }
      await prisma.auditLog.deleteMany({
        where: { entityId: createdDriverId },
      });
      const apps = await prisma.application.findMany({
        where: { driverProfileId: createdDriverId },
        select: { id: true },
      });
      const appIds = apps.map((a) => a.id);
      if (appIds.length > 0) {
        await prisma.applicationApproval.deleteMany({
          where: { applicationId: { in: appIds } },
        });
        await prisma.applicationItem.deleteMany({
          where: { applicationId: { in: appIds } },
        });
        await prisma.application.deleteMany({ where: { id: { in: appIds } } });
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

  it('Evaluates real-time CAT-HV denial, CAT-SP clearance, and gate QR scan as MOD-GUARD-001', async () => {
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

    const elgCatsRes = await request(app.getHttpServer())
      .get('/api/v1/eligibility/categories')
      .set('Authorization', `Bearer ${guardToken}`)
      .expect(200);
    catSpId = elgCatsRes.body.data.find((c: any) => c.code === 'CAT-SP').id;

    const drvRes = await request(app.getHttpServer())
      .post('/api/v1/personnel/drivers')
      .set('Authorization', `Bearer ${coordToken}`)
      .send(completeDriver({
        serviceNumber: testServiceNum,
        fullName: 'Cpl. Dispatch E2E Driver',
        dateOfBirth: '1991-04-04',
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
      .send({
        action: 'ADVANCE_STAGE',
        targetStage: 'READY_FOR_APPROVAL',
        comments: 'Dispatch test prep.',
      })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/api/v1/applications/${createdAppId}/decision`)
      .set('Authorization', `Bearer ${cmdrToken}`)
      .send({ action: 'APPROVED', comments: 'Approved for dispatch check.' })
      .expect(200);

    const issueRes = await request(app.getHttpServer())
      .post('/api/v1/credentials/issue')
      .set('Authorization', `Bearer ${issuerToken}`)
      .send({ applicationId: createdAppId })
      .expect(201);
    createdCredId = issueRes.body.data.id;
    issuedQrToken = issueRes.body.data.qrHashSignature;

    // 1. Check CAT-HV -> NOT ELIGIBLE
    const denyRes = await request(app.getHttpServer())
      .post('/api/v1/eligibility/check')
      .set('Authorization', `Bearer ${guardToken}`)
      .send({ serviceNumber: testServiceNum, categoryCode: 'CAT-HV' })
      .expect(201);
    expect(denyRes.body.data.eligible).toBe(false);
    expect(
      denyRes.body.data.reasons.some((r: string) =>
        r.includes('Not authorized for Category CAT-HV'),
      ),
    ).toBe(true);

    // 2. Check CAT-SP -> ELIGIBLE
    const passRes = await request(app.getHttpServer())
      .post('/api/v1/eligibility/check')
      .set('Authorization', `Bearer ${guardToken}`)
      .send({ serviceNumber: testServiceNum, categoryCode: 'CAT-SP' })
      .expect(201);
    expect(passRes.body.data.eligible).toBe(true);
    expect(passRes.body.data.authorizedCategories).toContain('CAT-SP');

    // 3. Scan signed QR at gate with CAT-SP -> valid & eligible
    const scanRes = await request(app.getHttpServer())
      .post('/api/v1/eligibility/scan-qr')
      .set('Authorization', `Bearer ${guardToken}`)
      .send({ token: issuedQrToken, categoryCode: 'CAT-SP' })
      .expect(201);
    expect(scanRes.body.data.cryptographicValid).toBe(true);
    expect(scanRes.body.data.eligible).toBe(true);
  });
});
