import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ALLOW_PASSWORD_CHANGE_KEY } from '../decorators/allow-password-change.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AppForbiddenException } from '../errors';

/**
 * Runs after JwtAuthGuard. A user whose admin-issued temporary password has not
 * been changed yet can only reach routes marked @AllowWhenPasswordChangeRequired().
 */
@Injectable()
export class MustChangePasswordGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];

    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) {
      return true;
    }
    if (this.reflector.getAllAndOverride<boolean>(ALLOW_PASSWORD_CHANGE_KEY, targets)) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();
    if (user?.mustChangePassword) {
      throw new AppForbiddenException(
        'AUTH_PASSWORD_CHANGE_REQUIRED',
        {},
        'You must change your temporary password before continuing.',
      );
    }
    return true;
  }
}
