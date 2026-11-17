import { SetMetadata } from '@nestjs/common';

export const ALLOW_PASSWORD_CHANGE_KEY = 'allowWhenPasswordChangeRequired';

/**
 * Marks a route that a user with a temporary password may still call
 * (change-password, who-am-I, logout). Every other route is blocked until the
 * password is changed.
 */
export const AllowWhenPasswordChangeRequired = () =>
  SetMetadata(ALLOW_PASSWORD_CHANGE_KEY, true);
