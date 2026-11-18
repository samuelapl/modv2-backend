import { LocalIdentityProvider } from './local-identity.provider';

describe('LocalIdentityProvider', () => {
  let provider: LocalIdentityProvider;

  beforeEach(() => {
    provider = new LocalIdentityProvider();
  });

  it('hashes and verifies passwords correctly', async () => {
    const raw = 'Password123!';
    const hash = await provider.hashPassword(raw);

    expect(hash).toBeDefined();
    expect(hash).not.toBe(raw);
    expect(await provider.verifyPassword(raw, hash)).toBe(true);
    expect(await provider.verifyPassword('WrongPass', hash)).toBe(false);
  });

  it('creates identity with hashed password', async () => {
    const result = await provider.createIdentity({
      serviceNumber: 'MOD-TEST-001',
      password: 'TempPassword123!',
      firstName: 'Abebe',
      middleName: 'Bikila',
      lastName: 'Demisse',
    });

    expect(result.passwordHash).toBeDefined();
    expect(await provider.verifyPassword('TempPassword123!', result.passwordHash!)).toBe(true);
  });

  it('resets password returning a new hash', async () => {
    const result = await provider.resetPassword('MOD-TEST-001', 'NewTempPass999!');
    expect(result.passwordHash).toBeDefined();
    expect(await provider.verifyPassword('NewTempPass999!', result.passwordHash!)).toBe(true);
  });
});
