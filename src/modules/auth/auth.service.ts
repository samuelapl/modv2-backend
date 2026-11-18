import { Inject, Injectable, Optional } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { PermissionResolverService } from '../../common/services/permission-resolver.service';
import {
  KEYCLOAK_PROVIDER_TOKEN,
  KeycloakIdentityProvider,
  LocalIdentityProvider,
  KeycloakTokenService,
  KeycloakAdminService,
  toIdlmsIdentity,
  getDefaultRoles,
  resolveUnitId,
  ensureDriverProfile,
} from '../keycloak';
import { LoginDto } from './dto/login.dto';
import { LoginResponseDto, AuthenticatedUserDto } from './dto/auth-response.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import {
  AppBadRequestException,
  AppConflictException,
  AppUnauthorizedException,
} from '../../common/errors';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly redis: RedisService,
    private readonly permissionResolver: PermissionResolverService,
    @Optional()
    @Inject(KEYCLOAK_PROVIDER_TOKEN)
    private readonly identityProvider: KeycloakIdentityProvider = new LocalIdentityProvider(),
    @Optional()
    private readonly keycloakTokenService?: KeycloakTokenService,
    @Optional()
    private readonly keycloakAdminService?: KeycloakAdminService,
  ) {}

  getStatus() {
    return {
      module: 'auth',
      description: 'Authentication, JWT & Session Management',
      status: 'READY',
    };
  }

  async login(dto: LoginDto): Promise<LoginResponseDto> {
    const normalizedServiceNumber = dto.serviceNumber.trim().toUpperCase();

    const isKeycloak = process.env.IDENTITY_PROVIDER === 'keycloak';

    if (isKeycloak && this.keycloakTokenService) {
      await this.keycloakTokenService.loginDirectGrant(normalizedServiceNumber, dto.password);

      const kcUser = this.keycloakAdminService
        ? await this.keycloakAdminService.findUserByServiceNumber(normalizedServiceNumber)
        : null;
      const mapped = kcUser ? toIdlmsIdentity(kcUser) : null;

      let user = await this.prisma.user.findFirst({
        where: {
          OR: [
            { serviceNumber: normalizedServiceNumber },
            ...(kcUser?.id ? [{ keycloakId: kcUser.id }] : []),
          ],
        },
        include: {
          unit: { select: { id: true, name: true, code: true } },
          driverProfile: { select: { profileStatus: true } },
        },
      });

      if (!user) {
        const newUnitId = await resolveUnitId(this.prisma, mapped?.unitCode);
        user = await this.prisma.user.create({
          data: {
            serviceNumber: normalizedServiceNumber,
            ...(newUnitId ? { unitId: newUnitId } : {}),
            keycloakId: kcUser?.id ?? null,
            firstName: mapped?.firstName ?? null,
            middleName: mapped?.middleName ?? null,
            lastName: mapped?.lastName ?? null,
            fullName: mapped?.fullName ?? normalizedServiceNumber,
            rank: mapped?.rank ?? null,
            phone: mapped?.phone ?? null,
            email: mapped?.email ?? null,
            roles: getDefaultRoles(),
            // An admin set the password in Keycloak, so the person must choose their own.
            mustChangePassword: true,
            isActive: kcUser?.enabled ?? true,
            lastSyncedAt: new Date(),
          },
          include: {
            unit: { select: { id: true, name: true, code: true } },
            driverProfile: { select: { profileStatus: true } },
          },
        });
        const profile = await ensureDriverProfile(this.prisma, user);
        if (profile) user = { ...user, driverProfile: { profileStatus: profile.profileStatus as any } };
      } else {
        const updateData: any = { lastSyncedAt: new Date() };
        if (!user.unitId) {
          const unitId = await resolveUnitId(this.prisma, mapped?.unitCode);
          if (unitId) updateData.unitId = unitId;
        }
        if (kcUser?.id && user.keycloakId !== kcUser.id) {
          updateData.keycloakId = kcUser.id;
        }
        if (mapped) {
          if (mapped.firstName) updateData.firstName = mapped.firstName;
          if (mapped.middleName) updateData.middleName = mapped.middleName;
          if (mapped.lastName) updateData.lastName = mapped.lastName;
          if (mapped.fullName) updateData.fullName = mapped.fullName;
          if (mapped.rank !== undefined) updateData.rank = mapped.rank;
          if (mapped.phone !== undefined) updateData.phone = mapped.phone;
          if (mapped.email !== undefined) updateData.email = mapped.email;
          if (kcUser.enabled !== undefined) updateData.isActive = kcUser.enabled;
        }
        user = await this.prisma.user.update({
          where: { id: user.id },
          data: updateData,
          include: {
            unit: { select: { id: true, name: true, code: true } },
            driverProfile: { select: { profileStatus: true } },
          },
        });
      }

      if (!user.isActive) {
        throw new AppUnauthorizedException(
          'AUTH_INVALID_SERVICE_NUMBER_OR_INACTIVE',
          {},
          'Invalid service number or inactive account.',
        );
      }

      const permissions = await this.permissionResolver.resolveUserPermissions(
        user.roles,
        user.customPermissions,
      );

      const payload = {
        sub: user.id,
        serviceNumber: user.serviceNumber,
        jti: randomUUID(),
      };

      const accessToken = await this.jwtService.signAsync(payload);

      return {
        accessToken,
        user: {
          id: user.id,
          serviceNumber: user.serviceNumber,
          fullName: user.fullName ?? null,
          rank: user.rank ?? null,
          phone: user.phone ?? null,
          email: user.email,
          roles: user.roles,
          unitId: user.unitId,
          unit: (user as any).unit ?? null,
          permissions,
          preferredLocale: user.preferredLocale,
          mustChangePassword: user.mustChangePassword,
          profileStatus: user.driverProfile?.profileStatus ?? null,
        },
      };
    }

    const user = await this.prisma.user.findUnique({
      where: { serviceNumber: normalizedServiceNumber },
      include: {
        unit: { select: { id: true, name: true, code: true } },
        driverProfile: { select: { profileStatus: true } },
      },
    });

    if (!user || !user.isActive) {
      throw new AppUnauthorizedException(
        'AUTH_INVALID_SERVICE_NUMBER_OR_INACTIVE',
        {},
        'Invalid service number or inactive account.',
      );
    }

    if (!user.passwordHash) {
      throw new AppUnauthorizedException(
        'AUTH_INVALID_CREDENTIALS',
        {},
        'Invalid credentials.',
      );
    }

    const passwordValid = await this.identityProvider.verifyPassword(
      dto.password,
      user.passwordHash,
    );
    if (!passwordValid) {
      throw new AppUnauthorizedException(
        'AUTH_INVALID_CREDENTIALS',
        {},
        'Invalid credentials.',
      );
    }

    if (
      user.mustChangePassword &&
      user.tempPasswordExpiresAt &&
      user.tempPasswordExpiresAt.getTime() < Date.now()
    ) {
      throw new AppUnauthorizedException(
        'AUTH_TEMP_PASSWORD_EXPIRED',
        {},
        'Your temporary password has expired. Ask an administrator to reset it.',
      );
    }

    const permissions = await this.permissionResolver.resolveUserPermissions(
      user.roles,
      user.customPermissions,
    );

    const payload = {
      sub: user.id,
      serviceNumber: user.serviceNumber,
      jti: randomUUID(),
    };

    const accessToken = await this.jwtService.signAsync(payload);

    return {
      accessToken,
      user: {
        id: user.id,
        serviceNumber: user.serviceNumber,
        fullName: user.fullName ?? null,
        rank: user.rank ?? null,
        phone: user.phone ?? null,
        email: user.email,
        roles: user.roles,
        unitId: user.unitId,
        unit: (user as any).unit ?? null,
        permissions,
        preferredLocale: user.preferredLocale,
        mustChangePassword: user.mustChangePassword,
        profileStatus: user.driverProfile?.profileStatus ?? null,
      },
    };
  }

  async logout(token: string): Promise<{ loggedOut: boolean }> {
    if (!token) {
      return { loggedOut: true };
    }

    const decoded = this.jwtService.decode(token) as { exp?: number } | null;
    const nowSeconds = Math.floor(Date.now() / 1000);
    const ttlSeconds = decoded?.exp ? Math.max(60, decoded.exp - nowSeconds) : 86400;

    await this.redis.set(`jwt_blacklist:${token}`, '1', ttlSeconds);
    return { loggedOut: true };
  }

  async getProfile(userId: string): Promise<AuthenticatedUserDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        serviceNumber: true,
        fullName: true,
        rank: true,
        phone: true,
        email: true,
        roles: true,
        customPermissions: true,
        unitId: true,
        unit: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
        isActive: true,
        preferredLocale: true,
        mustChangePassword: true,
        driverProfile: { select: { profileStatus: true } },
      },
    });

    if (!user || !user.isActive) {
      throw new AppUnauthorizedException(
      'AUTH_ACCOUNT_UNAVAILABLE', {}, 'User account unavailable.');
    }

    const permissions = await this.permissionResolver.resolveUserPermissions(
      user.roles,
      user.customPermissions,
    );

    return {
      id: user.id,
      serviceNumber: user.serviceNumber,
      fullName: user.fullName ?? null,
      rank: user.rank ?? null,
      phone: user.phone ?? null,
      email: user.email,
      roles: user.roles,
      unitId: user.unitId,
      unit: (user as any).unit ?? null,
      permissions,
      preferredLocale: user.preferredLocale,
      mustChangePassword: user.mustChangePassword,
      profileStatus: user.driverProfile?.profileStatus ?? null,
    };
  }

  /**
   * Updates contact information (phone, email) for the signed-in user.
   * If driver profile exists for this account, contactPhone is synced as well.
   */
  async updateProfile(
    userId: string,
    dto: UpdateProfileDto,
  ): Promise<AuthenticatedUserDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, serviceNumber: true, email: true, phone: true, isActive: true },
    });
    if (!user || !user.isActive) {
      throw new AppUnauthorizedException(
        'AUTH_ACCOUNT_UNAVAILABLE',
        {},
        'User account unavailable.',
      );
    }

    const dataToUpdate: { phone?: string | null; email?: string | null } = {};

    if (dto.phone !== undefined) {
      dataToUpdate.phone = dto.phone ? dto.phone.trim() : null;
    }

    if (dto.email !== undefined) {
      const normalizedEmail = dto.email ? dto.email.trim().toLowerCase() : null;
      if (normalizedEmail && normalizedEmail !== user.email?.toLowerCase()) {
        const existing = await this.prisma.user.findFirst({
          where: {
            email: { equals: normalizedEmail, mode: 'insensitive' },
            NOT: { id: userId },
          },
        });
        if (existing) {
          throw new AppConflictException(
            'USERS_EMAIL_EXISTS',
            { email: normalizedEmail },
            'A user with this email address already exists.',
          );
        }
      }
      dataToUpdate.email = normalizedEmail;
    }

    if (Object.keys(dataToUpdate).length > 0) {
      await this.prisma.user.update({
        where: { id: userId },
        data: dataToUpdate,
      });

      if (this.identityProvider.updateIdentity) {
        await this.identityProvider.updateIdentity(user.serviceNumber, dataToUpdate);
      }

      if (dataToUpdate.phone !== undefined) {
        await this.prisma.driverProfile.updateMany({
          where: { userId },
          data: { contactPhone: dataToUpdate.phone },
        });
      }
    }

    return this.getProfile(userId);
  }

  /**
   * Sets a new password and ends the current session (the token is blacklisted),
   * so the user signs in again with the new credentials.
   */
  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
    token: string,
  ): Promise<{ passwordChanged: boolean }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, serviceNumber: true, passwordHash: true, isActive: true },
    });
    if (!user || !user.isActive) {
      throw new AppUnauthorizedException(
        'AUTH_ACCOUNT_UNAVAILABLE', {}, 'User account unavailable.');
    }

    if (dto.currentPassword === dto.newPassword) {
      throw new AppBadRequestException(
        'AUTH_PASSWORD_UNCHANGED',
        {},
        'The new password must be different from the current password.',
      );
    }

    if (process.env.IDENTITY_PROVIDER === 'keycloak') {
      await this.identityProvider.changePassword(
        user.serviceNumber,
        dto.currentPassword,
        dto.newPassword,
      );
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          mustChangePassword: false,
          passwordChangedAt: new Date(),
          tempPasswordExpiresAt: null,
        },
      });
    } else {
      if (!user.passwordHash) {
        throw new AppBadRequestException(
          'AUTH_CURRENT_PASSWORD_INVALID', {}, 'The current password is incorrect.');
      }

      const currentValid = await this.identityProvider.verifyPassword(dto.currentPassword, user.passwordHash);
      if (!currentValid) {
        throw new AppBadRequestException(
          'AUTH_CURRENT_PASSWORD_INVALID', {}, 'The current password is incorrect.');
      }

      const newPasswordHash = await this.identityProvider.hashPassword(dto.newPassword);

      await this.prisma.user.update({
        where: { id: userId },
        data: {
          passwordHash: newPasswordHash,
          mustChangePassword: false,
          passwordChangedAt: new Date(),
          tempPasswordExpiresAt: null,
        },
      });
    }

    await this.logout(token);
    return { passwordChanged: true };
  }

  /** Save the signed-in user's interface language. */
  async updatePreferences(
    userId: string,
    dto: UpdatePreferencesDto,
  ): Promise<{ preferredLocale: string }> {
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { preferredLocale: dto.preferredLocale },
      select: { preferredLocale: true },
    });
    return { preferredLocale: updated.preferredLocale };
  }
}
