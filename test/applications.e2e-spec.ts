import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { TransformInterceptor } from './../src/common/interceptors/transform.interceptor';
import { AllExceptionsFilter } from './../src/common/filters/http-exception.filter';

import { completeDriver } from './helpers/driver-payload';
describe('Categories & Applications Workflow (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let coordToken: string;
  let licToken: string;
  let cmdrToken: string;
  let coordUnitId: string;
  let catHvId: string;
  let catSpId: string;
  let createdDriverId: string;
  let createdLicenseId: string;
  const createdAppIds: string[] = [];

  const suffix = Date.now();
  const testServiceNum = `MOD-APP-E2E-${suffix}`;
  const testLicenseNum = `ETH-APP-E2E-${suffix}`;

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
    if (createdAppIds.length > 0) {
      await prisma.applicationApproval.deleteMany({
        where: { applicationId: { in: createdAppIds } },
      });
      await prisma.applicationItem.deleteMany({
        where: { applicationId: { in: createdAppIds } },
      });
      await prisma.application.deleteMany({
        where: { id: { in: createdAppIds } },
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

  it('Authenticates actors and fetches MoD vehicle categories', async () => {
    const resCoord = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ serviceNumber: 'MOD-COORD-001', password: 'MoD@2026!' })
      .expect(200);
    coordToken = resCoord.body.data.accessToken;
    coordUnitId = resCoord.body.data.user.unitId;

    const resLic = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ serviceNumber: 'MOD-LIC-001', password: 'MoD@2026!' })
      .expect(200);
    licToken = resLic.body.data.accessToken;

    const resCmdr = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ serviceNumber: 'MOD-CMDR-001', password: 'MoD@2026!' })
      .expect(200);
    cmdrToken = resCmdr.body.data.accessToken;

    const catRes = await request(app.getHttpServer())
      .get('/api/v1/categories')
      .set('Authorization', `Bearer ${coordToken}`)
      .expect(200);

    const hv = catRes.body.data.find((c: any) => c.code === 'CAT-HV');
    const sp = catRes.body.data.find((c: any) => c.code === 'CAT-SP');
    expect(hv).toBeDefined();
    expect(sp).toBeDefined();
    catHvId = hv.id;
    catSpId = sp.id;
  });

  it('Registers isolated driver and enforces National License prerequisite before CAT-HV submission', async () => {
    const drvRes = await request(app.getHttpServer())
      .post('/api/v1/personnel/drivers')
      .set('Authorization', `Bearer ${coordToken}`)
      .send(completeDriver({
        serviceNumber: testServiceNum,
        firstName: 'Abebe',
        middleName: 'Bikila',
        lastName: 'Workflow',
        dateOfBirth: '1992-05-10',
        contactPhone: '+251911778899',
        unitId: coordUnitId,
      }))
      .expect(201);
    createdDriverId = drvRes.body.data.id;

    // Road category without verified license -> 400
    await request(app.getHttpServer())
      .post('/api/v1/applications')
      .set('Authorization', `Bearer ${coordToken}`)
      .send({
        driverProfileId: createdDriverId,
        type: 'NEW_AUTHORIZATION',
        categoryIds: [catHvId],
      })
      .expect(400);

    // CAT-SP base equipment exempted from civilian license -> 201
    const spAppRes = await request(app.getHttpServer())
      .post('/api/v1/applications')
      .set('Authorization', `Bearer ${coordToken}`)
      .send({
        driverProfileId: createdDriverId,
        type: 'NEW_AUTHORIZATION',
        categoryIds: [catSpId],
      })
      .expect(201);
    createdAppIds.push(spAppRes.body.data.id);
    expect(spAppRes.body.data.status).toBe('SUBMITTED');
  });

  it('Completes full Screening -> Maker-Checker Approval lifecycle for CAT-HV after verified National License', async () => {
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
      .send({ status: 'VERIFIED', verificationNotes: 'Verified for E2E' })
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

    const appId = appRes.body.data.id;
    createdAppIds.push(appId);
    expect(appRes.body.data.applicationNumber).toMatch(/^APP-\d{4}-\d{5}$/);

    // Central Licensing screens and moves to READY_FOR_APPROVAL
    const screenRes = await request(app.getHttpServer())
      .patch(`/api/v1/applications/${appId}/screen`)
      .set('Authorization', `Bearer ${licToken}`)
      .send({
        action: 'ADVANCE_STAGE',
        targetStage: 'READY_FOR_APPROVAL',
        comments: 'Documents screened cleanly.',
      })
      .expect(200);
    expect(screenRes.body.data.status).toBe('READY_FOR_APPROVAL');

    // Coordinator lacks APPLICATIONS_APPROVE -> 403
    await request(app.getHttpServer())
      .patch(`/api/v1/applications/${appId}/decision`)
      .set('Authorization', `Bearer ${coordToken}`)
      .send({ action: 'APPROVED' })
      .expect(403);

    // Command Authority approves -> 200 APPROVED
    const approveRes = await request(app.getHttpServer())
      .patch(`/api/v1/applications/${appId}/decision`)
      .set('Authorization', `Bearer ${cmdrToken}`)
      .send({
        action: 'APPROVED',
        comments: 'Approved for authorization issuance.',
      })
      .expect(200);

    expect(approveRes.body.data.status).toBe('APPROVED');
    expect(approveRes.body.data.approvals.length).toBeGreaterThanOrEqual(2);
  });
});
