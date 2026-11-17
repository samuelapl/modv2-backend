import {
  REQUIRED_PROFILE_FIELDS,
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
});
