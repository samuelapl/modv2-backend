import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { TransformInterceptor } from './../src/common/interceptors/transform.interceptor';
import { AllExceptionsFilter } from './../src/common/filters/http-exception.filter';

import { completeDriver } from './helpers/driver-payload';
describe('Maker-Checker Approval & Credential Issuance (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let coordToken: string;
  let licToken: string;
  let cmdrToken: string;
  let issuerToken: string;
  let coordUnitId: string;
  let catSpId: string;
  let createdDriverId: string;
  let createdAppId: string;
  let createdCredId: string;
  let issuedQrToken: string;

  const suffix = Date.now();
  const testServiceNum = `MOD-CRD-E2E-${suffix}`;

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

  it('Completes Maker-Checker approval, QR issuance, and cryptographic verification', async () => {
    const [rCoord, rLic, rCmdr, rIssuer] = await Promise.all([
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
    ]);

    coordToken = rCoord.body.data.accessToken;
    coordUnitId = rCoord.body.data.user.unitId;
    licToken = rLic.body.data.accessToken;
    cmdrToken = rCmdr.body.data.accessToken;
    issuerToken = rIssuer.body.data.accessToken;

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
        fullName: 'Sgt. Credential E2E Driver',
        dateOfBirth: '1991-09-12',
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

    // Licensing screens straight to READY_FOR_APPROVAL (simulated expedited flow)
    await request(app.getHttpServer())
      .patch(`/api/v1/applications/${createdAppId}/screen`)
      .set('Authorization', `Bearer ${licToken}`)
      .send({
        action: 'ADVANCE_STAGE',
        targetStage: 'READY_FOR_APPROVAL',
        comments: 'Ready for issuance check.',
      })
      .expect(200);

    // Command Authority Maker-Checker approves
    await request(app.getHttpServer())
      .patch(`/api/v1/applications/${createdAppId}/decision`)
      .set('Authorization', `Bearer ${cmdrToken}`)
      .send({ action: 'APPROVED', comments: 'Approved for credential minting.' })
      .expect(200);

    // Issuer sees pending queue
    const pendingRes = await request(app.getHttpServer())
      .get('/api/v1/credentials/pending')
      .set('Authorization', `Bearer ${issuerToken}`)
      .expect(200);
    expect(
      pendingRes.body.data.items.some((a: any) => a.id === createdAppId),
    ).toBe(true);

    // Issue cryptographic credential
    const issueRes = await request(app.getHttpServer())
      .post('/api/v1/credentials/issue')
      .set('Authorization', `Bearer ${issuerToken}`)
      .send({ applicationId: createdAppId })
      .expect(201);

    createdCredId = issueRes.body.data.id;
    issuedQrToken = issueRes.body.data.qrHashSignature;
    expect(issueRes.body.data.credentialNumber).toMatch(/^MOD-AUTH-\d{4}-\d{4}$/);
    expect(issueRes.body.data.qrDataUrl).toMatch(/^data:image\/png;base64,/);

    // Cryptographic QR verification passes
    const verifyRes = await request(app.getHttpServer())
      .post('/api/v1/credentials/verify-qr')
      .set('Authorization', `Bearer ${issuerToken}`)
      .send({ token: issuedQrToken })
      .expect(201);
    expect(verifyRes.body.data.cryptographicValid).toBe(true);
    expect(verifyRes.body.data.valid).toBe(true);
    expect(verifyRes.body.data.status).toBe('ACTIVE');

    // Tampered token fails
    const badRes = await request(app.getHttpServer())
      .post('/api/v1/credentials/verify-qr')
      .set('Authorization', `Bearer ${issuerToken}`)
      .send({ token: `${issuedQrToken}00` })
      .expect(201);
    expect(badRes.body.data.cryptographicValid).toBe(false);
    expect(badRes.body.data.valid).toBe(false);
  });
});
