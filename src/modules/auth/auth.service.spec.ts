import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { SystemRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { PermissionResolverService } from '../../common/services/permission-resolver.service';
import { LocalIdentityProvider } from '../keycloak';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: {
    user: { findUnique: jest.Mock; findFirst: jest.Mock; create: jest.Mock; update: jest.Mock };
    driverProfile: { updateMany: jest.Mock };
  };
  let jwtService: { signAsync: jest.Mock; decode: jest.Mock };
  let redis: { set: jest.Mock };
  let permissionResolver: { resolveUserPermissions: jest.Mock };
  let keycloakTokenService: { loginDirectGrant: jest.Mock };
  let keycloakAdminService: { findUserByServiceNumber: jest.Mock };
  let keycloakProvider: { verifyPassword: jest.Mock; hashPassword: jest.Mock; changePassword: jest.Mock; updateIdentity: jest.Mock };

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      driverProfile: {
        updateMany: jest.fn(),
      },
    };
    jwtService = {
      signAsync: jest.fn().mockResolvedValue('signed-jwt-token'),
      decode: jest.fn().mockReturnValue({ exp: Math.floor(Date.now() / 1000) + 3600 }),
    };
    redis = {
      set: jest.fn().mockResolvedValue(undefined),
    };
    permissionResolver = {
      resolveUserPermissions: jest.fn().mockResolvedValue(['users:manage', 'roles:manage']),
    };
    keycloakTokenService = {
      loginDirectGrant: jest.fn(),
    };
    keycloakAdminService = {
      findUserByServiceNumber: jest.fn(),
    };
    keycloakProvider = new LocalIdentityProvider() as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: AuthService,
          useFactory: () =>
            new AuthService(
              prisma as any,
              jwtService as any,
              redis as any,
              permissionResolver as any,
              keycloakProvider as any,
              keycloakTokenService as any,
              keycloakAdminService as any,
            ),
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined and return READY status', () => {
    expect(service).toBeDefined();
    expect(service.getStatus().status).toBe('READY');
  });

  it('should authenticate valid user and return token + resolved permissions', async () => {
    const hash = await bcrypt.hash('MoD@2026!', 10);
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      serviceNumber: 'MOD-ADMIN-001',
      email: 'sysadmin@mod.gov.et',
      passwordHash: hash,
      roles: [SystemRole.SYSTEM_ADMIN],
      customPermissions: [],
      unitId: 'unit-1',
      isActive: true,
    });

    const result = await service.login({
      serviceNumber: 'mod-admin-001',
      password: 'MoD@2026!',
    });

    expect(result.accessToken).toBe('signed-jwt-token');
    expect(result.user.serviceNumber).toBe('MOD-ADMIN-001');
    expect(result.user.permissions).toEqual(['users:manage', 'roles:manage']);
  });

  it('should throw UnauthorizedException for invalid password', async () => {
    const hash = await bcrypt.hash('MoD@2026!', 10);
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      serviceNumber: 'MOD-ADMIN-001',
      passwordHash: hash,
      roles: [SystemRole.SYSTEM_ADMIN],
      isActive: true,
    });

    await expect(
      service.login({ serviceNumber: 'MOD-ADMIN-001', password: 'WrongPassword' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('should blacklist token in Redis on logout', async () => {
    const result = await service.logout('sample-token');
    expect(result).toEqual({ loggedOut: true });
    expect(redis.set).toHaveBeenCalledWith(
      'jwt_blacklist:sample-token',
      '1',
      expect.any(Number),
    );
  });

  it('returns the saved interface language on login and profile', async () => {
    const hash = await bcrypt.hash('MoD@2026!', 10);
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-am',
      serviceNumber: 'MOD-LIC-001',
      email: null,
      passwordHash: hash,
      roles: [SystemRole.CENTRAL_LICENSING_ADMIN],
      customPermissions: [],
      unitId: null,
      isActive: true,
      preferredLocale: 'am',
    });

    const login = await service.login({ serviceNumber: 'mod-lic-001', password: 'MoD@2026!' });
    expect(login.user.preferredLocale).toBe('am');

    const profile = await service.getProfile('user-am');
    expect(profile.preferredLocale).toBe('am');
  });

  it('saves the interface language', async () => {
    prisma.user.update.mockResolvedValue({ preferredLocale: 'am' });
    await expect(
      service.updatePreferences('user-1', { preferredLocale: 'am' }),
    ).resolves.toEqual({ preferredLocale: 'am' });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { preferredLocale: 'am' },
      select: { preferredLocale: true },
    });
  });
  describe('onboarding: temporary passwords', () => {
    const tempUser = async (over: Record<string, unknown> = {}) => ({
      id: 'user-tmp',
      serviceNumber: 'MOD-NEW-1',
      email: 'new@mod.gov.et',
      passwordHash: await bcrypt.hash('Temp#Pass12', 10),
      roles: [SystemRole.STAFF_DRIVER],
      customPermissions: [],
      unitId: 'unit-1',
      isActive: true,
      preferredLocale: 'en',
      mustChangePassword: true,
      tempPasswordExpiresAt: new Date(Date.now() + 86400000),
      driverProfile: { profileStatus: 'INCOMPLETE' },
      ...over,
    });

    it('login reports mustChangePassword and the driver profile status', async () => {
      prisma.user.findUnique.mockResolvedValue(await tempUser());
      const res = await service.login({ serviceNumber: 'mod-new-1', password: 'Temp#Pass12' });
      expect(res.user.mustChangePassword).toBe(true);
      expect(res.user.profileStatus).toBe('INCOMPLETE');
    });

    it('login reports a null profile status for staff without a driver profile', async () => {
      prisma.user.findUnique.mockResolvedValue(
        await tempUser({ driverProfile: null, mustChangePassword: false }),
      );
      const res = await service.login({ serviceNumber: 'mod-new-1', password: 'Temp#Pass12' });
      expect(res.user.mustChangePassword).toBe(false);
      expect(res.user.profileStatus).toBeNull();
    });

    it('rejects an expired temporary password (after checking it is correct)', async () => {
      prisma.user.findUnique.mockResolvedValue(
        await tempUser({ tempPasswordExpiresAt: new Date(Date.now() - 1000) }),
      );
      await expect(
        service.login({ serviceNumber: 'mod-new-1', password: 'Temp#Pass12' }),
      ).rejects.toMatchObject({ response: { code: 'AUTH_TEMP_PASSWORD_EXPIRED' } });
    });

    it('a wrong password on an expired account still reads as invalid credentials', async () => {
      prisma.user.findUnique.mockResolvedValue(
        await tempUser({ tempPasswordExpiresAt: new Date(Date.now() - 1000) }),
      );
      await expect(
        service.login({ serviceNumber: 'mod-new-1', password: 'wrong-pass1' }),
      ).rejects.toMatchObject({ response: { code: 'AUTH_INVALID_CREDENTIALS' } });
    });

    it('changePassword stores the new hash, clears the flag and signs the user out', async () => {
      prisma.user.findUnique.mockResolvedValue(await tempUser());
      prisma.user.update.mockResolvedValue({});

      const res = await service.changePassword(
        'user-tmp',
        { currentPassword: 'Temp#Pass12', newPassword: 'Brand-New9' },
        'jwt-123',
      );

      expect(res).toEqual({ passwordChanged: true });
      const data = prisma.user.update.mock.calls[0][0].data;
      expect(data.mustChangePassword).toBe(false);
      expect(data.tempPasswordExpiresAt).toBeNull();
      expect(data.passwordChangedAt).toBeInstanceOf(Date);
      expect(await bcrypt.compare('Brand-New9', data.passwordHash)).toBe(true);
      // the current token is blacklisted so the user must log in again
      expect(redis.set).toHaveBeenCalledWith('jwt_blacklist:jwt-123', '1', expect.any(Number));
    });

    it('changePassword rejects a wrong current password and changes nothing', async () => {
      prisma.user.findUnique.mockResolvedValue(await tempUser());
      await expect(
        service.changePassword('user-tmp', { currentPassword: 'nope-nope1', newPassword: 'Brand-New9' }, 't'),
      ).rejects.toMatchObject({ response: { code: 'AUTH_CURRENT_PASSWORD_INVALID' } });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('changePassword rejects reusing the current password', async () => {
      prisma.user.findUnique.mockResolvedValue(await tempUser());
      await expect(
        service.changePassword('user-tmp', { currentPassword: 'Temp#Pass12', newPassword: 'Temp#Pass12' }, 't'),
      ).rejects.toMatchObject({ response: { code: 'AUTH_PASSWORD_UNCHANGED' } });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('updateProfile', () => {
    it('updates phone and email and syncs driver profile phone', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce({
          id: 'user-1',
          email: 'old@mod.gov.et',
          phone: '+251911000000',
          isActive: true,
        })
        .mockResolvedValueOnce({
          id: 'user-1',
          serviceNumber: 'MOD-1309001',
          fullName: 'Test User',
          rank: 'Captain',
          phone: '+251922334455',
          email: 'new@mod.gov.et',
          roles: [SystemRole.STAFF_DRIVER],
          customPermissions: [],
          unitId: 'unit-1',
          isActive: true,
          preferredLocale: 'en',
          mustChangePassword: false,
          driverProfile: { profileStatus: 'COMPLETE' },
        });

      prisma.user.findFirst.mockResolvedValue(null);
      prisma.user.update.mockResolvedValue({});
      prisma.driverProfile.updateMany.mockResolvedValue({ count: 1 });

      const res = await service.updateProfile('user-1', {
        phone: '+251922334455',
        email: 'new@mod.gov.et',
      });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          phone: '+251922334455',
          email: 'new@mod.gov.et',
        },
      });
      expect(prisma.driverProfile.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        data: { contactPhone: '+251922334455' },
      });
      expect(res.phone).toBe('+251922334455');
      expect(res.email).toBe('new@mod.gov.et');
    });

    it('rejects an email that belongs to another user', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'me@mod.gov.et',
        phone: '+251911000000',
        isActive: true,
      });
      prisma.user.findFirst.mockResolvedValue({ id: 'user-other', email: 'taken@mod.gov.et' });

      await expect(
        service.updateProfile('user-1', { email: 'taken@mod.gov.et' }),
      ).rejects.toMatchObject({ response: { code: 'USERS_EMAIL_EXISTS' } });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('Keycloak Identity Provider Mode', () => {
    const originalEnv = process.env.IDENTITY_PROVIDER;

    beforeEach(() => {
      process.env.IDENTITY_PROVIDER = 'keycloak';
    });

    afterEach(() => {
      process.env.IDENTITY_PROVIDER = originalEnv;
    });

    it('provisions user JIT on first login when user exists only in Keycloak', async () => {
      keycloakTokenService.loginDirectGrant.mockResolvedValue({
        access_token: 'kc-token',
        expires_in: 300,
      });

      keycloakAdminService.findUserByServiceNumber.mockResolvedValue({
        id: 'kc-jit-uuid',
        username: 'mod-99999',
        firstName: 'Tadesse',
        lastName: 'Alemu',
        email: 'tadesse@mod.gov.et',
        enabled: true,
        attributes: {
          grandfatherName: ['Girma'],
          rank: ['Captain'],
          phone: ['+251911999999'],
        },
      });

      prisma.user.findFirst.mockResolvedValue(null);

      const createdUser = {
        id: 'new-jit-id',
        serviceNumber: 'MOD-99999',
        fullName: 'Tadesse Alemu Girma',
        rank: 'Captain',
        phone: '+251911999999',
        email: 'tadesse@mod.gov.et',
        roles: [],
        unitId: null,
        isActive: true,
        preferredLocale: 'en',
        mustChangePassword: false,
      };
      prisma.user.create.mockResolvedValue(createdUser);
      permissionResolver.resolveUserPermissions.mockResolvedValue([]);

      const result = await service.login({
        serviceNumber: 'mod-99999',
        password: 'Password123!',
      });

      expect(keycloakTokenService.loginDirectGrant).toHaveBeenCalledWith(
        'MOD-99999',
        'Password123!',
      );
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            serviceNumber: 'MOD-99999',
            keycloakId: 'kc-jit-uuid',
            roles: ['STAFF_DRIVER'],
          }),
        }),
      );
      expect(result.user.serviceNumber).toBe('MOD-99999');
      expect(result.user.roles).toEqual([]);
      expect(result.user.permissions).toEqual([]);
    });

    it('refreshes identity and issues IDLMS JWT when user already exists in DB', async () => {
      keycloakTokenService.loginDirectGrant.mockResolvedValue({
        access_token: 'kc-token',
      });

      keycloakAdminService.findUserByServiceNumber.mockResolvedValue({
        id: 'kc-existing-uuid',
        username: 'mod-1309001',
        firstName: 'Abebe',
        lastName: 'Kebede',
        enabled: true,
        attributes: {
          grandfatherName: ['Tessema'],
          rank: ['Major'],
          phone: ['+251911000000'],
        },
      });

      const existingUser = {
        id: 'user-id-1',
        serviceNumber: 'MOD-1309001',
        keycloakId: null,
        fullName: 'Abebe Kebede Old',
        rank: 'Captain',
        phone: '+251911000000',
        email: 'abebe@mod.gov.et',
        roles: [SystemRole.SYSTEM_ADMIN],
        customPermissions: [],
        unitId: 'unit-1',
        isActive: true,
        preferredLocale: 'en',
        mustChangePassword: false,
      };

      prisma.user.findFirst.mockResolvedValue(existingUser);
      prisma.user.update.mockResolvedValue({
        ...existingUser,
        keycloakId: 'kc-existing-uuid',
        fullName: 'Abebe Kebede Tessema',
        rank: 'Major',
      });

      const result = await service.login({
        serviceNumber: 'MOD-1309001',
        password: 'Password123!',
      });

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-id-1' },
          data: expect.objectContaining({
            keycloakId: 'kc-existing-uuid',
            rank: 'Major',
          }),
        }),
      );
      expect(result.accessToken).toBe('signed-jwt-token');
    });

    it('delegates changePassword to keycloakProvider when IDENTITY_PROVIDER=keycloak', async () => {
      const changePasswordSpy = jest
        .spyOn(keycloakProvider, 'changePassword')
        .mockResolvedValue(undefined);

      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        serviceNumber: 'MOD-1309001',
        isActive: true,
      });
      prisma.user.update.mockResolvedValue({});

      const result = await service.changePassword(
        'user-1',
        { currentPassword: 'OldPassword123!', newPassword: 'NewPassword123!' },
        'sample-token',
      );

      expect(changePasswordSpy).toHaveBeenCalledWith(
        'MOD-1309001',
        'OldPassword123!',
        'NewPassword123!',
      );
      expect(result.passwordChanged).toBe(true);
      expect(redis.set).toHaveBeenCalled();
    });
  });
});
