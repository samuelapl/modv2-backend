import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import {
  CreateIdentityInput,
  CreatedIdentityResult,
  KeycloakIdentityProvider,
} from '../keycloak-provider.interface';

@Injectable()
export class LocalIdentityProvider implements KeycloakIdentityProvider {
  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 10);
  }

  async verifyPassword(plaintext: string, hash: string): Promise<boolean> {
    if (!hash) return false;
    return bcrypt.compare(plaintext, hash);
  }

  async createIdentity(input: CreateIdentityInput): Promise<CreatedIdentityResult> {
    const passwordHash = input.password ? await this.hashPassword(input.password) : undefined;
    return { passwordHash };
  }

  async changePassword(_serviceNumber: string, _oldPassword: string, _newPassword: string): Promise<void> {
    // In local mode, the caller (AuthService) verifies old password & updates user record with hashed new password
  }

  async resetPassword(_serviceNumber: string, tempPassword: string): Promise<{ passwordHash?: string }> {
    const passwordHash = await this.hashPassword(tempPassword);
    return { passwordHash };
  }

  async setEnabled(_serviceNumber: string, _enabled: boolean): Promise<void> {
    // In local mode, user.isActive in IDLMS database is the sole authority
  }

  async updateIdentity(_serviceNumber: string, _input: Partial<CreateIdentityInput>): Promise<void> {
    // In local mode, IDLMS database is the sole authority
  }

  async deleteIdentity(_keycloakId: string): Promise<void> {
    // No-op in local mode
  }
}
