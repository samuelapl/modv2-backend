import { KeycloakAdminService } from './keycloak-admin.service';
import { AppBadRequestException, AppConflictException } from '../../common/errors';

describe('KeycloakAdminService', () => {
  let service: KeycloakAdminService;
  const originalFetch = global.fetch;

  beforeEach(() => {
    service = new KeycloakAdminService();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  describe('getServiceAccountToken', () => {
    it('fetches and caches service account token', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'admin-token-123',
          expires_in: 300,
        }),
      });

      const token1 = await service.getServiceAccountToken();
      expect(token1).toBe('admin-token-123');

      // Second call should reuse cached token
      const token2 = await service.getServiceAccountToken();
      expect(token2).toBe('admin-token-123');
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('throws AppBadRequestException if service account request fails', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized client',
      });

      await expect(service.getServiceAccountToken()).rejects.toThrow(
        AppBadRequestException,
      );
    });
  });

  describe('findUserByServiceNumber', () => {
    it('queries user by exact normalized lowercase username', async () => {
      const mockUser = {
        id: 'kc-uuid-123',
        username: 'mod-1309001',
        firstName: 'Abebe',
        lastName: 'Kebede',
        enabled: true,
      };

      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          // token request
          ok: true,
          json: async () => ({ access_token: 'admin-token', expires_in: 300 }),
        })
        .mockResolvedValueOnce({
          // users search
          ok: true,
          json: async () => [mockUser],
        });

      const result = await service.findUserByServiceNumber('MOD-1309001');
      expect(result).toEqual(mockUser);
      expect(global.fetch).toHaveBeenLastCalledWith(
        expect.stringContaining('username=mod-1309001&exact=true'),
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer admin-token' }),
        }),
      );
    });

    it('returns null if no user matches', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'admin-token', expires_in: 300 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [],
        });

      const result = await service.findUserByServiceNumber('MOD-NONEXISTENT');
      expect(result).toBeNull();
    });
  });

  describe('createUser', () => {
    it('creates user and extracts UUID from location header', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'admin-token', expires_in: 300 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          headers: {
            get: (header: string) =>
              header.toLowerCase() === 'location'
                ? 'http://localhost:8080/admin/realms/mod-defense/users/new-uuid-456'
                : null,
          },
        });

      const id = await service.createUser({
        serviceNumber: 'MOD-99999',
        firstName: 'Almaz',
        middleName: 'Ayele',
        lastName: 'Tadesse',
        password: 'InitialPassword123!',
      });

      expect(id).toBe('new-uuid-456');
    });

    it('throws USERS_SERVICE_NUMBER_EXISTS on 409 conflict', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'admin-token', expires_in: 300 }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 409,
        });

      await expect(
        service.createUser({
          serviceNumber: 'MOD-EXISTING',
          firstName: 'Abebe',
        }),
      ).rejects.toThrow(AppConflictException);
    });
  });

  describe('setUserEnabled', () => {
    it('sends PUT to update enabled state', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'admin-token', expires_in: 300 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 204,
        });

      await service.setUserEnabled('user-uuid-123', false);

      expect(global.fetch).toHaveBeenLastCalledWith(
        expect.stringContaining('/users/user-uuid-123'),
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ enabled: false }),
        }),
      );
    });
  });

  describe('deleteUser (compensation)', () => {
    it('sends DELETE to remove user from Keycloak', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'admin-token', expires_in: 300 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 204,
        });

      await service.deleteUser('rollback-uuid-789');

      expect(global.fetch).toHaveBeenLastCalledWith(
        expect.stringContaining('/users/rollback-uuid-789'),
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });

  describe('addUserToGroup', () => {
    const tokenResponse = { ok: true, json: async () => ({ access_token: 'admin-token', expires_in: 300 }) };

    it('finds the group by name and adds the user to it', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce(tokenResponse)
        .mockResolvedValueOnce({ ok: true, json: async () => [{ id: 'grp-1', name: 'idlms-users' }] })
        .mockResolvedValueOnce({ ok: true, status: 204 });

      await expect(service.addUserToGroup('user-1', 'idlms-users')).resolves.toBe(true);
      expect(global.fetch).toHaveBeenLastCalledWith(
        expect.stringContaining('/users/user-1/groups/grp-1'),
        expect.objectContaining({ method: 'PUT' }),
      );
    });

    it('returns false (without throwing) when the group does not exist', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce(tokenResponse)
        .mockResolvedValueOnce({ ok: true, json: async () => [] });

      await expect(service.addUserToGroup('user-1', 'missing-group')).resolves.toBe(false);
    });

    it('returns false when Keycloak is unreachable', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce(tokenResponse).mockRejectedValueOnce(new Error('boom'));

      await expect(service.addUserToGroup('user-1', 'idlms-users')).resolves.toBe(false);
    });
  });

  describe('listAllUsers', () => {
    const tokenResponse = { ok: true, json: async () => ({ access_token: 'admin-token', expires_in: 300 }) };
    const page = (n: number, from = 0) =>
      Array.from({ length: n }, (_, i) => ({ id: `kc-${from + i}`, username: `u${from + i}` }));

    it('reads every page until a short one', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce(tokenResponse)
        .mockResolvedValueOnce({ ok: true, json: async () => page(2) })
        .mockResolvedValueOnce({ ok: true, json: async () => page(2, 2) })
        .mockResolvedValueOnce({ ok: true, json: async () => page(1, 4) });

      const users = await service.listAllUsers(2);

      expect(users).toHaveLength(5);
      expect(global.fetch).toHaveBeenLastCalledWith(expect.stringContaining('first=4&max=2'), expect.anything());
    });

    it('returns null, not a partial list, when a page fails', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce(tokenResponse)
        .mockResolvedValueOnce({ ok: true, json: async () => page(2) })
        .mockResolvedValueOnce({ ok: false, status: 500 });

      await expect(service.listAllUsers(2)).resolves.toBeNull();
    });

    it('returns null when Keycloak is unreachable', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce(tokenResponse).mockRejectedValueOnce(new Error('down'));

      await expect(service.listAllUsers(2)).resolves.toBeNull();
    });
  });

  describe('updateUser (merges, never replaces)', () => {
    const tokenResponse = { ok: true, json: async () => ({ access_token: 'admin-token', expires_in: 300 }) };
    const existing = {
      id: 'kc-1',
      username: 'mod-1',
      email: 'a@mod.gov.et',
      firstName: 'Abebe',
      lastName: 'Kebede',
      enabled: true,
      attributes: { rank: ['Captain'], phone: ['+251911000000'], grandfatherName: ['Gf'], unitCode: ['LOG-CORPS'] },
    };
    const sentBody = () => JSON.parse((global.fetch as jest.Mock).mock.calls.at(-1)[1].body);
    const mockKeycloak = (putResult: any = { ok: true, status: 204 }) => {
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce(tokenResponse)
        .mockResolvedValueOnce({ ok: true, json: async () => structuredClone(existing) })
        .mockResolvedValueOnce(putResult);
    };

    it('changing only the unit keeps rank, phone, grandfather name, email and names', async () => {
      mockKeycloak();

      await service.updateUser('kc-1', { unitCode: 'ENG-CORPS' });

      expect(sentBody()).toMatchObject({
        username: 'mod-1',
        email: 'a@mod.gov.et',
        firstName: 'Abebe',
        lastName: 'Kebede',
        attributes: {
          unitCode: ['ENG-CORPS'],
          rank: ['Captain'],
          phone: ['+251911000000'],
          grandfatherName: ['Gf'],
        },
      });
    });

    it('applies a name change without touching the other attributes', async () => {
      mockKeycloak();

      await service.updateUser('kc-1', { firstName: 'Almaz', lastName: 'Newgf' });

      const body = sentBody();
      expect(body.firstName).toBe('Almaz');
      expect(body.attributes).toMatchObject({ grandfatherName: ['Newgf'], rank: ['Captain'], unitCode: ['LOG-CORPS'] });
    });

    it('removes an attribute only when it is explicitly cleared', async () => {
      mockKeycloak();

      await service.updateUser('kc-1', { phone: '' });

      const body = sentBody();
      expect(body.attributes.phone).toBeUndefined();
      expect(body.attributes.rank).toEqual(['Captain']);
    });

    it('throws when the current user cannot be read, and sends nothing', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce(tokenResponse).mockResolvedValueOnce({ ok: false, status: 404 });

      await expect(service.updateUser('kc-1', { unitCode: 'X' })).rejects.toThrow(AppBadRequestException);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('throws when Keycloak rejects the update', async () => {
      mockKeycloak({ ok: false, status: 400, text: async () => 'bad' });

      await expect(service.updateUser('kc-1', { unitCode: 'X' })).rejects.toThrow(AppBadRequestException);
    });
  });
});
