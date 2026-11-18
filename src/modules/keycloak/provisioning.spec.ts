import { ensureDriverProfile, getDefaultRoles, getSyncScope, isServiceAccount, resolveUnitId } from './provisioning';

describe('provisioning', () => {
  const original = process.env.DEFAULT_ROLE;
  afterEach(() => {
    if (original === undefined) delete process.env.DEFAULT_ROLE;
    else process.env.DEFAULT_ROLE = original;
  });

  describe('getDefaultRoles', () => {
    it('defaults to STAFF_DRIVER when DEFAULT_ROLE is unset', () => {
      delete process.env.DEFAULT_ROLE;
      expect(getDefaultRoles()).toEqual(['STAFF_DRIVER']);
    });

    it('reads a comma-separated list, case-insensitively', () => {
      process.env.DEFAULT_ROLE = 'auditor, staff_driver';
      expect(getDefaultRoles()).toEqual(['AUDITOR', 'STAFF_DRIVER']);
    });

    it('returns no roles when DEFAULT_ROLE is empty', () => {
      process.env.DEFAULT_ROLE = '';
      expect(getDefaultRoles()).toEqual([]);
    });

    it('ignores unknown role names', () => {
      process.env.DEFAULT_ROLE = 'NOT_A_ROLE,EXAMINER';
      expect(getDefaultRoles()).toEqual(['EXAMINER']);
    });
  });

  describe('resolveUnitId', () => {
    const prisma = (id: string | null) => ({
      organizationalUnit: { findUnique: jest.fn().mockResolvedValue(id ? { id } : null) },
    });

    it('returns the unit id for a known code', async () => {
      const p = prisma('unit-1');
      await expect(resolveUnitId(p, ' ENG-CORPS ')).resolves.toBe('unit-1');
      expect(p.organizationalUnit.findUnique).toHaveBeenCalledWith({ where: { code: 'ENG-CORPS' }, select: { id: true } });
    });

    it('returns null for an unknown code and skips the lookup for an empty one', async () => {
      await expect(resolveUnitId(prisma(null), 'NOPE')).resolves.toBeNull();
      const p = prisma('x');
      await expect(resolveUnitId(p, undefined)).resolves.toBeNull();
      expect(p.organizationalUnit.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('ensureDriverProfile', () => {
    const user = (over: Record<string, unknown> = {}) => ({
      id: 'u1', serviceNumber: 'MOD-1', roles: ['STAFF_DRIVER'], unitId: 'unit-1',
      fullName: 'A B C', firstName: 'A', middleName: 'B', lastName: 'C', rank: null, phone: null, ...over,
    });
    const writer = () => ({ driverProfile: { upsert: jest.fn().mockResolvedValue({ profileStatus: 'INCOMPLETE' }) } });

    it('creates an INCOMPLETE profile (default status) for a driver with a unit', async () => {
      const p = writer();
      await expect(ensureDriverProfile(p, user())).resolves.toEqual({ profileStatus: 'INCOMPLETE' });
      expect(p.driverProfile.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'u1' }, update: {}, create: expect.objectContaining({ unitId: 'unit-1', fullName: 'A B C' }) }),
      );
    });

    it('starts the profile with the identity check approved', async () => {
      const p = writer();
      await ensureDriverProfile(p, user());
      expect(p.driverProfile.upsert.mock.calls[0][0].create).toEqual(
        expect.objectContaining({ identityVerifiedAt: expect.any(Date), identityVerifiedBy: 'SYSTEM' }),
      );
      // Re-running must not re-stamp an existing profile.
      expect(p.driverProfile.upsert.mock.calls[0][0].update).toEqual({});
    });

    it('does nothing for a user without the STAFF_DRIVER role', async () => {
      const p = writer();
      await expect(ensureDriverProfile(p, user({ roles: ['AUDITOR'] }))).resolves.toBeNull();
      expect(p.driverProfile.upsert).not.toHaveBeenCalled();
    });

    it('skips a driver with no unit, because a profile requires one', async () => {
      const p = writer();
      await expect(ensureDriverProfile(p, user({ unitId: null }))).resolves.toBeNull();
      expect(p.driverProfile.upsert).not.toHaveBeenCalled();
    });
  });

  describe('getSyncScope', () => {
    const original = process.env.KEYCLOAK_SYNC_SCOPE;
    afterEach(() => {
      if (original === undefined) delete process.env.KEYCLOAK_SYNC_SCOPE;
      else process.env.KEYCLOAK_SYNC_SCOPE = original;
    });

    it('defaults to the whole realm', () => {
      delete process.env.KEYCLOAK_SYNC_SCOPE;
      expect(getSyncScope()).toBe('realm');
    });

    it('uses the group only when asked, case-insensitively', () => {
      process.env.KEYCLOAK_SYNC_SCOPE = ' Group ';
      expect(getSyncScope()).toBe('group');
    });

    it('treats anything unrecognised as the realm', () => {
      process.env.KEYCLOAK_SYNC_SCOPE = 'nonsense';
      expect(getSyncScope()).toBe('realm');
    });
  });

  describe('isServiceAccount', () => {
    it('recognises a client service account by its marker or its name', () => {
      expect(isServiceAccount({ username: 'x', serviceAccountClientId: 'idlms-backend' })).toBe(true);
      expect(isServiceAccount({ username: 'service-account-other' })).toBe(true);
    });

    it('does not flag people', () => {
      expect(isServiceAccount({ username: 'mod-1309001' })).toBe(false);
    });
  });
});
