import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SystemRole } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { AppForbiddenException } from '../errors';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<SystemRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();
    if (!user || !user.roles) {
      throw new AppForbiddenException(
      'ACCESS_DENIED_NO_ROLES', {}, 'Access denied: No roles assigned.');
    }

    const hasRole = requiredRoles.some((role) => user.roles.includes(role));
    if (!hasRole) {
      throw new AppForbiddenException(
      'ACCESS_DENIED_REQUIRES_ROLE', { roles: requiredRoles.join(', ') }, 
        `Access denied: Requires one of [${requiredRoles.join(', ')}]`,
      );
    }

    return true;
  }
}
