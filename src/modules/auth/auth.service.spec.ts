import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { SystemRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { PermissionResolverService } from '../../common/services/permission-resolver.service';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: { user: { findUnique: jest.Mock; update: jest.Mock } };
  let jwtService: { signAsync: jest.Mock; decode: jest.Mock };
  let redis: { set: jest.Mock };
  let permissionResolver: { resolveUserPermissions: jest.Mock };

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        update: jest.fn(),
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwtService },
        { provide: RedisService, useValue: redis },
        { provide: PermissionResolverService, useValue: permissionResolver },
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
});
