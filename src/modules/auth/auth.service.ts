import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { PermissionResolverService } from '../../common/services/permission-resolver.service';
import { LoginDto } from './dto/login.dto';
import { LoginResponseDto, AuthenticatedUserDto } from './dto/auth-response.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { AppBadRequestException, AppUnauthorizedException } from '../../common/errors';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly redis: RedisService,
    private readonly permissionResolver: PermissionResolverService,
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

    const user = await this.prisma.user.findUnique({
      where: { serviceNumber: normalizedServiceNumber },
      include: { driverProfile: { select: { profileStatus: true } } },
    });

    if (!user || !user.isActive) {
      throw new AppUnauthorizedException(
      'AUTH_INVALID_SERVICE_NUMBER_OR_INACTIVE', {}, 'Invalid service number or inactive account.');
    }

    const passwordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordValid) {
      throw new AppUnauthorizedException(
      'AUTH_INVALID_CREDENTIALS', {}, 'Invalid credentials.');
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
      permissions,
      preferredLocale: user.preferredLocale,
      mustChangePassword: user.mustChangePassword,
      profileStatus: user.driverProfile?.profileStatus ?? null,
    };
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
      select: { id: true, passwordHash: true, isActive: true },
    });
    if (!user || !user.isActive) {
      throw new AppUnauthorizedException(
        'AUTH_ACCOUNT_UNAVAILABLE', {}, 'User account unavailable.');
    }

    const currentValid = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!currentValid) {
      throw new AppBadRequestException(
        'AUTH_CURRENT_PASSWORD_INVALID', {}, 'The current password is incorrect.');
    }
    if (dto.currentPassword === dto.newPassword) {
      throw new AppBadRequestException(
        'AUTH_PASSWORD_UNCHANGED',
        {},
        'The new password must be different from the current password.',
      );
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: await bcrypt.hash(dto.newPassword, 10),
        mustChangePassword: false,
        passwordChangedAt: new Date(),
        tempPasswordExpiresAt: null,
      },
    });

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
