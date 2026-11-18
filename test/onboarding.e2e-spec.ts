import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { TransformInterceptor } from './../src/common/interceptors/transform.interceptor';
import { AllExceptionsFilter } from './../src/common/filters/http-exception.filter';
import { SEED_PASSWORD } from './../prisma/seed-password';

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
    const admin = await login('MOD-ADMIN-001', SEED_PASSWORD).expect(200);
    expect(admin.body.data.user.mustChangePassword).toBe(false);
    expect(admin.body.data.user.profileStatus).toBeNull();
    adminToken = admin.body.data.accessToken;

    const coord = await login('MOD-COORD-001', SEED_PASSWORD).expect(200);
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
          firstName: 'Onboarding',
          middleName: 'Staff',
          lastName: 'Tester',
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
          firstName: 'Onboarding',
          middleName: 'Driver',
          lastName: 'Tester',
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
        .send({ serviceNumber: `${driverNo}-X`, firstName: 'No', middleName: 'Contact', lastName: 'Tester', unitId })
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
        ]),
      );
      // the photo is not part of onboarding: it is uploaded with the application
      expect(res.body.data.missingFields).not.toContain('photoUrl');
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
        .send({ unitId, personnelStatus: 'ACTIVE', firstName: 'Hacked' })
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
        expect.arrayContaining(['bloodGroup', 'emergencyContactName']),
      );

      const done = await request(server())
        .patch('/api/v1/personnel/drivers/me')
        .set('Authorization', `Bearer ${driverToken}`)
        .send({
          bloodGroup: 'O+',
          emergencyContactName: 'Almaz',
          emergencyContactPhone: '+251911000301',
        })
        .expect(200);
      expect(done.body.data.profileStatus).toBe('COMPLETE');
      expect(done.body.data.missingFields).toEqual([]);

      const me = await request(server()).get('/api/v1/auth/me').set('Authorization', `Bearer ${driverToken}`).expect(200);
      expect(me.body.data.profileStatus).toBe('COMPLETE');
    });

    it('the photo cannot be set through the profile any more', async () => {
      await request(server())
        .patch('/api/v1/personnel/drivers/me')
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ photoUrl: 'sneaky.jpg' })
        .expect(400);
    });

    it('a complete profile still cannot be submitted without the 3 x 4 photo', async () => {
      const res = await request(server())
        .post('/api/v1/applications')
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ driverProfileId: driverId, type: 'NEW_AUTHORIZATION', categoryIds: [catSpId] })
        .expect(400);
      expect(JSON.stringify(res.body)).toContain('APPLICATION_PHOTO_REQUIRED');
      expect(await prisma.application.count({ where: { driverProfileId: driverId } })).toBe(0);
    });

    it('a draft can be saved without a photo', async () => {
      const res = await request(server())
        .post('/api/v1/applications')
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ driverProfileId: driverId, type: 'NEW_AUTHORIZATION', categoryIds: [catSpId], submitImmediately: false })
        .expect(201);
      expect(res.body.data.status).toBe('DRAFT');
      createdAppIds.push(res.body.data.id);

      // submitting that draft later still needs the photo
      const submit = await request(server())
        .patch(`/api/v1/applications/${res.body.data.id}/submit`)
        .set('Authorization', `Bearer ${driverToken}`)
        .send({})
        .expect(400);
      expect(JSON.stringify(submit.body)).toContain('APPLICATION_PHOTO_REQUIRED');
    });

    it('uploading the photo with the application submits it and keeps the photo on the profile', async () => {
      // the draft is in the way of a duplicate, so submit that one with the photo
      const draftId = createdAppIds[createdAppIds.length - 1];
      const res = await request(server())
        .patch(`/api/v1/applications/${draftId}/submit`)
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ photoUrl: 'onb-photo-3x4.jpg' })
        .expect(200);
      expect(res.body.data.status).toBe('SUBMITTED');

      const drv = await prisma.driverProfile.findUnique({ where: { id: driverId } });
      expect(drv?.photoUrl).toBe('onb-photo-3x4.jpg');
    });
  });

  describe('details entered by the administrator are read-only for the driver', () => {
    const lockedNo = `MOD-ONB-L-${suffix}`;
    let token: string;

    afterAll(async () => {
      const drv = await prisma.driverProfile.findUnique({ where: { serviceNumber: lockedNo } });
      if (drv) await prisma.driverProfile.delete({ where: { id: drv.id } });
      await prisma.user.deleteMany({ where: { serviceNumber: lockedNo } });
    });

    it('the admin pre-fills blood group and DOB; the driver sees them as locked', async () => {
      const reg = await request(server())
        .post('/api/v1/personnel/drivers')
        .set('Authorization', `Bearer ${coordToken}`)
        .send({
          serviceNumber: lockedNo,
          firstName: 'Locked',
          middleName: 'Fields',
          lastName: 'Tester',
          email: `locked.${suffix}@mod.gov.et`,
          contactPhone: '+251911000400',
          dateOfBirth: '1991-02-02',
          bloodGroup: 'A+',
          unitId,
        })
        .expect(201);
      const temp = reg.body.data.temporaryPassword;

      // skip the forced change here (covered above) to reach the profile endpoints
      await prisma.user.update({ where: { serviceNumber: lockedNo }, data: { mustChangePassword: false } });
      token = (await login(lockedNo, temp).expect(200)).body.data.accessToken;

      const me = await request(server())
        .get('/api/v1/personnel/drivers/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(me.body.data.lockedFields.sort()).toEqual(['bloodGroup', 'dateOfBirth']);
      expect(me.body.data.missingFields).not.toContain('bloodGroup');
      expect(me.body.data.missingFields).toContain('gender');
    });

    it('changing a locked detail is refused (403 PROFILE_FIELD_LOCKED) and nothing is saved', async () => {
      const res = await request(server())
        .patch('/api/v1/personnel/drivers/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ bloodGroup: 'B+', gender: 'MALE' })
        .expect(403);
      expect(JSON.stringify(res.body)).toContain('PROFILE_FIELD_LOCKED');

      const after = await prisma.driverProfile.findUnique({ where: { serviceNumber: lockedNo } });
      expect(after?.bloodGroup).toBe('A+');
      expect(after?.gender).toBeNull(); // the whole request was refused
    });

    it('contact phone and email can no longer be changed by the driver at all', async () => {
      await request(server())
        .patch('/api/v1/personnel/drivers/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ contactPhone: '+251911999999' })
        .expect(400);
      await request(server())
        .patch('/api/v1/personnel/drivers/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ email: 'someone.else@mod.gov.et' })
        .expect(400);
    });

    it('re-sending the same value is fine, and the driver can fill in the rest', async () => {
      const res = await request(server())
        .patch('/api/v1/personnel/drivers/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ bloodGroup: 'A+', gender: 'FEMALE' })
        .expect(200);
      expect(res.body.data.gender).toBe('FEMALE');
      expect(res.body.data.lockedFields.sort()).toEqual(['bloodGroup', 'dateOfBirth']); // gender is theirs, not locked

      // and they can still correct what they typed themselves
      await request(server())
        .patch('/api/v1/personnel/drivers/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ gender: 'MALE' })
        .expect(200);
    });
  });

  describe('Ministry Staff role created on the Users page', () => {
    const roleNo = `MOD-ONB-R-${suffix}`;

    afterAll(async () => {
      const drv = await prisma.driverProfile.findUnique({ where: { serviceNumber: roleNo } });
      if (drv) await prisma.driverProfile.delete({ where: { id: drv.id } });
      await prisma.user.deleteMany({ where: { serviceNumber: roleNo } });
    });

    it('creates the driver profile automatically, incomplete, with the basics copied over', async () => {
      const res = await request(server())
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          serviceNumber: roleNo,
          firstName: 'Role',
          middleName: 'Driver',
          lastName: 'Tester',
          rank: 'Private',
          phone: '+251911000600',
          roles: ['STAFF_DRIVER'],
          unitId,
        })
        .expect(201);
      expect(res.body.data.driverProfile).toMatchObject({ fullName: 'Role Driver Tester', profileStatus: 'INCOMPLETE' });

      const drv = await prisma.driverProfile.findUnique({ where: { serviceNumber: roleNo } });
      expect(drv).toMatchObject({ rank: 'Private', contactPhone: '+251911000600', unitId, profileStatus: 'INCOMPLETE' });
      expect(drv?.dateOfBirth).toBeNull();
    });

    it('that driver can open their onboarding like any registered driver', async () => {
      const temp = (
        await request(server())
          .post(`/api/v1/users/${(await prisma.user.findUnique({ where: { serviceNumber: roleNo } }))!.id}/reset-password`)
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(201)
      ).body.data.temporaryPassword;
      await prisma.user.update({ where: { serviceNumber: roleNo }, data: { mustChangePassword: false } });
      const token = (await login(roleNo, temp).expect(200)).body.data.accessToken;

      const me = await request(server())
        .get('/api/v1/personnel/drivers/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(me.body.data.serviceNumber).toBe(roleNo);
      expect(me.body.data.missingFields).toContain('dateOfBirth');
    });

    it('giving the role to an existing staff account adds the profile too', async () => {
      const user = await prisma.user.findUnique({ where: { serviceNumber: staffNo } });
      expect(await prisma.driverProfile.findUnique({ where: { userId: user!.id } })).toBeNull();

      await request(server())
        .patch(`/api/v1/users/${user!.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ roles: ['INSTRUCTOR', 'STAFF_DRIVER'], unitId })
        .expect(200);

      const drv = await prisma.driverProfile.findUnique({ where: { userId: user!.id } });
      expect(drv).toMatchObject({ serviceNumber: staffNo, profileStatus: 'INCOMPLETE' });
      await prisma.driverProfile.delete({ where: { id: drv!.id } }); // staffNo user is cleaned up by afterAll
    });
  });

  describe('drivers list: filter by profile status', () => {
    const filterNo = `MOD-ONB-F-${suffix}`;

    afterAll(async () => {
      const drv = await prisma.driverProfile.findUnique({ where: { serviceNumber: filterNo } });
      if (drv) await prisma.driverProfile.delete({ where: { id: drv.id } });
      await prisma.user.deleteMany({ where: { serviceNumber: filterNo } });
    });

    it('lists only complete or only incomplete profiles, and rejects other values', async () => {
      await request(server())
        .post('/api/v1/personnel/drivers')
        .set('Authorization', `Bearer ${coordToken}`)
        .send({
          serviceNumber: filterNo,
          firstName: 'Filter',
          middleName: 'Check',
          lastName: 'Tester',
          email: `filter.${suffix}@mod.gov.et`,
          contactPhone: '+251911000800',
          unitId,
        })
        .expect(201);

      const list = async (q: string) =>
        (
          await request(server())
            .get(`/api/v1/personnel/drivers?limit=100&${q}`)
            .set('Authorization', `Bearer ${adminToken}`)
            .expect(200)
        ).body.data.items as Array<{ serviceNumber: string; profileStatus: string }>;

      const incomplete = await list('profileStatus=INCOMPLETE');
      const complete = await list('profileStatus=COMPLETE');

      expect(incomplete.length).toBeGreaterThan(0);
      expect(incomplete.every((d) => d.profileStatus === 'INCOMPLETE')).toBe(true);
      expect(complete.every((d) => d.profileStatus === 'COMPLETE')).toBe(true);
      // the driver who finished the wizard above is complete; the one just registered is not
      expect(complete.map((d) => d.serviceNumber)).toContain(driverNo);
      expect(incomplete.map((d) => d.serviceNumber)).toContain(filterNo);
      expect(incomplete.map((d) => d.serviceNumber)).not.toContain(driverNo);

      await request(server())
        .get('/api/v1/personnel/drivers?profileStatus=NOPE')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);
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
