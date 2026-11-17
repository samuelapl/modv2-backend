import { CredentialStatus } from '@prisma/client';
import {
  categoriesForMedical,
  evaluateAdditionalCategory,
  resolveAdditionalCategoryPermit,
} from './additional-category.helper';

const permit = (overrides: any = {}) => ({
  id: 'cred-1',
  credentialNumber: 'MOD-AUTH-2026-0002',
  status: CredentialStatus.ACTIVE,
  issueDate: new Date('2026-11-13T00:00:00.000Z'),
  expiryDate: new Date('2028-11-13T00:00:00.000Z'),
  categories: [{ category: { id: 'cat-sp', code: 'CAT-SP', name: 'Special Purpose' } }],
  ...overrides,
});
const now = new Date('2026-12-01T00:00:00.000Z');
const clientWith = (p: any): any => ({
  issuedCredential: { findFirst: jest.fn().mockResolvedValue(p) },
});

describe('evaluateAdditionalCategory', () => {
  it('allows upgrading an active, unexpired permit', () => {
    expect(evaluateAdditionalCategory(permit() as any, now).eligible).toBe(true);
  });

  it.each([
    ['no permit', null, /New Authorization/],
    ['suspended', { status: CredentialStatus.SUSPENDED }, /Lift the suspension/],
    ['revoked', { status: CredentialStatus.REVOKED }, /revoked/],
    ['expired', { expiryDate: new Date('2026-11-30T00:00:00.000Z') }, /Renew it before/],
  ])('rejects when %s', (_l, overrides, message) => {
    const v = evaluateAdditionalCategory(
      overrides === null ? null : (permit(overrides) as any),
      now,
    );
    expect(v.eligible).toBe(false);
    expect(v.message).toMatch(message);
  });
});

describe('resolveAdditionalCategoryPermit', () => {
  it('accepts categories the permit does not hold', async () => {
    const res = await resolveAdditionalCategoryPermit(
      clientWith(permit()),
      'drv',
      ['cat-hv'],
      now,
    );
    expect(res.permit.id).toBe('cred-1');
  });

  it('rejects categories already on the permit', async () => {
    await expect(
      resolveAdditionalCategoryPermit(clientWith(permit()), 'drv', ['cat-hv', 'cat-sp'], now),
    ).rejects.toThrow(/CAT-SP is already on permit MOD-AUTH-2026-0002/);
  });

  it('rejects when there is no permit to upgrade', async () => {
    await expect(
      resolveAdditionalCategoryPermit(clientWith(null), 'drv', ['cat-hv'], now),
    ).rejects.toThrow(/no MoD permit/);
  });
});

describe('categoriesForMedical', () => {
  it('needs a medical when only a held category requires one', () => {
    const requested = [{ code: 'CAT-X', requiresMedical: false }];
    const held = [{ code: 'CAT-SP', requiresMedical: true }];
    expect(categoriesForMedical(requested).some((c) => c.requiresMedical)).toBe(false);
    expect(categoriesForMedical(requested, held).some((c) => c.requiresMedical)).toBe(true);
  });
});
