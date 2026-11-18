export const KEYCLOAK_PROVIDER_TOKEN = 'KEYCLOAK_IDENTITY_PROVIDER';

export interface CreateIdentityInput {
  serviceNumber: string;
  password?: string;
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
  rank?: string | null;
  phone?: string | null;
  email?: string | null;
  unitCode?: string | null;
  mustChangePassword?: boolean;
}

export interface CreatedIdentityResult {
  keycloakId?: string;
  passwordHash?: string;
  /**
   * True when the identity already existed in the identity provider and was only linked.
   * The password passed to createIdentity was NOT applied, so it must not be shown to an admin.
   */
  linkedExisting?: boolean;
}

export interface KeycloakIdentityProvider {
  /** Hashes a password (used for local bcrypt store). */
  hashPassword(password: string): Promise<string>;

  /** Compares a plaintext password against a stored hash. */
  verifyPassword(plaintext: string, hash: string): Promise<boolean>;

  /** Provisions a user identity. Returns keycloakId (Keycloak) and/or passwordHash (Local). */
  createIdentity(input: CreateIdentityInput): Promise<CreatedIdentityResult>;

  /** Changes the user's password. */
  changePassword(serviceNumber: string, oldPassword: string, newPassword: string): Promise<void>;

  /** Resets the user's password to an admin-issued temporary password. */
  resetPassword(serviceNumber: string, tempPassword: string): Promise<{ passwordHash?: string }>;

  /** Enables or disables the account identity. */
  setEnabled(serviceNumber: string, enabled: boolean): Promise<void>;

  /** Updates user identity fields (names, rank, phone, email). */
  updateIdentity?(serviceNumber: string, input: Partial<CreateIdentityInput>): Promise<void>;

  /** Compensates / rolls back user creation by deleting from identity provider if local insert failed. */
  deleteIdentity?(keycloakId: string): Promise<void>;
}
