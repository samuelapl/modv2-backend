import {
  REQUIRED_PROFILE_FIELDS,
  lockedProfileFields,
  sameProfileValue,
  calculateAge,
  isProfileComplete,
  missingProfileFields,
  profileStatusFor,
} from './profile-completeness.helper';

const complete = {
  dateOfBirth: new Date('1994-01-01'),
  gender: 'MALE',
  nationalIdNumber: 'FAN-1',
  bloodGroup: 'O+',
  emergencyContactName: 'Almaz',
  emergencyContactPhone: '+251911887766',
  photoUrl: 'p.jpg',
};

describe('profile completeness', () => {
  it('a profile with every required field is complete', () => {
    expect(isProfileComplete(complete)).toBe(true);
    expect(profileStatusFor(complete)).toBe('COMPLETE');
  });

  it('an empty profile is missing every required field', () => {
    expect(missingProfileFields({})).toEqual([...REQUIRED_PROFILE_FIELDS]);
    expect(profileStatusFor({})).toBe('INCOMPLETE');
  });

  it('lists exactly the missing fields', () => {
    expect(missingProfileFields({ ...complete, photoUrl: null, bloodGroup: undefined })).toEqual([
      'bloodGroup',
      'photoUrl',
    ]);
  });

  it('treats blank strings as missing', () => {
    expect(missingProfileFields({ ...complete, nationalIdNumber: '   ' })).toEqual(['nationalIdNumber']);
  });

  it('calculates age around the birthday', () => {
    const today = new Date('2026-06-15');
    expect(calculateAge(new Date('2008-06-15'), today)).toBe(18);
    expect(calculateAge(new Date('2008-06-16'), today)).toBe(17);
  });

  describe('locked fields (entered by an administrator)', () => {
    it('locks filled fields the driver did not type themselves', () => {
      expect(lockedProfileFields({ ...complete, selfEnteredFields: ['photoUrl'] })).toEqual([
        'dateOfBirth',
        'gender',
        'nationalIdNumber',
        'bloodGroup',
        'emergencyContactName',
        'emergencyContactPhone',
      ]);
    });

    it('never locks an empty field (the driver has to fill it in)', () => {
      expect(lockedProfileFields({ bloodGroup: 'O+', selfEnteredFields: [] })).toEqual(['bloodGroup']);
      expect(lockedProfileFields({})).toEqual([]);
    });

    it('locks nothing the driver filled in entirely themselves', () => {
      expect(lockedProfileFields({ ...complete, selfEnteredFields: [...REQUIRED_PROFILE_FIELDS] })).toEqual([]);
    });
  });

  describe('sameProfileValue', () => {
    it('compares dates by day and ignores case and spaces for text', () => {
      expect(sameProfileValue('dateOfBirth', new Date('1990-01-01T00:00:00Z'), '1990-01-01')).toBe(true);
      expect(sameProfileValue('dateOfBirth', new Date('1990-01-01T00:00:00Z'), '1990-01-02')).toBe(false);
      expect(sameProfileValue('nationalIdNumber', 'FAN-1', ' fan-1 ')).toBe(true);
      expect(sameProfileValue('bloodGroup', 'O+', 'A+')).toBe(false);
    });
  });
});
