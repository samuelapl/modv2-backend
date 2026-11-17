import { SetMetadata } from '@nestjs/common';
import { Permission } from '../enums/permissions.enum';

export const PERMISSIONS_KEY = 'permissions';
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

export const ANY_PERMISSIONS_KEY = 'any_permissions';
export const RequireAnyPermission = (...permissions: Permission[]) =>
  SetMetadata(ANY_PERMISSIONS_KEY, permissions);
