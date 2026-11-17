import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { TransformInterceptor } from './../src/common/interceptors/transform.interceptor';
import { AllExceptionsFilter } from './../src/common/filters/http-exception.filter';

describe('Personnel & MinIO Storage (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let coordToken: string;
  let licAdminToken: string;
  let logUnitId: string;
  let createdDriverId: string;
  const bulkCreatedDriverIds: string[] = [];
  let uploadedKey: string;
  const testServiceNum = `MOD-E2E-${Date.now()}`;

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
    const idsToClean = [createdDriverId, ...bulkCreatedDriverIds].filter(Boolean);
    for (const id of idsToClean) {
      const drv = await prisma.driverProfile.findUnique({ where: { id } });
      await prisma.driverProfile.deleteMany({ where: { id } });
      if (drv?.userId) {
        await prisma.user.deleteMany({ where: { id: drv.userId } });
      }
    }
    await app.close();
  });

  it('Authenticates Coordinator & Licensing Admin', async () => {
    const res1 = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ serviceNumber: 'MOD-COORD-001', password: 'MoD@2026!' })
      .expect(200);
    coordToken = res1.body.data.accessToken;
    logUnitId = res1.body.data.user.unitId;

    const res2 = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ serviceNumber: 'MOD-LIC-001', password: 'MoD@2026!' })
      .expect(200);
    licAdminToken = res2.body.data.accessToken;
  });

  it('POST /api/v1/storage/upload - uploads portrait photo to MinIO', async () => {
    const fakeJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

    const res = await request(app.getHttpServer())
      .post('/api/v1/storage/upload?bucket=driver-photos')
      .set('Authorization', `Bearer ${coordToken}`)
      .attach('file', fakeJpeg, 'soldier-portrait.jpg')
      .expect(201);

    expect(res.body.data.bucket).toBe('driver-photos');
    expect(res.body.data.objectKey).toMatch(/\.jpg$/);
    uploadedKey = res.body.data.objectKey;
  });

  it('POST /api/v1/personnel/drivers - registers new driver with MinIO photo', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/personnel/drivers')
      .set('Authorization', `Bearer ${coordToken}`)
      .send({
        serviceNumber: testServiceNum,
        fullName: 'Sgt. E2E Test Driver',
        dateOfBirth: '1994-06-15',
        email: `e2e.photo.${testServiceNum.toLowerCase()}@mod.gov.et`,
        contactPhone: '+251911000999',
        unitId: logUnitId,
        photoUrl: uploadedKey,
      })
      .expect(201);

    createdDriverId = res.body.data.id;
    expect(res.body.data.serviceNumber).toBe(testServiceNum);
    expect(res.body.data.photoUrl).toBe(uploadedKey);
  });

  it('POST /api/v1/personnel/drivers - rejects duplicate registration with 409', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/personnel/drivers')
      .set('Authorization', `Bearer ${coordToken}`)
      .send({
        serviceNumber: testServiceNum,
        fullName: 'Duplicate Attempt',
        dateOfBirth: '1994-06-15',
        email: `e2e.dup.${testServiceNum.toLowerCase()}@mod.gov.et`,
        contactPhone: '+251911000998',
        unitId: logUnitId,
      })
      .expect(409);
  });

  it('PATCH /api/v1/personnel/drivers/:id/verify-identity - stamps verification', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/personnel/drivers/${createdDriverId}/verify-identity`)
      .set('Authorization', `Bearer ${licAdminToken}`)
      .expect(200);

    expect(res.body.data.identityVerifiedBy).toBe('MOD-LIC-001');
    expect(res.body.data.identityVerifiedAt).toBeDefined();
  });

  it('POST /api/v1/personnel/drivers/bulk - bulk registers selected drivers with custom password', async () => {
    const bulkCode1 = `MOD-BLK1-${Date.now()}`;
    const bulkCode2 = `MOD-BLK2-${Date.now()}`;

    const res = await request(app.getHttpServer())
      .post('/api/v1/personnel/drivers/bulk')
      .set('Authorization', `Bearer ${coordToken}`)
      .send({
        drivers: [
          {
            serviceNumber: bulkCode1,
            fullName: 'Cpl. Bulk One',
            email: `${bulkCode1.toLowerCase()}@mod.gov.et`,
            contactPhone: '+251911000101',
            rank: 'Corporal',
            gender: 'MALE',
            dateOfBirth: '1993-04-10',
            bloodGroup: 'O+',
            unitId: logUnitId,
            initialPassword: 'BulkPass@2026',
          },
          {
            serviceNumber: bulkCode2,
            fullName: 'Pvt. Bulk Two',
            email: `${bulkCode2.toLowerCase()}@mod.gov.et`,
            contactPhone: '+251911000102',
            rank: 'Private',
            gender: 'FEMALE',
            dateOfBirth: '1996-08-22',
            bloodGroup: 'A+',
            unitId: logUnitId,
          },
        ],
      })
      .expect(201);

    expect(res.body.data.createdCount).toBe(2);
    expect(res.body.data.failedCount).toBe(0);
    for (const r of res.body.data.results) {
      if (r.driver?.id) bulkCreatedDriverIds.push(r.driver.id);
    }

    // Verify custom initial password works on login (and is flagged as temporary)
    const login1 = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ serviceNumber: bulkCode1, password: 'BulkPass@2026' })
      .expect(200);
    expect(login1.body.data.user.mustChangePassword).toBe(true);

    // The row without a password got its own generated one, returned once.
    const [row1, row2] = res.body.data.results;
    expect(row1.temporaryPassword).toBeUndefined();
    expect(row2.temporaryPassword).toEqual(expect.any(String));
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ serviceNumber: bulkCode2, password: row2.temporaryPassword })
      .expect(200);
  });
});
