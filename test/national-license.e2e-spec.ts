import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { TransformInterceptor } from './../src/common/interceptors/transform.interceptor';
import { AllExceptionsFilter } from './../src/common/filters/http-exception.filter';

import { completeDriver } from './helpers/driver-payload';
describe('National License Verification (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let coordToken: string;
  let licAdminToken: string;
  let candidateToken: string;
  let coordUnitId: string;
  let createdDriverId: string;
  let createdLicenseId: string;
  let uploadedScanKey: string;
  const suffix = Date.now();
  const testServiceNum = `MOD-NL-E2E-${suffix}`;
  const testLicenseNum = `eth-dl-e2e-${suffix}`;

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

  it('Authenticates Coordinator, Licensing Admin, and Candidate', async () => {
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
    licAdminToken = resLic.body.data.accessToken;

    const resCand = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ serviceNumber: 'MOD-88219', password: 'MoD@2026!' })
      .expect(200);
    candidateToken = resCand.body.data.accessToken;
  });

  it('Uploads license scan to MinIO and registers an E2E driver', async () => {
    const fakeJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const uploadRes = await request(app.getHttpServer())
      .post('/api/v1/storage/upload?bucket=national-licenses')
      .set('Authorization', `Bearer ${coordToken}`)
      .attach('file', fakeJpeg, 'national-dl-scan.jpg')
      .expect(201);

    expect(uploadRes.body.data.bucket).toBe('national-licenses');
    uploadedScanKey = uploadRes.body.data.objectKey;

    const driverRes = await request(app.getHttpServer())
      .post('/api/v1/personnel/drivers')
      .set('Authorization', `Bearer ${coordToken}`)
      .send(completeDriver({
        serviceNumber: testServiceNum,
        fullName: 'Cpl. License E2E Driver',
        dateOfBirth: '1993-04-12',
        contactPhone: '+251911223344',
        unitId: coordUnitId,
      }))
      .expect(201);

    createdDriverId = driverRes.body.data.id;
  });

  it('POST /api/v1/national-license - records UNVERIFIED license for driver', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/national-license')
      .set('Authorization', `Bearer ${coordToken}`)
      .send({
        driverProfileId: createdDriverId,
        licenseNumber: testLicenseNum,
        issuingAuthority: 'Federal Transport Authority (FTA)',
        categories: ['Auto', 'Hizb 1'],
        issuedDate: '2024-01-15',
        expiryDate: '2029-01-15',
        documentEvidenceUrl: uploadedScanKey,
      })
      .expect(201);

    createdLicenseId = res.body.data.id;
    expect(res.body.data.licenseNumber).toBe(testLicenseNum.toUpperCase());
    expect(res.body.data.verificationStatus).toBe('UNVERIFIED');
    expect(res.body.data.categories).toEqual(['Auto', 'Hizb 1']);
  });

  it('GET /api/v1/national-license & /driver/:driverId - fetches recorded license', async () => {
    const listRes = await request(app.getHttpServer())
      .get(`/api/v1/national-license?search=${testLicenseNum.toUpperCase()}`)
      .set('Authorization', `Bearer ${licAdminToken}`)
      .expect(200);

    expect(listRes.body.data.items.length).toBe(1);
    expect(listRes.body.data.items[0].id).toBe(createdLicenseId);

    const byDriverRes = await request(app.getHttpServer())
      .get(`/api/v1/national-license/driver/${createdDriverId}`)
      .set('Authorization', `Bearer ${licAdminToken}`)
      .expect(200);

    expect(byDriverRes.body.data.id).toBe(createdLicenseId);
  });

  it('PATCH /api/v1/national-license/:id/verify - blocks unauthorized candidate verification with 403', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/national-license/${createdLicenseId}/verify`)
      .set('Authorization', `Bearer ${candidateToken}`)
      .send({ status: 'VERIFIED' })
      .expect(403);
  });

  it('PATCH /api/v1/national-license/:id/verify - enforces notes on REJECTED and succeeds on VERIFIED', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/national-license/${createdLicenseId}/verify`)
      .set('Authorization', `Bearer ${licAdminToken}`)
      .send({ status: 'REJECTED' })
      .expect(400);

    const verifyRes = await request(app.getHttpServer())
      .patch(`/api/v1/national-license/${createdLicenseId}/verify`)
      .set('Authorization', `Bearer ${licAdminToken}`)
      .send({
        status: 'VERIFIED',
        verificationNotes: 'Physical hologram & FTA seal matched.',
      })
      .expect(200);

    expect(verifyRes.body.data.verificationStatus).toBe('VERIFIED');
    expect(verifyRes.body.data.verifiedByUserId).toBe('MOD-LIC-001');
  });

  it('POST /api/v1/national-license - anti-tampering resets status to UNVERIFIED on update', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/national-license')
      .set('Authorization', `Bearer ${coordToken}`)
      .send({
        driverProfileId: createdDriverId,
        licenseNumber: `${testLicenseNum}-UPD`,
        issuingAuthority: 'Addis Ababa Transport Bureau',
        categories: ['Auto', 'Derek 1'],
        issuedDate: '2024-02-01',
        expiryDate: '2030-02-01',
        documentEvidenceUrl: uploadedScanKey,
      })
      .expect(201);

    expect(res.body.data.verificationStatus).toBe('UNVERIFIED');
    expect(res.body.data.verifiedByUserId).toBeNull();
    expect(res.body.data.licenseNumber).toBe(`${testLicenseNum}-UPD`.toUpperCase());
  });
});
