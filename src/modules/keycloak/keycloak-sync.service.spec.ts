import { KeycloakSyncService } from './keycloak-sync.service';
import { KeycloakAdminService } from './keycloak-admin.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';

describe('KeycloakSyncService', () => {
  const originalScope = process.env.KEYCLOAK_SYNC_SCOPE;
  afterAll(() => {
    if (originalScope === undefined) delete process.env.KEYCLOAK_SYNC_SCOPE;
    else process.env.KEYCLOAK_SYNC_SCOPE = originalScope;
  });

  let service: KeycloakSyncService;
  let adminService: jest.Mocked<KeycloakAdminService>;
  let prisma: any;
  let redis: any;

  beforeEach(() => {
    process.env.KEYCLOAK_SYNC_SCOPE = 'group'; // most tests exercise the group-based sync
    adminService = {
      listGroupMembers: jest.fn(),
      listUsers: jest.fn(),
      // Default: Keycloak could not be read, so the removal check is skipped.
      listAllUsers: jest.fn().mockResolvedValue(null),
    } as any;

    prisma = {
      user: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      auditLog: { updateMany: jest.fn() },
      $transaction: jest.fn(async (cb: any) => cb({ user: prisma.user, auditLog: prisma.auditLog })),
      organizationalUnit: { findUnique: jest.fn() },
      driverProfile: { upsert: jest.fn().mockResolvedValue({ profileStatus: 'INCOMPLETE' }) },
    };

    redis = {
      set: jest.fn().mockResolvedValue(undefined),
    };

    service = new KeycloakSyncService(adminService, prisma as unknown as PrismaService, redis as unknown as RedisService);
  });

  describe('handleScheduledSync', () => {
    const originalEnv = process.env.IDENTITY_PROVIDER;

    afterEach(() => {
      process.env.IDENTITY_PROVIDER = originalEnv;
    });

    it('does nothing if IDENTITY_PROVIDER is not keycloak', async () => {
      process.env.IDENTITY_PROVIDER = 'local';
      await service.handleScheduledSync();
      expect(adminService.listGroupMembers).not.toHaveBeenCalled();
    });

    it('executes sync when IDENTITY_PROVIDER is keycloak', async () => {
      process.env.IDENTITY_PROVIDER = 'keycloak';
      adminService.listGroupMembers.mockResolvedValue([]);

      await service.handleScheduledSync();
      expect(adminService.listGroupMembers).toHaveBeenCalledWith('idlms-users');
    });
  });

  describe('syncKeycloakGroup', () => {
    it('creates new users with the default role and updates existing users', async () => {
      const mockKeycloakUsers = [
        {
          id: 'kc-new-1',
          username: 'mod-11111',
          firstName: 'New',
          lastName: 'User',
          enabled: true,
          attributes: { grandfatherName: ['Alpha'], rank: ['Lieutenant'] },
        },
        {
          id: 'kc-existing-2',
          username: 'mod-22222',
          firstName: 'Existing',
          lastName: 'User',
          enabled: false,
          attributes: { grandfatherName: ['Beta'] },
        },
      ];

      adminService.listGroupMembers.mockResolvedValue(mockKeycloakUsers as any);

      // First user not in IDLMS DB -> create
      prisma.user.findFirst.mockResolvedValueOnce(null);
      prisma.user.create.mockResolvedValueOnce({ id: 'db-new-1', serviceNumber: 'MOD-11111', roles: ['STAFF_DRIVER'], unitId: null });

      // Second user in IDLMS DB -> update & disable
      prisma.user.findFirst.mockResolvedValueOnce({ id: 'db-existing-2', serviceNumber: 'MOD-22222' });
      prisma.user.update.mockResolvedValueOnce({ id: 'db-existing-2' });

      const result = await service.syncKeycloakGroup('idlms-users');

      expect(result.totalProcessed).toBe(2);
      expect(result.created).toBe(1);
      expect(result.updated).toBe(1);
      expect(result.disabled).toBe(1);

      // Verify created user had the default role (STAFF_DRIVER)
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            serviceNumber: 'MOD-11111',
            keycloakId: 'kc-new-1',
            roles: ['STAFF_DRIVER'],
            mustChangePassword: true,
          }),
        }),
      );
      // No unitCode, so no unit and therefore no driver profile can be created.
      expect(prisma.driverProfile.upsert).not.toHaveBeenCalled();

      // Verify disabled user was blacklisted in Redis
      expect(redis.set).toHaveBeenCalledWith(
        'jwt_user_disabled:db-existing-2',
        '1',
        86400,
      );
    });

    it('creates an INCOMPLETE driver profile for a new user whose unitCode matches a unit', async () => {
      adminService.listGroupMembers.mockResolvedValue([
        {
          id: 'kc-new-3',
          username: 'mod-33333',
          firstName: 'Sample',
          lastName: 'Father',
          enabled: true,
          attributes: { grandfatherName: ['Grand'], unitCode: ['ENG-CORPS'] },
        },
      ] as any);
      prisma.user.findFirst.mockResolvedValueOnce(null);
      prisma.organizationalUnit.findUnique.mockResolvedValueOnce({ id: 'unit-eng' });
      prisma.user.create.mockResolvedValueOnce({
        id: 'db-new-3',
        serviceNumber: 'MOD-33333',
        roles: ['STAFF_DRIVER'],
        unitId: 'unit-eng',
        fullName: 'Sample Father Grand',
        firstName: 'Sample',
        middleName: 'Father',
        lastName: 'Grand',
        rank: null,
        phone: null,
      });

      await service.syncKeycloakGroup('idlms-users');

      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ unitId: 'unit-eng' }) }),
      );
      expect(prisma.driverProfile.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'db-new-3' },
          create: expect.objectContaining({ serviceNumber: 'MOD-33333', unitId: 'unit-eng' }),
        }),
      );
    });

    describe('users deleted in Keycloak', () => {
      const noRecords = { approvalsGiven: 0, examinationsGiven: 0, issuedCredentials: 0, suspensionsImposed: 0 };
      const linked = (id: string, over: Record<string, unknown> = {}) => ({
        id: `db-${id}`,
        serviceNumber: id.toUpperCase(),
        roles: ['STAFF_DRIVER'],
        keycloakId: `kc-${id}`,
        driverProfile: null,
        _count: noRecords,
        ...over,
      });
      const realmHas = (...ids: string[]) =>
        adminService.listAllUsers.mockResolvedValue(ids.map((id) => ({ id: `kc-${id}`, username: id })) as any);
      const five = ['a', 'b', 'c', 'd', 'e'];

      const originalLimit = process.env.KEYCLOAK_SYNC_MAX_REMOVALS;
      beforeEach(() => {
        delete process.env.KEYCLOAK_SYNC_MAX_REMOVALS; // use the built-in default limit
        adminService.listGroupMembers.mockResolvedValue([] as any);
      });
      afterEach(() => {
        if (originalLimit === undefined) delete process.env.KEYCLOAK_SYNC_MAX_REMOVALS;
        else process.env.KEYCLOAK_SYNC_MAX_REMOVALS = originalLimit;
      });

      it('deletes a local user missing from Keycloak when nothing depends on them', async () => {
        realmHas(...five);
        prisma.user.findMany.mockResolvedValue([...five.map((i) => linked(i)), linked('gone')]);

        const res = await service.syncKeycloakGroup('idlms-users');

        expect(res).toMatchObject({ removed: 1, deactivated: 0 });
        expect(prisma.auditLog.updateMany).toHaveBeenCalledWith({ where: { userId: 'db-gone' }, data: { userId: null } });
        expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 'db-gone' } });
      });

      it('keeps a user with records as inactive, clears the link and blocks their session', async () => {
        realmHas(...five);
        prisma.user.findMany.mockResolvedValue([
          ...five.map((i) => linked(i)),
          linked('driver', { driverProfile: { id: 'dp-1' } }),
        ]);

        const res = await service.syncKeycloakGroup('idlms-users');

        expect(res).toMatchObject({ removed: 0, deactivated: 1 });
        expect(prisma.user.delete).not.toHaveBeenCalled();
        expect(prisma.user.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'db-driver' },
            data: expect.objectContaining({ isActive: false, keycloakId: null }),
          }),
        );
        expect(redis.set).toHaveBeenCalledWith('jwt_user_disabled:db-driver', '1', 86400);
      });

      it('deactivates instead when the delete fails because something else still references the user', async () => {
        realmHas(...five);
        prisma.user.findMany.mockResolvedValue([...five.map((i) => linked(i)), linked('gone')]);
        prisma.user.delete.mockRejectedValueOnce(new Error('foreign key'));

        const res = await service.syncKeycloakGroup('idlms-users');

        expect(res).toMatchObject({ removed: 0, deactivated: 1 });
      });

      it('never touches a system administrator', async () => {
        realmHas(...five);
        prisma.user.findMany.mockResolvedValue([
          ...five.map((i) => linked(i)),
          linked('boss', { roles: ['SYSTEM_ADMIN'] }),
        ]);

        const res = await service.syncKeycloakGroup('idlms-users');

        expect(res).toMatchObject({ removed: 0, deactivated: 0 });
        expect(prisma.user.delete).not.toHaveBeenCalled();
        expect(prisma.user.update).not.toHaveBeenCalled();
      });

      it('does nothing when Keycloak could not be read', async () => {
        adminService.listAllUsers.mockResolvedValue(null);
        prisma.user.findMany.mockResolvedValue([linked('gone')]);

        const res = await service.syncKeycloakGroup('idlms-users');

        expect(res).toMatchObject({ removed: 0, deactivated: 0 });
        expect(prisma.user.findMany).not.toHaveBeenCalled();
      });

      it('does nothing when Keycloak returns no users at all', async () => {
        adminService.listAllUsers.mockResolvedValue([]);
        prisma.user.findMany.mockResolvedValue([linked('gone')]);

        const res = await service.syncKeycloakGroup('idlms-users');

        expect(res).toMatchObject({ removed: 0, deactivated: 0 });
        expect(prisma.user.delete).not.toHaveBeenCalled();
      });

      it('refuses a mass removal above the safety limit', async () => {
        realmHas('keep');
        // 20 linked, 19 missing: far above max(5, 10%).
        prisma.user.findMany.mockResolvedValue([
          linked('keep'),
          ...Array.from({ length: 19 }, (_, i) => linked(`gone${i}`)),
        ]);

        const res = await service.syncKeycloakGroup('idlms-users');

        expect(res).toMatchObject({ removed: 0, deactivated: 0 });
        expect(prisma.user.delete).not.toHaveBeenCalled();
        expect(prisma.user.update).not.toHaveBeenCalled();
      });
    });

    describe('realm scope (default)', () => {
      const kc = (id: string, username: string, extra: Record<string, unknown> = {}) => ({
        id, username, firstName: 'F', lastName: 'L', enabled: true, ...extra,
      });

      beforeEach(() => {
        process.env.KEYCLOAK_SYNC_SCOPE = 'realm';
        prisma.user.findFirst.mockResolvedValue(null);
        prisma.user.create.mockImplementation(async ({ data }: any) => ({ id: `db-${data.serviceNumber}`, ...data }));
      });

      it('brings in every realm user without needing a group', async () => {
        adminService.listAllUsers.mockResolvedValue([kc('k1', 'mod-1'), kc('k2', 'mod-2')] as any);

        const res = await service.syncKeycloakGroup();

        expect(res.created).toBe(2);
        expect(adminService.listGroupMembers).not.toHaveBeenCalled();
      });

      it('skips service accounts, which are not people', async () => {
        adminService.listAllUsers.mockResolvedValue([
          kc('k1', 'mod-1'),
          kc('k2', 'service-account-idlms-backend', { serviceAccountClientId: 'idlms-backend' }),
        ] as any);

        const res = await service.syncKeycloakGroup();

        expect(res.created).toBe(1);
        expect(prisma.user.create).toHaveBeenCalledTimes(1);
        expect(prisma.user.create).toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ serviceNumber: 'MOD-1' }) }),
        );
      });

      it('aborts without changing anything when the realm cannot be read', async () => {
        adminService.listAllUsers.mockResolvedValue(null);

        const res = await service.syncKeycloakGroup();

        expect(res).toMatchObject({ totalProcessed: 0, created: 0, removed: 0, deactivated: 0 });
        expect(prisma.user.create).not.toHaveBeenCalled();
        expect(prisma.user.findMany).not.toHaveBeenCalled();
      });
    });

    it('prevents overlapping concurrent sync operations', async () => {
      adminService.listGroupMembers.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve([]), 50)),
      );

      const promise1 = service.syncKeycloakGroup('idlms-users');
      const promise2 = service.syncKeycloakGroup('idlms-users');

      const [res1, res2] = await Promise.all([promise1, promise2]);

      expect(res1.totalProcessed).toBe(0);
      expect(res2.totalProcessed).toBe(0);
    });
  });
});
