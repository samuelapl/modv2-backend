import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from './../src/app.module';
import { TransformInterceptor } from './../src/common/interceptors/transform.interceptor';
import { AllExceptionsFilter } from './../src/common/filters/http-exception.filter';
import { Permission } from './../src/common/enums/permissions.enum';
import { SEED_PASSWORD } from './../prisma/seed-password';

describe('Auth & Users PBAC (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;
  let coordToken: string;
  let originalCoordPerms: string[] = [];

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
  });

  afterAll(async () => {
    // Restore original UNIT_COORDINATOR permissions if modified
    if (adminToken && originalCoordPerms.length > 0) {
      await request(app.getHttpServer())
        .patch('/api/v1/users/roles/UNIT_COORDINATOR/permissions')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ permissions: originalCoordPerms });
    }
    await app.close();
  });

  it('POST /api/v1/auth/login - authenticates MOD-ADMIN-001', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ serviceNumber: 'MOD-ADMIN-001', password: SEED_PASSWORD })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.accessToken).toBeDefined();
    expect(res.body.data.user.permissions).toContain(Permission.USERS_MANAGE);
    adminToken = res.body.data.accessToken;
  });

  it('POST /api/v1/auth/login - authenticates MOD-COORD-001', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ serviceNumber: 'MOD-COORD-001', password: SEED_PASSWORD })
      .expect(200);

    coordToken = res.body.data.accessToken;
    originalCoordPerms = res.body.data.user.permissions.filter(
      (p: string) => p !== Permission.USERS_MANAGE,
    );
    if (res.body.data.user.permissions.includes(Permission.USERS_MANAGE)) {
      await request(app.getHttpServer())
        .patch('/api/v1/users/roles/UNIT_COORDINATOR/permissions')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ permissions: originalCoordPerms })
        .expect(200);
    }
  });

  it('GET /api/v1/users - rejects UNIT_COORDINATOR with 403 before delegation', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${coordToken}`)
      .expect(403);
  });

  it('PATCH /api/v1/users/roles/UNIT_COORDINATOR/permissions - dynamically unlocks GET /users', async () => {
    const updatedPerms = Array.from(
      new Set([...originalCoordPerms, Permission.USERS_MANAGE]),
    );

    await request(app.getHttpServer())
      .patch('/api/v1/users/roles/UNIT_COORDINATOR/permissions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ permissions: updatedPerms })
      .expect(200);

    // Coordinator immediately gains access without re-login!
    const usersRes = await request(app.getHttpServer())
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${coordToken}`)
      .expect(200);

    expect(usersRes.body.success).toBe(true);
    expect(Array.isArray(usersRes.body.data.items)).toBe(true);
  });

  it('POST /api/v1/auth/logout - invalidates token in Redis', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${coordToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${coordToken}`)
      .expect(401);
  });
});
