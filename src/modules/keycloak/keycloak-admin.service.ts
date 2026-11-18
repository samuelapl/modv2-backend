import { Injectable, Logger } from '@nestjs/common';
import { getKeycloakConfig, KeycloakConfig } from './keycloak.config';
import {
  KeycloakUserRepresentation,
  toKeycloakUser,
  toKeycloakPartialUser,
  toKeycloakUsername,
} from './name-mapping';
import { CreateIdentityInput } from './keycloak-provider.interface';
import { AppBadRequestException, AppConflictException } from '../../common/errors';

@Injectable()
export class KeycloakAdminService {
  private readonly logger = new Logger(KeycloakAdminService.name);
  private readonly config: KeycloakConfig;

  private cachedAdminToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor() {
    this.config = getKeycloakConfig();
  }

  /**
   * Obtains a service account access token via client_credentials grant.
   * Caches the token until 30 seconds before expiration.
   */
  async getServiceAccountToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (this.cachedAdminToken && this.tokenExpiresAt > now + 30) {
      return this.cachedAdminToken;
    }

    const url = `${this.config.baseUrl}/realms/${this.config.realm}/protocol/openid-connect/token`;
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    });

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      this.logger.error(`Failed to obtain Keycloak service account token: ${res.status} ${err}`);
      throw new AppBadRequestException(
        'AUTH_ACCOUNT_UNAVAILABLE',
        {},
        'Identity service admin connection failed.',
      );
    }

    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.cachedAdminToken = json.access_token;
    this.tokenExpiresAt = now + (json.expires_in || 300);

    return this.cachedAdminToken;
  }

  /**
   * Finds a Keycloak user by service number (exact match on normalized username).
   */
  async findUserByServiceNumber(serviceNumber: string): Promise<KeycloakUserRepresentation | null> {
    const token = await this.getServiceAccountToken();
    const username = toKeycloakUsername(serviceNumber);
    const url = `${this.config.baseUrl}/admin/realms/${this.config.realm}/users?username=${encodeURIComponent(username)}&exact=true`;

    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });

    if (!res.ok) {
      return null;
    }

    const users = (await res.json()) as KeycloakUserRepresentation[];
    return users.length > 0 ? users[0] : null;
  }

  /**
   * Creates a user in Keycloak with optional password.
   * Returns the newly created Keycloak user UUID.
   */
  async createUser(input: CreateIdentityInput): Promise<string> {
    const token = await this.getServiceAccountToken();
    const userPayload: KeycloakUserRepresentation & { credentials?: Array<{ type: string; value: string; temporary: boolean }> } = toKeycloakUser(input);

    if (input.password) {
      userPayload.credentials = [
        {
          type: 'password',
          value: input.password,
          temporary: false,
        },
      ];
    }

    const url = `${this.config.baseUrl}/admin/realms/${this.config.realm}/users`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(userPayload),
    });

    if (res.status === 409) {
      throw new AppConflictException(
        'USERS_SERVICE_NUMBER_EXISTS',
        { serviceNumber: input.serviceNumber },
        `A Keycloak user with service number ${input.serviceNumber} already exists.`,
      );
    }

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      this.logger.error(`Failed to create Keycloak user ${input.serviceNumber}: ${res.status} ${err}`);
      throw new AppBadRequestException(
        'AUTH_ACCOUNT_UNAVAILABLE',
        {},
        'Failed to provision user in Keycloak.',
      );
    }

    // Extract user ID from Location header or lookup by service number
    const location = res.headers.get('location');
    if (location) {
      const parts = location.split('/');
      const createdId = parts[parts.length - 1];
      if (createdId) return createdId;
    }

    const lookup = await this.findUserByServiceNumber(input.serviceNumber);
    if (lookup?.id) {
      return lookup.id;
    }

    throw new AppBadRequestException(
      'AUTH_ACCOUNT_UNAVAILABLE',
      {},
      'User was created in Keycloak but identifier could not be retrieved.',
    );
  }

  /**
   * Updates user identity attributes (names, rank, phone, email) in Keycloak.
   */
  async updateUser(keycloakId: string, input: Partial<CreateIdentityInput>): Promise<void> {
    const token = await this.getServiceAccountToken();
    const url = `${this.config.baseUrl}/admin/realms/${this.config.realm}/users/${keycloakId}`;

    // Keycloak replaces the whole attribute map on PUT and validates required fields (email,
    // names), so a fragment would erase rank/phone/unit or be rejected. Merge the change into
    // the current representation instead.
    const currentRes = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (!currentRes.ok) {
      this.logger.error(`Failed to read Keycloak user ${keycloakId} before update: ${currentRes.status}`);
      throw new AppBadRequestException(
        'AUTH_ACCOUNT_UNAVAILABLE',
        {},
        'Failed to update user profile in Keycloak.',
      );
    }
    const current = (await currentRes.json()) as KeycloakUserRepresentation;

    const { attributes: changedAttributes, ...changedFields } = toKeycloakPartialUser(input);
    const scalars = Object.fromEntries(Object.entries(changedFields).filter(([, v]) => v !== undefined));

    const attributes: Record<string, string[]> = { ...(current.attributes ?? {}) };
    for (const [key, values] of Object.entries(changedAttributes ?? {})) {
      if (values.length > 0) attributes[key] = values;
      else delete attributes[key];
    }

    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...current, ...scalars, attributes }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      this.logger.error(`Failed to update Keycloak user ${keycloakId}: ${res.status} ${err}`);
      throw new AppBadRequestException(
        'AUTH_ACCOUNT_UNAVAILABLE',
        {},
        'Failed to update user profile in Keycloak.',
      );
    }
  }

  /**
   * Sets account enabled/disabled.
   */
  async setUserEnabled(keycloakId: string, enabled: boolean): Promise<void> {
    const token = await this.getServiceAccountToken();
    const url = `${this.config.baseUrl}/admin/realms/${this.config.realm}/users/${keycloakId}`;

    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ enabled }),
    });

    if (!res.ok) {
      this.logger.error(`Failed to update enabled state for Keycloak user ${keycloakId}: ${res.status}`);
    }
  }

  /**
   * Resets a user's password via the Admin REST API.
   */
  async resetPassword(keycloakId: string, newPassword: string): Promise<void> {
    const token = await this.getServiceAccountToken();
    const url = `${this.config.baseUrl}/admin/realms/${this.config.realm}/users/${keycloakId}/reset-password`;

    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'password',
        value: newPassword,
        temporary: false,
      }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      this.logger.error(`Failed to reset password for Keycloak user ${keycloakId}: ${res.status} ${err}`);
      throw new AppBadRequestException(
        'AUTH_ACCOUNT_UNAVAILABLE',
        {},
        'Failed to update password in Keycloak.',
      );
    }
  }

  /**
   * Deletes a user in Keycloak (used as compensation if local DB transaction fails).
   */
  async deleteUser(keycloakId: string): Promise<void> {
    const token = await this.getServiceAccountToken();
    const url = `${this.config.baseUrl}/admin/realms/${this.config.realm}/users/${keycloakId}`;

    try {
      await fetch(url, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (err) {
      this.logger.error(`Failed to delete (compensate) Keycloak user ${keycloakId}: ${(err as Error).message}`);
    }
  }

  /**
   * Adds a user to a group by name (idempotent). Returns false if the group does not exist
   * or the call fails, so callers can treat membership as best-effort.
   */
  async addUserToGroup(keycloakId: string, groupName: string): Promise<boolean> {
    const token = await this.getServiceAccountToken();
    try {
      const searchUrl = `${this.config.baseUrl}/admin/realms/${this.config.realm}/groups?search=${encodeURIComponent(groupName)}&exact=true`;
      const groupRes = await fetch(searchUrl, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });
      if (!groupRes.ok) return false;
      const groups = (await groupRes.json()) as Array<{ id: string; name: string }>;
      const group = groups.find((g) => g.name.toLowerCase() === groupName.toLowerCase());
      if (!group?.id) {
        this.logger.warn(`Keycloak group "${groupName}" not found; ${keycloakId} was not added to it.`);
        return false;
      }
      const res = await fetch(
        `${this.config.baseUrl}/admin/realms/${this.config.realm}/users/${keycloakId}/groups/${group.id}`,
        { method: 'PUT', headers: { Authorization: `Bearer ${token}` } },
      );
      return res.ok;
    } catch (err) {
      this.logger.warn(`Failed adding ${keycloakId} to group ${groupName}: ${(err as Error).message}`);
      return false;
    }
  }

  /**
   * Lists users in Keycloak. If groupName is specified, attempts to list members of that group.
   */
  async listGroupMembers(groupName: string, max = 1000): Promise<KeycloakUserRepresentation[]> {
    const token = await this.getServiceAccountToken();
    try {
      const groupSearchUrl = `${this.config.baseUrl}/admin/realms/${this.config.realm}/groups?search=${encodeURIComponent(groupName)}&exact=true`;
      const groupRes = await fetch(groupSearchUrl, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });

      if (groupRes.ok) {
        const groups = (await groupRes.json()) as Array<{ id: string; name: string }>;
        const targetGroup = groups.find((g) => g.name.toLowerCase() === groupName.toLowerCase());
        if (targetGroup?.id) {
          const membersUrl = `${this.config.baseUrl}/admin/realms/${this.config.realm}/groups/${targetGroup.id}/members?max=${max}`;
          const membersRes = await fetch(membersUrl, {
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
          });
          if (membersRes.ok) {
            return (await membersRes.json()) as KeycloakUserRepresentation[];
          }
        }
      }
    } catch (err) {
      this.logger.warn(`Failed querying group ${groupName}: ${(err as Error).message}`);
    }

    return this.listUsers(max);
  }

  /**
   * Every user in the realm (paged), or null if Keycloak could not be read. Unlike listUsers
   * this never returns a partial or empty list on failure, so a caller can tell
   * "Keycloak has no users" from "Keycloak did not answer".
   */
  async listAllUsers(pageSize = 500): Promise<KeycloakUserRepresentation[] | null> {
    try {
      const token = await this.getServiceAccountToken();
      const all: KeycloakUserRepresentation[] = [];
      for (let first = 0; ; first += pageSize) {
        const res = await fetch(
          `${this.config.baseUrl}/admin/realms/${this.config.realm}/users?first=${first}&max=${pageSize}`,
          { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
        );
        if (!res.ok) return null;
        const page = (await res.json()) as KeycloakUserRepresentation[];
        all.push(...page);
        if (page.length < pageSize) return all;
      }
    } catch (err) {
      this.logger.warn(`Failed listing all Keycloak users: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Lists realm users up to max.
   */
  async listUsers(max = 1000): Promise<KeycloakUserRepresentation[]> {
    const token = await this.getServiceAccountToken();
    const url = `${this.config.baseUrl}/admin/realms/${this.config.realm}/users?max=${max}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (!res.ok) {
      return [];
    }
    return (await res.json()) as KeycloakUserRepresentation[];
  }
}
