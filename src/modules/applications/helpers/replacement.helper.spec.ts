import { CredentialStatus } from '@prisma/client';
import {
  evaluateReplacement,
  resolveReplacementPermit,
} from './replacement.helper';

const permit = (overrides: any = {}) => ({
  id: 'cred-1',
  credentialNumber: 'MOD-AUTH-2026-0001',
  status: CredentialStatus.ACTIVE,
  issueDate: new Date('2025-01-01T00:00:00.000Z'),
  expiryDate: new Date('2027-01-01T00:00:00.000Z'),
  categories: [
    { category: { id: 'cat-sp', code: 'CAT-SP', name: 'Special Purpose' } },
    { category: { id: 'cat-lv', code: 'CAT-LV', name: 'Light Vehicle' } },
  ],
  ...overrides,
});
const now = new Date('2026-11-13T00:00:00.000Z');

describe('evaluateReplacement', () => {
  it('allows an active, unexpired permit', () => {
    const v = evaluateReplacement(permit() as any, now);
    expect(v.eligible).toBe(true);
    expect(v.message).toMatch(/valid until 2027-01-01/);
  });

  it.each([
    ['no permit', null, /no MoD permit to replace/],
    ['suspended', { status: CredentialStatus.SUSPENDED }, /Lift the suspension/],
    ['revoked', { status: CredentialStatus.REVOKED }, /revoked/],
    ['expired status', { status: CredentialStatus.EXPIRED }, /Use Renewal/],
    ['past expiry date', { expiryDate: new Date('2026-11-01T00:00:00.000Z') }, /Use Renewal/],
  ])('rejects when %s', (_label, overrides, message) => {
    const v = evaluateReplacement(
      overrides === null ? null : (permit(overrides) as any),
      now,
    );
    expect(v.eligible).toBe(false);
    expect(v.message).toMatch(message);
  });
});

describe('resolveReplacementPermit', () => {
  it("returns the permit's own categories", async () => {
    const client: any = {
      issuedCredential: { findFirst: jest.fn().mockResolvedValue(permit()) },
    };
    const res = await resolveReplacementPermit(client, 'drv', now);
    expect(res.categoryIds).toEqual(['cat-sp', 'cat-lv']);
    expect(res.permit.id).toBe('cred-1');
  });

  it('throws when nothing can be replaced', async () => {
    const client: any = {
      issuedCredential: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    await expect(resolveReplacementPermit(client, 'drv', now)).rejects.toThrow(
      /no MoD permit to replace/,
    );
  });
});
