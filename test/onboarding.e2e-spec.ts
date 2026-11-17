import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { TransformInterceptor } from './../src/common/interceptors/transform.interceptor';
import { AllExceptionsFilter } from './../src/common/filters/http-exception.filter';

/**
 * Full onboarding journey: admin registers basic accounts -> forced password
 * change -> driver completes their own profile -> only then can they apply.
 */
describe('Driver onboarding (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let coordToken: string;
  let unitId: string;
  let catSpId: string;

  const suffix = Date.now();
  const driverNo = `MOD-ONB-D-${suffix}`;
  const staffNo = `MOD-ONB-S-${suffix}`;
  let driverId: string;
  let driverTemp: string;
  let staffTemp: string;
  const createdAppIds: string[] = [];
  const server = () => app.getHttpServer();

  const login = (serviceNumber: string, password: string) =>
    request(server()).post('/api/v1/auth/login').send({ serviceNumber, password });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalInterceptors(new TransformInterceptor());
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    if (createdAppIds.length) {
      await prisma.applicationApproval.deleteMany({ where: { applicationId: { in: createdAppIds } } });
      await prisma.applicationItem.deleteMany({ where: { applicationId: { in: createdAppIds } } });
      await prisma.application.deleteMany({ where: { id: { in: createdAppIds } } });
    }
    const drv = await prisma.driverProfile.findUnique({ where: { serviceNumber: driverNo } });
    if (drv) await prisma.driverProfile.delete({ where: { id: drv.id } });
    await prisma.user.deleteMany({ where: { serviceNumber: { in: [driverNo, staffNo] } } });
    await app.close();
  });

  it('seeded accounts are unaffected (no forced change)', async () => {
    const admin = await login('MOD-ADMIN-001', 'MoD@2026!').expect(200);
    expect(admin.body.data.user.mustChangePassword).toBe(false);
    expect(admin.body.data.user.profileStatus).toBeNull();
    adminToken = admin.body.data.accessToken;

    const coord = await login('MOD-COORD-001', 'MoD@2026!').expect(200);
    coordToken = coord.body.data.accessToken;
    unitId = coord.body.data.user.unitId;

    const cats = await request(server())
      .get('/api/v1/categories')
      .set('Authorization', `Bearer ${coordToken}`)
      .expect(200);
    catSpId = cats.body.data.find((c: any) => c.code === 'CAT-SP').id;
  });

  describe('staff account (no driver profile)', () => {
    it('admin creates it without a password: one is generated and returned once', async () => {
      const res = await request(server())
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          serviceNumber: staffNo,
          fullName: 'Lt. Onboarding Staff',
          rank: 'Lieutenant',
          phone: '+251911000200',
          roles: ['INSTRUCTOR'],
        })
        .expect(201);

      staffTemp = res.body.data.temporaryPassword;
      expect(staffTemp).toEqual(expect.any(String));
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body.data.mustChangePassword).toBe(true);
      expect(res.body.data.driverProfile).toBeNull(); // staff do not get a driver profile
    });

    it('is limited to the change-password routes until the password is changed', async () => {
      const res = await login(staffNo, staffTemp).expect(200);
      expect(res.body.data.user.mustChangePassword).toBe(true);
      expect(res.body.data.user.profileStatus).toBeNull();
      const token = res.body.data.accessToken;

      await request(server()).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`).expect(200);
      const blocked = await request(server())
        .get('/api/v1/notifications')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
      expect(JSON.stringify(blocked.body)).toContain('AUTH_PASSWORD_CHANGE_REQUIRED');
    });

    it('changing the password ends the session; the new password works, the old one does not', async () => {
      const token = (await login(staffNo, staffTemp).expect(200)).body.data.accessToken;

      await request(server())
        .post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({ currentPassword: staffTemp, newPassword: 'abc' }) // too weak
        .expect(400);
      await request(server())
        .post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({ currentPassword: 'wrong-pass1', newPassword: 'Fresh-Pass9' })
        .expect(400);
      await request(server())
        .post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({ currentPassword: staffTemp, newPassword: staffTemp })
        .expect(400);

      await request(server())
        .post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({ currentPassword: staffTemp, newPassword: 'Fresh-Pass9' })
        .expect(200);

      // the token used for the change is now dead
      await request(server()).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`).expect(401);
      await login(staffNo, staffTemp).expect(401);

      const again = await login(staffNo, 'Fresh-Pass9').expect(200);
      expect(again.body.data.user.mustChangePassword).toBe(false);
      await request(server())
        .get('/api/v1/notifications')
        .set('Authorization', `Bearer ${again.body.data.accessToken}`)
        .expect(200);
    });
  });

  describe('driver account', () => {
    let driverToken: string;

    it('coordinator registers only the basics: profile is INCOMPLETE', async () => {
      const res = await request(server())
        .post('/api/v1/personnel/drivers')
        .set('Authorization', `Bearer ${coordToken}`)
        .send({
          serviceNumber: driverNo,
          fullName: 'Cpl. Onboarding Driver',
          rank: 'Corporal',
          email: `onb.${suffix}@mod.gov.et`,
          contactPhone: '+251911000300',
          unitId,
        })
        .expect(201);

      driverId = res.body.data.id;
      driverTemp = res.body.data.temporaryPassword;
      expect(driverTemp).toEqual(expect.any(String));
      expect(res.body.data.profileStatus).toBe('INCOMPLETE');
      expect(res.body.data.dateOfBirth).toBeNull();
    });

    it('registration needs phone and email', async () => {
      await request(server())
        .post('/api/v1/personnel/drivers')
        .set('Authorization', `Bearer ${coordToken}`)
        .send({ serviceNumber: `${driverNo}-X`, fullName: 'No Contact', unitId })
        .expect(400);
    });

    it('driver must change the temporary password first, then signs in again', async () => {
      const first = await login(driverNo, driverTemp).expect(200);
      expect(first.body.data.user.mustChangePassword).toBe(true);
      expect(first.body.data.user.profileStatus).toBe('INCOMPLETE');
      const t = first.body.data.accessToken;

      await request(server()).get('/api/v1/personnel/drivers/me').set('Authorization', `Bearer ${t}`).expect(403);

      await request(server())
        .post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${t}`)
        .send({ currentPassword: driverTemp, newPassword: 'Driver-Pass9' })
        .expect(200);

      const second = await login(driverNo, 'Driver-Pass9').expect(200);
      expect(second.body.data.user.mustChangePassword).toBe(false);
      driverToken = second.body.data.accessToken;
    });

    it('driver sees what is missing', async () => {
      const res = await request(server())
        .get('/api/v1/personnel/drivers/me')
        .set('Authorization', `Bearer ${driverToken}`)
        .expect(200);
      expect(res.body.data.missingFields).toEqual(
        expect.arrayContaining([
          'dateOfBirth',
          'gender',
          'nationalIdNumber',
          'bloodGroup',
          'emergencyContactName',
          'emergencyContactPhone',
          'photoUrl',
        ]),
      );
    });

    it('cannot apply while the profile is incomplete (403 PROFILE_INCOMPLETE)', async () => {
      const res = await request(server())
        .post('/api/v1/applications')
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ driverProfileId: driverId, type: 'NEW_AUTHORIZATION', categoryIds: [catSpId] })
        .expect(403);
      expect(JSON.stringify(res.body)).toContain('PROFILE_INCOMPLETE');
    });

    it('self-service cannot touch admin-owned fields', async () => {
      await request(server())
        .patch('/api/v1/personnel/drivers/me')
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ unitId, personnelStatus: 'ACTIVE', fullName: 'Hacked' })
        .expect(400);
    });

    it('rejects an under-18 date of birth', async () => {
      const young = new Date();
      young.setFullYear(young.getFullYear() - 16);
      await request(server())
        .patch('/api/v1/personnel/drivers/me')
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ dateOfBirth: young.toISOString().slice(0, 10) })
        .expect(400);
    });

    it('completing the profile in two saves flips it to COMPLETE', async () => {
      const part = await request(server())
        .patch('/api/v1/personnel/drivers/me')
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ dateOfBirth: '1994-03-10', gender: 'MALE', nationalIdNumber: `FAN-ONB-${suffix}` })
        .expect(200);
      expect(part.body.data.profileStatus).toBe('INCOMPLETE');
      expect(part.body.data.missingFields).toEqual(
        expect.arrayContaining(['bloodGroup', 'photoUrl']),
      );

      const done = await request(server())
        .patch('/api/v1/personnel/drivers/me')
        .set('Authorization', `Bearer ${driverToken}`)
        .send({
          bloodGroup: 'O+',
          photoUrl: 'onb-photo.jpg',
          emergencyContactName: 'Almaz',
          emergencyContactPhone: '+251911000301',
        })
        .expect(200);
      expect(done.body.data.profileStatus).toBe('COMPLETE');
      expect(done.body.data.missingFields).toEqual([]);

      const me = await request(server()).get('/api/v1/auth/me').set('Authorization', `Bearer ${driverToken}`).expect(200);
      expect(me.body.data.profileStatus).toBe('COMPLETE');
    });

    it('can apply once the profile is complete', async () => {
      const res = await request(server())
        .post('/api/v1/applications')
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ driverProfileId: driverId, type: 'NEW_AUTHORIZATION', categoryIds: [catSpId] })
        .expect(201);
      createdAppIds.push(res.body.data.id);
    });
  });

  describe('admin password reset', () => {
    it('forces a new temporary password and blocks the old one', async () => {
      const res = await request(server())
        .post(`/api/v1/personnel/drivers/${driverId}/reset-password`)
        .set('Authorization', `Bearer ${coordToken}`)
        .expect(201);
      const temp = res.body.data.temporaryPassword;
      expect(temp).toEqual(expect.any(String));
      expect(res.headers['cache-control']).toBe('no-store');

      await login(driverNo, 'Driver-Pass9').expect(401);
      const relog = await login(driverNo, temp).expect(200);
      expect(relog.body.data.user.mustChangePassword).toBe(true);
    });

    it('passwords never reach the audit trail', async () => {
      const logs = await prisma.auditLog.findMany({
        where: { action: { in: ['CHANGE_PASSWORD', 'RESET_DRIVER_PASSWORD', 'CREATE_USER', 'REGISTER_DRIVER'] } },
        orderBy: { timestamp: 'desc' },
        take: 20,
      });
      expect(logs.length).toBeGreaterThan(0);
      const dump = JSON.stringify(logs);
      expect(dump).not.toContain(staffTemp);
      expect(dump).not.toContain(driverTemp);
      expect(dump).not.toContain('Fresh-Pass9');
      expect(dump).not.toContain('Driver-Pass9');
    });
  });
});
