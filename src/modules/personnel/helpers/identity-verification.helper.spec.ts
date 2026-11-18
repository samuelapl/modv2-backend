import { AUTO_IDENTITY_VERIFIER, autoVerifiedIdentity } from './identity-verification.helper';

describe('autoVerifiedIdentity', () => {
  it('stamps the check as approved by the system, now', () => {
    const before = Date.now();
    const stamp = autoVerifiedIdentity();
    expect(stamp.identityVerifiedBy).toBe(AUTO_IDENTITY_VERIFIER);
    expect(stamp.identityVerifiedAt.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('uses the given time', () => {
    const at = new Date('2026-01-01T00:00:00Z');
    expect(autoVerifiedIdentity(at).identityVerifiedAt).toBe(at);
  });
});
