import { Injectable, Logger } from '@nestjs/common';
import {
  CreateIdentityInput,
  CreatedIdentityResult,
  KeycloakIdentityProvider,
} from '../keycloak-provider.interface';
import { KeycloakAdminService } from '../keycloak-admin.service';
import { KeycloakTokenService } from '../keycloak-token.service';
import { AppBadRequestException, AppNotFoundException } from '../../../common/errors';
import { getSyncScope } from '../provisioning';

@Injectable()
export class KeycloakRemoteIdentityProvider implements KeycloakIdentityProvider {
  private readonly logger = new Logger(KeycloakRemoteIdentityProvider.name);

  constructor(
    private readonly adminService: KeycloakAdminService,
    private readonly tokenService: KeycloakTokenService,
  ) {}

  async hashPassword(_password: string): Promise<string> {
    // In Keycloak mode, passwords are stored directly in Keycloak.
    return '';
  }

  async verifyPassword(plaintext: string, hash: string): Promise<boolean> {
    // In Keycloak mode, verification is done through the token endpoint or admin API.
    // If local hash exists during transition, verify against it; otherwise return true if token succeeds.
    if (hash) {
      const bcrypt = await import('bcryptjs');
      return bcrypt.compare(plaintext, hash);
    }
    return true;
  }

  async createIdentity(input: CreateIdentityInput): Promise<CreatedIdentityResult> {
    // Link-if-exists check
    const existing = await this.adminService.findUserByServiceNumber(input.serviceNumber);
    if (existing && existing.id) {
      this.logger.log(`User ${input.serviceNumber} already exists in Keycloak (${existing.id}); linking identity.`);
      await this.joinSyncGroup(existing.id);
      // The supplied password was not applied to the existing account.
      return { keycloakId: existing.id, linkedExisting: true };
    }

    const keycloakId = await this.adminService.createUser(input);
    await this.joinSyncGroup(keycloakId);
    return { keycloakId };
  }

  /** Puts the user in the group the scheduled sync reads, so Keycloak-side edits reach IDLMS. */
  private async joinSyncGroup(keycloakId: string): Promise<void> {
    if (getSyncScope() !== 'group') return; // the realm-wide sync does not use a group
    const group = process.env.KEYCLOAK_SYNC_GROUP || 'idlms-users';
    await this.adminService.addUserToGroup(keycloakId, group);
  }

  async changePassword(serviceNumber: string, oldPassword: string, newPassword: string): Promise<void> {
    // 1. Verify old password via Direct Grant
    await this.tokenService.loginDirectGrant(serviceNumber, oldPassword);

    // 2. Update password in Keycloak via Admin API
    const user = await this.adminService.findUserByServiceNumber(serviceNumber);
    if (!user || !user.id) {
      throw new AppNotFoundException(
        'USERS_NOT_FOUND',
        { serviceNumber },
        `User ${serviceNumber} not found in Keycloak.`,
      );
    }

    await this.adminService.resetPassword(user.id, newPassword);
  }

  async resetPassword(serviceNumber: string, tempPassword: string): Promise<{ passwordHash?: string }> {
    const user = await this.adminService.findUserByServiceNumber(serviceNumber);
    if (!user || !user.id) {
      throw new AppBadRequestException(
        'USERS_NOT_FOUND',
        { serviceNumber },
        `User ${serviceNumber} not found in Keycloak.`,
      );
    }

    await this.adminService.resetPassword(user.id, tempPassword);
    return {};
  }

  async setEnabled(serviceNumber: string, enabled: boolean): Promise<void> {
    const user = await this.adminService.findUserByServiceNumber(serviceNumber);
    if (user?.id) {
      await this.adminService.setUserEnabled(user.id, enabled);
    }
  }

  async updateIdentity(serviceNumber: string, input: Partial<CreateIdentityInput>): Promise<void> {
    const user = await this.adminService.findUserByServiceNumber(serviceNumber);
    if (user?.id) {
      await this.adminService.updateUser(user.id, input);
    }
  }

  async deleteIdentity(keycloakId: string): Promise<void> {
    await this.adminService.deleteUser(keycloakId);
  }
}
