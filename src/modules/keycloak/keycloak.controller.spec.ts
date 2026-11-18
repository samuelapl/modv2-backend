import { KeycloakController } from './keycloak.controller';
import { KeycloakAdminService } from './keycloak-admin.service';
import { KeycloakSyncService } from './keycloak-sync.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { AppNotFoundException } from '../../common/errors';

describe('KeycloakController', () => {
  let controller: KeycloakController;
  let adminService: jest.Mocked<KeycloakAdminService>;
  let syncService: jest.Mocked<KeycloakSyncService>;
  let prisma: any;
  let redis: any;

  beforeEach(() => {
    adminService = {
      findUserByServiceNumber: jest.fn(),
    } as any;

    syncService = {
      syncKeycloakGroup: jest.fn(),
    } as any;

    prisma = {
      user: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    } as any;

    redis = {
      set: jest.fn(),
      get: jest.fn(),
    } as any;

    controller = new KeycloakController(adminService, syncService, prisma, redis);
  });

  describe('syncGroup', () => {
    it('delegates to syncService.syncKeycloakGroup', async () => {
      syncService.syncKeycloakGroup.mockResolvedValue({
        totalProcessed: 5,
        created: 2,
        updated: 3,
        disabled: 0,
        removed: 0,
        deactivated: 0,
        durationMs: 120,
      });

      const result = await controller.syncGroup();
      expect(result.totalProcessed).toBe(5);
      expect(syncService.syncKeycloakGroup).toHaveBeenCalled();
    });
  });

  describe('syncUser', () => {
    it('throws AppNotFoundException when user does not exist in Keycloak', async () => {
      adminService.findUserByServiceNumber.mockResolvedValue(null);

      await expect(controller.syncUser('MOD-NONEXISTENT')).rejects.toThrow(
        AppNotFoundException,
      );
    });

    it('updates existing IDLMS user and blacklists in Redis if disabled in Keycloak', async () => {
      adminService.findUserByServiceNumber.mockResolvedValue({
        id: 'kc-123',
        username: 'mod-1309001',
        firstName: 'Abebe',
        lastName: 'Kebede',
        enabled: false,
        attributes: {
          grandfatherName: ['Tessema'],
          rank: ['Captain'],
          phone: ['+251911000001'],
        },
      } as any);

      prisma.user.findFirst.mockResolvedValue({
        id: 'db-user-id',
        serviceNumber: 'MOD-1309001',
        isActive: true,
      } as any);

      prisma.user.update.mockResolvedValue({
        id: 'db-user-id',
        serviceNumber: 'MOD-1309001',
        isActive: false,
        lastSyncedAt: new Date(),
      } as any);

      const result = await controller.syncUser('MOD-1309001');

      expect(result.synced).toBe(true);
      expect(result.enabled).toBe(false);
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'db-user-id' },
          data: expect.objectContaining({ isActive: false }),
        }),
      );
      expect(redis.set).toHaveBeenCalledWith(
        'jwt_user_disabled:db-user-id',
        '1',
        86400,
      );
    });

    it('provisions new IDLMS user (JIT) if user exists in Keycloak but not in IDLMS DB', async () => {
      adminService.findUserByServiceNumber.mockResolvedValue({
        id: 'kc-new-user',
        username: 'mod-77777',
        firstName: 'Solomon',
        lastName: 'Girma',
        enabled: true,
        attributes: {
          grandfatherName: ['Bekele'],
          rank: ['Major'],
        },
      } as any);

      prisma.user.findFirst.mockResolvedValue(null);

      prisma.user.create.mockResolvedValue({
        id: 'new-db-id',
        serviceNumber: 'MOD-77777',
        isActive: true,
        lastSyncedAt: new Date(),
      } as any);

      const result = await controller.syncUser('MOD-77777');

      expect(result.synced).toBe(true);
      expect(result.userId).toBe('new-db-id');
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            serviceNumber: 'MOD-77777',
            keycloakId: 'kc-new-user',
            roles: [],
            isActive: true,
          }),
        }),
      );
    });
  });

  describe('handleWebhook', () => {
    it('receives webhook and synchronizes user state', async () => {
      adminService.findUserByServiceNumber.mockResolvedValue({
        id: 'kc-123',
        username: 'mod-1309001',
        enabled: false,
      } as any);

      prisma.user.findFirst.mockResolvedValue({
        id: 'db-user-id',
        serviceNumber: 'MOD-1309001',
      } as any);

      const result = await controller.handleWebhook({
        details: { username: 'mod-1309001' },
      });

      expect(result).toEqual({ received: true });
      expect(prisma.user.update).toHaveBeenCalled();
      expect(redis.set).toHaveBeenCalledWith('jwt_user_disabled:db-user-id', '1', 86400);
    });
  });
});
