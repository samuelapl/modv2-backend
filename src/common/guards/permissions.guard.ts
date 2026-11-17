import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  PERMISSIONS_KEY,
  ANY_PERMISSIONS_KEY,
} from '../decorators/permissions.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { Permission } from '../enums/permissions.enum';
import { PermissionResolverService } from '../services/permission-resolver.service';
import { AppForbiddenException } from '../errors';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissionResolver: PermissionResolverService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const requiredAll = this.reflector.getAllAndOverride<Permission[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    const requiredAny = this.reflector.getAllAndOverride<Permission[]>(
      ANY_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (
      (!requiredAll || requiredAll.length === 0) &&
      (!requiredAny || requiredAny.length === 0)
    ) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();
    if (!user) {
      throw new AppForbiddenException(
      'ACCESS_DENIED_UNAUTHENTICATED', {}, 'Access denied: Unauthenticated user.');
    }

    const resolved = await this.permissionResolver.resolveUserPermissions(
      user.roles || [],
      user.customPermissions || [],
    );
    const effectiveSet = new Set(resolved);

    // Attach resolved permissions onto request.user for row-level scoping in services
    user.resolvedPermissions = resolved;

    if (requiredAll && requiredAll.length > 0) {
      const hasAll = requiredAll.every((perm) => effectiveSet.has(perm));
      if (!hasAll) {
        throw new AppForbiddenException(
      'ACCESS_DENIED_MISSING_PERMISSIONS', { permissions: requiredAll.join(', ') }, 
          `Access denied: Missing required permission(s): [${requiredAll.join(', ')}]`,
        );
      }
    }

    if (requiredAny && requiredAny.length > 0) {
      const hasAny = requiredAny.some((perm) => effectiveSet.has(perm));
      if (!hasAny) {
        throw new AppForbiddenException(
      'ACCESS_DENIED_REQUIRES_ANY_PERMISSION', { permissions: requiredAny.join(', ') }, 
          `Access denied: Requires one of permission(s): [${requiredAny.join(', ')}]`,
        );
      }
    }

    return true;
  }
}
