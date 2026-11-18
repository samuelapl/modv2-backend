import { KeycloakTokenService } from './keycloak-token.service';
import { AppBadRequestException, AppUnauthorizedException } from '../../common/errors';

describe('KeycloakTokenService', () => {
  let service: KeycloakTokenService;
  const originalFetch = global.fetch;

  beforeEach(() => {
    service = new KeycloakTokenService();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  describe('loginDirectGrant', () => {
    it('successfully exchanges credentials for tokens', async () => {
      const mockTokens = {
        access_token: 'mock-access-token',
        expires_in: 300,
        refresh_expires_in: 1800,
        refresh_token: 'mock-refresh-token',
        token_type: 'Bearer',
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => mockTokens,
      });

      const result = await service.loginDirectGrant('MOD-1309001', 'TestPassword123!');
      expect(result.access_token).toBe('mock-access-token');

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/protocol/openid-connect/token'),
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: expect.stringContaining('username=mod-1309001'),
        }),
      );
    });

    it('maps invalid credentials error to AUTH_INVALID_CREDENTIALS', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({
          error: 'invalid_grant',
          error_description: 'Invalid user credentials',
        }),
      });

      await expect(
        service.loginDirectGrant('MOD-1309001', 'WrongPassword!'),
      ).rejects.toThrow(AppUnauthorizedException);
    });

    it('maps disabled account error to AUTH_ACCOUNT_INACTIVE', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({
          error: 'invalid_grant',
          error_description: 'Account is disabled',
        }),
      });

      await expect(
        service.loginDirectGrant('MOD-1309001', 'AnyPassword!'),
      ).rejects.toThrow(AppUnauthorizedException);
    });

    it('maps network unreachable to AUTH_ACCOUNT_UNAVAILABLE', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(
        service.loginDirectGrant('MOD-1309001', 'Password!'),
      ).rejects.toThrow(AppBadRequestException);
    });
  });

  describe('refreshToken', () => {
    it('successfully returns refreshed tokens', async () => {
      const mockTokens = {
        access_token: 'new-access-token',
        expires_in: 300,
        refresh_expires_in: 1800,
        refresh_token: 'new-refresh-token',
        token_type: 'Bearer',
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => mockTokens,
      });

      const result = await service.refreshToken('valid-refresh-token');
      expect(result.access_token).toBe('new-access-token');
    });

    it('throws AUTH_SESSION_EXPIRED if refresh fails', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
      });

      await expect(service.refreshToken('expired-refresh-token')).rejects.toThrow(
        AppUnauthorizedException,
      );
    });
  });

  describe('logout', () => {
    it('calls Keycloak logout endpoint', async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: true });

      await service.logout('refresh-token-to-revoke');

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/protocol/openid-connect/logout'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('refresh_token=refresh-token-to-revoke'),
        }),
      );
    });

    it('does nothing if refresh token is empty', async () => {
      global.fetch = jest.fn();
      await service.logout('');
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });
});
