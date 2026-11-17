import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  PriorPermitLookup,
  isApplicationNumberCollision,
  resolvePriorPermit,
} from './prior-permit.helper';

function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

describe('prior-permit helper', () => {
  const adultDob = new Date('1990-01-01');
  let lookup: PriorPermitLookup;

  beforeEach(() => {
    lookup = {
      categoriesByCode: new Map([
        ['CAT-LV', { id: 'cat-lv', code: 'CAT-LV', minAgeRequired: 18 }],
        ['CAT-HV', { id: 'cat-hv', code: 'CAT-HV', minAgeRequired: 21 }],
      ]),
      takenPermitNumbers: new Set(['MOD-P-TAKEN']),
    };
  });

  const valid = () => ({
    categoryCodes: ['cat-lv', ' CAT-HV ', 'CAT-LV'],
    permitNumber: ' mod-p-1234 ',
    issueDate: isoDaysFromNow(-700),
    expiryDate: isoDaysFromNow(400),
    trainingReference: ' TRN-889 ',
  });

  it('normalizes codes and permit number and keeps the original dates', () => {
    const input = valid();
    const resolved = resolvePriorPermit(input, adultDob, lookup);

    expect(resolved.categoryIds).toEqual(['cat-lv', 'cat-hv']);
    expect(resolved.categoryCodes).toEqual(['CAT-LV', 'CAT-HV']);
    expect(resolved.permitNumber).toBe('MOD-P-1234');
    expect(resolved.trainingReference).toBe('TRN-889');
    expect(resolved.documentUrl).toBeNull();
    expect(resolved.issueDate.toISOString().slice(0, 10)).toBe(input.issueDate);
    expect(resolved.expiryDate.toISOString().slice(0, 10)).toBe(input.expiryDate);
  });

  it('rejects an already-expired permit', () => {
    expect(() =>
      resolvePriorPermit(
        { ...valid(), issueDate: isoDaysFromNow(-1500), expiryDate: isoDaysFromNow(-1) },
        adultDob,
        lookup,
      ),
    ).toThrow(/expired/i);
  });

  it('rejects expiry before issue and future issue dates', () => {
    expect(() =>
      resolvePriorPermit(
        { ...valid(), issueDate: isoDaysFromNow(-10), expiryDate: isoDaysFromNow(-20) },
        adultDob,
        lookup,
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      resolvePriorPermit({ ...valid(), issueDate: isoDaysFromNow(5) }, adultDob, lookup),
    ).toThrow(/future/);
  });

  it('rejects unknown categories, missing categories and under-age drivers', () => {
    expect(() =>
      resolvePriorPermit({ ...valid(), categoryCodes: ['CAT-XX'] }, adultDob, lookup),
    ).toThrow(/CAT-XX/);
    expect(() =>
      resolvePriorPermit({ ...valid(), categoryCodes: [] }, adultDob, lookup),
    ).toThrow(BadRequestException);

    const nineteen = new Date();
    nineteen.setFullYear(nineteen.getFullYear() - 19);
    expect(() =>
      resolvePriorPermit({ ...valid(), categoryCodes: ['CAT-HV'] }, nineteen, lookup),
    ).toThrow(/minimum required age \(21\)/);
  });

  it('rejects a permit number already on record', () => {
    expect(() =>
      resolvePriorPermit({ ...valid(), permitNumber: 'mod-p-taken' }, adultDob, lookup),
    ).toThrow(ConflictException);
  });

  it('detects application-number unique collisions only', () => {
    expect(
      isApplicationNumberCollision({ code: 'P2002', meta: { target: ['applicationNumber'] } }),
    ).toBe(true);
    expect(
      isApplicationNumberCollision({ code: 'P2002', meta: { target: ['permitNumber'] } }),
    ).toBe(false);
    expect(isApplicationNumberCollision({ code: 'P2025' })).toBe(false);
  });
});
