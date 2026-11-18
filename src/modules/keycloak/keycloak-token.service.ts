import { Injectable, Logger } from '@nestjs/common';
import { getKeycloakConfig, KeycloakConfig } from './keycloak.config';
import { toKeycloakUsername } from './name-mapping';
import { AppBadRequestException, AppUnauthorizedException } from '../../common/errors';

export interface KeycloakTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_expires_in: number;
  refresh_token: string;
  token_type: string;
  id_token?: string;
  session_state?: string;
  scope?: string;
}

export interface KeycloakTokenClaims {
  sub: string;
  preferred_username?: string;
  given_name?: string;
  family_name?: string;
  email?: string;
  grandfatherName?: string;
  rank?: string;
  phone?: string;
  unitCode?: string;
  [key: string]: unknown;
}

@Injectable()
export class KeycloakTokenService {
  private readonly logger = new Logger(KeycloakTokenService.name);
  private readonly config: KeycloakConfig;

  constructor() {
    this.config = getKeycloakConfig();
  }

  /**
   * Exchanges serviceNumber and password for Keycloak tokens using OAuth 2.0 Direct Grant.
   */
  async loginDirectGrant(serviceNumber: string, password: string): Promise<KeycloakTokenResponse> {
    const url = `${this.config.baseUrl}/realms/${this.config.realm}/protocol/openid-connect/token`;

    const body = new URLSearchParams({
      grant_type: 'password',
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      username: toKeycloakUsername(serviceNumber),
      password,
      scope: 'openid profile email',
    });

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });

      if (!response.ok) {
        const errorJson = (await response.json().catch(() => ({}))) as {
          error?: string;
          error_description?: string;
        };
        this.handleTokenError(response.status, errorJson);
      }

      return (await response.json()) as KeycloakTokenResponse;
    } catch (err: unknown) {
      if (err instanceof AppUnauthorizedException || err instanceof AppBadRequestException) {
        throw err;
      }
      this.logger.error(`Keycloak service unreachable at ${url}: ${(err as Error).message}`);
      throw new AppBadRequestException(
        'AUTH_ACCOUNT_UNAVAILABLE',
        {},
        'Authentication service is currently unavailable. Please contact the administrator.',
      );
    }
  }

  /**
   * Refreshes an access token using a refresh token.
   */
  async refreshToken(refreshToken: string): Promise<KeycloakTokenResponse> {
    const url = `${this.config.baseUrl}/realms/${this.config.realm}/protocol/openid-connect/token`;

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      refresh_token: refreshToken,
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      throw new AppUnauthorizedException('AUTH_SESSION_EXPIRED', {}, 'Session expired.');
    }

    return (await response.json()) as KeycloakTokenResponse;
  }

  /**
   * Logs out from Keycloak by invalidating the refresh token.
   */
  async logout(refreshToken: string): Promise<void> {
    if (!refreshToken) return;
    const url = `${this.config.baseUrl}/realms/${this.config.realm}/protocol/openid-connect/logout`;

    const body = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      refresh_token: refreshToken,
    });

    try {
      await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });
    } catch (err) {
      this.logger.warn(`Failed to logout from Keycloak: ${(err as Error).message}`);
    }
  }

  private handleTokenError(_status: number, data: { error?: string; error_description?: string }): never {
    const desc = (data.error_description || '').toLowerCase();

    if (desc.includes('disabled') || desc.includes('inactive')) {
      throw new AppUnauthorizedException(
        'AUTH_ACCOUNT_INACTIVE',
        {},
        'Account is disabled in Keycloak.',
      );
    }

    throw new AppUnauthorizedException(
      'AUTH_INVALID_CREDENTIALS',
      {},
      'Invalid credentials.',
    );
  }
}
