import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { RedisService } from '../../redis/redis.service';

@Injectable()
export class LoginRateLimitGuard implements CanActivate {
  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const maxAttempts = Number(
      this.config.get<string>('LOGIN_RATE_LIMIT_MAX') || 30,
    );
    const windowSeconds = Number(
      this.config.get<string>('LOGIN_RATE_LIMIT_WINDOW_SECONDS') || 60,
    );

    const forwarded = req.headers['x-forwarded-for'];
    const ip =
      (Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0])?.trim() ||
      req.ip ||
      'unknown';
    const serviceNumber = String((req.body as any)?.serviceNumber || 'anon')
      .trim()
      .toUpperCase();

    const key = `ratelimit:login:${ip}:${serviceNumber}`;
    const attempts = await this.redis.incrementWithTtl(key, windowSeconds);

    if (attempts > maxAttempts) {
      throw new HttpException(
        'Too many authentication attempts. Please wait briefly before retrying.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}
