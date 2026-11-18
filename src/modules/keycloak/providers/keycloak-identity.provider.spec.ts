import { KeycloakRemoteIdentityProvider } from './keycloak-identity.provider';
import { KeycloakAdminService } from '../keycloak-admin.service';
import { KeycloakTokenService } from '../keycloak-token.service';
import { AppBadRequestException } from '../../../common/errors';

describe('KeycloakRemoteIdentityProvider', () => {
  const originalScope = process.env.KEYCLOAK_SYNC_SCOPE;
  afterEach(() => {
    if (originalScope === undefined) delete process.env.KEYCLOAK_SYNC_SCOPE;
    else process.env.KEYCLOAK_SYNC_SCOPE = originalScope;
  });

  let provider: KeycloakRemoteIdentityProvider;
  let adminService: jest.Mocked<KeycloakAdminService>;
  let tokenService: jest.Mocked<KeycloakTokenService>;

  beforeEach(() => {
    adminService = {
      findUserByServiceNumber: jest.fn(),
      createUser: jest.fn(),
      updateUser: jest.fn(),
      setUserEnabled: jest.fn(),
      resetPassword: jest.fn(),
      deleteUser: jest.fn(),
      getServiceAccountToken: jest.fn(),
      addUserToGroup: jest.fn().mockResolvedValue(true),
    } as any;

    tokenService = {
      loginDirectGrant: jest.fn(),
      refreshToken: jest.fn(),
      logout: jest.fn(),
    } as any;

    provider = new KeycloakRemoteIdentityProvider(adminService, tokenService);
  });

  describe('createIdentity', () => {
    it('links to existing Keycloak user if already present (D1)', async () => {
      process.env.KEYCLOAK_SYNC_SCOPE = 'group';
      adminService.findUserByServiceNumber.mockResolvedValue({
        id: 'existing-kc-uuid',
        username: 'mod-1309001',
      } as any);

      const result = await provider.createIdentity({
        serviceNumber: 'MOD-1309001',
        firstName: 'Abebe',
        middleName: 'Kebede',
        lastName: 'Tessema',
      });

      expect(result.keycloakId).toBe('existing-kc-uuid');
      expect(adminService.createUser).not.toHaveBeenCalled();
      // The supplied password was not applied, so callers must not show it as a temporary password.
      expect(result.linkedExisting).toBe(true);
      expect(adminService.addUserToGroup).toHaveBeenCalledWith('existing-kc-uuid', 'idlms-users');
    });

    it('provisions new Keycloak user when not yet registered', async () => {
      process.env.KEYCLOAK_SYNC_SCOPE = 'group';
      adminService.findUserByServiceNumber.mockResolvedValue(null);
      adminService.createUser.mockResolvedValue('new-kc-uuid-999');

      const result = await provider.createIdentity({
        serviceNumber: 'MOD-99999',
        firstName: 'Almaz',
        middleName: 'Ayele',
        lastName: 'Tadesse',
        password: 'Password123!',
      });

      expect(result.keycloakId).toBe('new-kc-uuid-999');
      expect(result.linkedExisting).toBeUndefined();
      expect(adminService.createUser).toHaveBeenCalled();
      expect(adminService.addUserToGroup).toHaveBeenCalledWith('new-kc-uuid-999', 'idlms-users');
    });

    it('does not manage group membership in the default realm-wide scope', async () => {
      delete process.env.KEYCLOAK_SYNC_SCOPE;
      adminService.findUserByServiceNumber.mockResolvedValue(null);
      adminService.createUser.mockResolvedValue('kc-realm');

      await provider.createIdentity({ serviceNumber: 'MOD-4', password: 'Password123!' });

      expect(adminService.addUserToGroup).not.toHaveBeenCalled();
    });

    it('still creates the identity when joining the sync group fails (best effort)', async () => {
      process.env.KEYCLOAK_SYNC_SCOPE = 'group';
      adminService.findUserByServiceNumber.mockResolvedValue(null);
      adminService.createUser.mockResolvedValue('kc-3');
      adminService.addUserToGroup.mockResolvedValue(false);

      await expect(provider.createIdentity({ serviceNumber: 'MOD-3', password: 'Password123!' })).resolves.toEqual({
        keycloakId: 'kc-3',
      });
    });
  });

  describe('changePassword', () => {
    it('authenticates old password via direct grant, then sets new password', async () => {
      tokenService.loginDirectGrant.mockResolvedValue({} as any);
      adminService.findUserByServiceNumber.mockResolvedValue({
        id: 'user-uuid-123',
        username: 'mod-1309001',
      } as any);
      adminService.resetPassword.mockResolvedValue(undefined);

      await provider.changePassword('MOD-1309001', 'OldPassword123!', 'NewPassword123!');

      expect(tokenService.loginDirectGrant).toHaveBeenCalledWith('MOD-1309001', 'OldPassword123!');
      expect(adminService.resetPassword).toHaveBeenCalledWith('user-uuid-123', 'NewPassword123!');
    });
  });

  describe('resetPassword', () => {
    it('calls adminService.resetPassword', async () => {
      adminService.findUserByServiceNumber.mockResolvedValue({
        id: 'user-uuid-123',
        username: 'mod-1309001',
      } as any);
      adminService.resetPassword.mockResolvedValue(undefined);

      const res = await provider.resetPassword('MOD-1309001', 'TempPassword123!');
      expect(res).toEqual({});
      expect(adminService.resetPassword).toHaveBeenCalledWith('user-uuid-123', 'TempPassword123!');
    });

    it('throws if user not found in Keycloak', async () => {
      adminService.findUserByServiceNumber.mockResolvedValue(null);

      await expect(
        provider.resetPassword('MOD-UNKNOWN', 'TempPassword123!'),
      ).rejects.toThrow(AppBadRequestException);
    });
  });

  describe('setEnabled and deleteIdentity', () => {
    it('setEnabled delegates to adminService.setUserEnabled', async () => {
      adminService.findUserByServiceNumber.mockResolvedValue({
        id: 'user-uuid-123',
        username: 'mod-1309001',
      } as any);

      await provider.setEnabled('MOD-1309001', false);
      expect(adminService.setUserEnabled).toHaveBeenCalledWith('user-uuid-123', false);
    });

    it('deleteIdentity delegates to adminService.deleteUser', async () => {
      await provider.deleteIdentity('delete-uuid-123');
      expect(adminService.deleteUser).toHaveBeenCalledWith('delete-uuid-123');
    });
  });
});
