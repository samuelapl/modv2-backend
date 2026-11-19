import {
  getMissingCardFields,
  missingCardFieldsLabel,
} from './issuance-readiness.helper';

const complete = {
  serviceNumber: 'MOD-1',
  rank: 'Sgt.',
  bloodGroup: 'O+',
  dateOfBirth: new Date('1990-01-01'),
  fullNameAm: 'ክብረት መንግስቱ',
};

describe('getMissingCardFields', () => {
  it('returns [] when every statutory field is present', () => {
    expect(getMissingCardFields(complete)).toEqual([]);
  });

  it.each(Object.keys(complete))('reports %s when it is missing', (field) => {
    expect(getMissingCardFields({ ...complete, [field]: null })).toEqual([field]);
  });

  it('treats blank / whitespace strings as missing', () => {
    expect(getMissingCardFields({ ...complete, rank: '', fullNameAm: '   ' })).toEqual([
      'rank',
      'fullNameAm',
    ]);
  });

  it('reports everything for an empty profile, with readable labels', () => {
    const missing = getMissingCardFields({});
    expect(missing).toHaveLength(5);
    expect(missingCardFieldsLabel(['bloodGroup', 'fullNameAm'])).toBe(
      'Blood Group, Amharic Full Name',
    );
  });
});
