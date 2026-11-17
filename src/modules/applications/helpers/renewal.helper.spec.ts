import { BadRequestException } from '@nestjs/common';
import { CredentialStatus } from '@prisma/client';
import {
  assertRenewalAllowed,
  evaluateRenewal,
  renewalWindow,
} from './renewal.helper';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const permit = (overrides: any = {}) => ({
  id: 'cred-1',
  credentialNumber: 'MOD-AUTH-2026-0001',
  status: CredentialStatus.ACTIVE,
  issueDate: d('2023-06-15'),
  expiryDate: d('2026-06-15'),
  categories: [
    { category: { id: 'cat-sp', code: 'CAT-SP', name: 'Special Purpose' } },
    { category: { id: 'cat-lv', code: 'CAT-LV', name: 'Light Vehicle' } },
  ],
  ...overrides,
});

describe('renewal window', () => {
  it('opens 5 months before expiry and closes 5 months after', () => {
    const { opensAt, closesAt } = renewalWindow(d('2026-06-15'));
    expect(opensAt.toISOString().slice(0, 10)).toBe('2026-01-15');
    expect(closesAt.toISOString().slice(0, 10)).toBe('2026-11-15');
  });

  it('clamps month-end dates', () => {
    const { opensAt } = renewalWindow(d('2026-07-31'));
    expect(opensAt.toISOString().slice(0, 10)).toBe('2026-02-28');
  });

  it.each([
    ['2026-01-14', 'NOT_YET'],
    ['2026-01-15', 'OPEN'],
    ['2026-06-15', 'OPEN'],
    ['2026-09-01', 'OPEN'], // expired but within grace
    ['2026-11-15', 'OPEN'],
    ['2026-11-16', 'CLOSED'],
  ])('on %s the window is %s', (today, state) => {
    expect(evaluateRenewal(permit() as any, d(today)).state).toBe(state);
  });

  it('treats an EXPIRED-status permit inside the grace period as renewable', () => {
    const v = evaluateRenewal(
      permit({ status: CredentialStatus.EXPIRED }) as any,
      d('2026-08-01'),
    );
    expect(v.state).toBe('OPEN');
    expect(v.message).toMatch(/expired on 2026-06-15/);
  });

  it('blocks missing, suspended and revoked permits', () => {
    expect(evaluateRenewal(null).state).toBe('NO_PERMIT');
    expect(
      evaluateRenewal(permit({ status: CredentialStatus.SUSPENDED }) as any).state,
    ).toBe('BLOCKED');
    expect(
      evaluateRenewal(permit({ status: CredentialStatus.REVOKED }) as any).state,
    ).toBe('BLOCKED');
  });
});

describe('assertRenewalAllowed', () => {
  const client: any = {
    issuedCredential: { findFirst: jest.fn() },
    vehicleCategory: { findMany: jest.fn() },
  };
  beforeEach(() => jest.clearAllMocks());

  it('requires an existing permit', async () => {
    client.issuedCredential.findFirst.mockResolvedValue(null);
    await expect(
      assertRenewalAllowed(client, {
        driverProfileId: 'drv',
        categoryIds: ['cat-sp'],
        checkWindow: false,
      }),
    ).rejects.toThrow(/no MoD permit to renew/);
  });

  it('rejects categories that are not on the permit', async () => {
    client.issuedCredential.findFirst.mockResolvedValue(permit());
    client.vehicleCategory.findMany.mockResolvedValue([{ code: 'CAT-HV' }]);
    await expect(
      assertRenewalAllowed(client, {
        driverProfileId: 'drv',
        categoryIds: ['cat-sp', 'cat-hv'],
        checkWindow: true,
        now: d('2026-05-01'),
      }),
    ).rejects.toThrow(/Not on the permit: CAT-HV/);
  });

  it('allows a draft before the window but not a submission', async () => {
    client.issuedCredential.findFirst.mockResolvedValue(permit());
    const early = d('2025-12-01');
    await expect(
      assertRenewalAllowed(client, {
        driverProfileId: 'drv',
        categoryIds: ['cat-sp'],
        checkWindow: false,
        now: early,
      }),
    ).resolves.toBeDefined();
    await expect(
      assertRenewalAllowed(client, {
        driverProfileId: 'drv',
        categoryIds: ['cat-sp'],
        checkWindow: true,
        now: early,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('accepts a subset of permit categories inside the window', async () => {
    client.issuedCredential.findFirst.mockResolvedValue(permit());
    const res = await assertRenewalAllowed(client, {
      driverProfileId: 'drv',
      categoryIds: ['cat-lv'],
      checkWindow: true,
      now: d('2026-07-01'),
    });
    expect(res.verdict.state).toBe('OPEN');
  });
});
