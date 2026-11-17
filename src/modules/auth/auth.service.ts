import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { PermissionResolverService } from '../../common/services/permission-resolver.service';
import { LoginDto } from './dto/login.dto';
import { LoginResponseDto, AuthenticatedUserDto } from './dto/auth-response.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { AppUnauthorizedException } from '../../common/errors';

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
    };
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
