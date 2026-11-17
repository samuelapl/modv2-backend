import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { TransformInterceptor } from './../src/common/interceptors/transform.interceptor';
import { AllExceptionsFilter } from './../src/common/filters/http-exception.filter';

describe('Audit Trails & Executive Reports (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let auditToken: string;
  let cmdrToken: string;
  let guardToken: string;
  let createdCategoryId: string | null = null;
  const testCode = `CAT-E2E-${Date.now().toString().slice(-5)}`;

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
    if (createdCategoryId) {
      await prisma.auditLog.deleteMany({
        where: { entityId: createdCategoryId },
      });
      await prisma.vehicleCategory.deleteMany({
        where: { id: createdCategoryId },
      });
    }
    await app.close();
  });

  it('automatically records immutable before/after audit diffs and serves analytics/export with PBAC', async () => {
    const [rAdmin, rAudit, rCmdr, rGuard] = await Promise.all([
      request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ serviceNumber: 'MOD-ADMIN-001', password: 'MoD@2026!' })
        .expect(200),
      request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ serviceNumber: 'MOD-AUDIT-001', password: 'MoD@2026!' })
        .expect(200),
      request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ serviceNumber: 'MOD-CMDR-001', password: 'MoD@2026!' })
        .expect(200),
      request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ serviceNumber: 'MOD-GUARD-001', password: 'MoD@2026!' })
        .expect(200),
    ]);

    adminToken = rAdmin.body.data.accessToken;
    auditToken = rAudit.body.data.accessToken;
    cmdrToken = rCmdr.body.data.accessToken;
    guardToken = rGuard.body.data.accessToken;

    // 1. Trigger create + update mutation as SYSTEM_ADMIN
    const createRes = await request(app.getHttpServer())
      .post('/api/v1/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        code: testCode,
        name: 'E2E Audit Initial Category',
        minServiceMonths: 12,
        trainingHoursRequired: 16,
      })
      .expect(201);

    createdCategoryId = createRes.body.data.id;

    await request(app.getHttpServer())
      .patch(`/api/v1/categories/${createdCategoryId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'E2E Audit Updated Category' })
      .expect(200);

    // 2. Auditor inspects captured JSON diff on GET /audit/logs
    const logsRes = await request(app.getHttpServer())
      .get('/api/v1/audit/logs')
      .query({ entityId: createdCategoryId, action: 'UPDATE_CATEGORY' })
      .set('Authorization', `Bearer ${auditToken}`)
      .expect(200);

    expect(logsRes.body.data.items.length).toBeGreaterThanOrEqual(1);
    const updateLog = logsRes.body.data.items[0];
    expect(updateLog.oldValue.name).toBe('E2E Audit Initial Category');
    expect(updateLog.newValue.name).toBe('E2E Audit Updated Category');

    // Inspect single log detail with changedFields
    const detailRes = await request(app.getHttpServer())
      .get(`/api/v1/audit/logs/${updateLog.id}`)
      .set('Authorization', `Bearer ${auditToken}`)
      .expect(200);
    expect(detailRes.body.data.changedFields).toContain('name');

    // 3. PBAC boundaries
    await request(app.getHttpServer())
      .get('/api/v1/audit/logs')
      .set('Authorization', `Bearer ${cmdrToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .get('/api/v1/reports/executive-kpis')
      .set('Authorization', `Bearer ${guardToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .get('/api/v1/audit/export')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(403);

    // 4. Auditor downloads CSV export
    const csvRes = await request(app.getHttpServer())
      .get('/api/v1/audit/export')
      .query({ entityId: createdCategoryId })
      .set('Authorization', `Bearer ${auditToken}`)
      .expect(200);
    expect(csvRes.headers['content-type']).toContain('text/csv');
    expect(csvRes.text).toContain('UPDATE_CATEGORY');

    // 5. Commander reads Executive Reports
    const kpiRes = await request(app.getHttpServer())
      .get('/api/v1/reports/executive-kpis')
      .set('Authorization', `Bearer ${cmdrToken}`)
      .expect(200);
    expect(kpiRes.body.data.drivers).toBeDefined();
    expect(kpiRes.body.data.examinations).toBeDefined();

    await request(app.getHttpServer())
      .get('/api/v1/reports/category-distribution')
      .set('Authorization', `Bearer ${cmdrToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .get('/api/v1/reports/expiring-permits')
      .set('Authorization', `Bearer ${cmdrToken}`)
      .expect(200);
  });
});
