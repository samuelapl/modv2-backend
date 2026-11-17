import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../../redis/redis.service';
import { AppUnauthorizedException } from '../../../common/errors';

export interface JwtPayload {
  sub: string;
  serviceNumber: string;
  exp?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>(
        'JWT_SECRET',
        'idlms_super_secret_jwt_key_2026_defense_grade',
      ),
      passReqToCallback: true,
    });
  }

  async validate(req: Request, payload: JwtPayload) {
    const authHeader = req.headers.authorization;
    const token = authHeader?.replace('Bearer ', '').trim();

    if (token) {
      const isBlacklisted = await this.redis.get(`jwt_blacklist:${token}`);
      if (isBlacklisted) {
        throw new AppUnauthorizedException(
      'AUTH_SESSION_EXPIRED', {}, 'Session expired or logged out.');
      }
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        serviceNumber: true,
        email: true,
        roles: true,
        customPermissions: true,
        unitId: true,
        isActive: true,
      },
    });

    if (!user || !user.isActive) {
      throw new AppUnauthorizedException(
      'AUTH_ACCOUNT_INACTIVE', {}, 'Account inactive or not found.');
    }

    return user;
  }
}
