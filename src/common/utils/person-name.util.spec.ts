import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateDriverDto } from '../../modules/personnel/dto/create-driver.dto';
import { NAME_PATTERN, composeFullName } from './person-name.util';

describe('person names', () => {
  describe('NAME_PATTERN', () => {
    it.each(['Abebe', 'Bikila Demissie', "Ge'ez", 'Wolde-Giorgis', 'አበበ', 'ቢቂላ'])('accepts %s', (n) => {
      expect(NAME_PATTERN.test(n)).toBe(true);
    });

    it.each(['Sgt. Abebe', 'Abebe.', 'Abebe2', '', ' Abebe', '-Abebe', 'Dr. Hana'])('rejects %j', (n) => {
      expect(NAME_PATTERN.test(n)).toBe(false);
    });
  });

  it('composes the full name from the three parts', () => {
    expect(composeFullName('Abebe', 'Bikila', 'Demissie')).toBe('Abebe Bikila Demissie');
    expect(composeFullName(' Abebe ', 'Bikila  ', ' Demissie')).toBe('Abebe Bikila Demissie');
    expect(composeFullName('Abebe', null, 'Demissie')).toBe('Abebe Demissie');
  });
});

describe('CreateDriverDto name rules', () => {
  const base = {
    serviceNumber: 'MOD-1',
    firstName: 'Abebe',
    middleName: 'Bikila',
    lastName: 'Demissie',
    email: 'a@mod.gov.et',
    contactPhone: '+251911000000',
    unitId: '9f8beb56-c285-4e0b-908d-95b67440884d',
  };
  const check = async (over: Record<string, unknown>) =>
    (await validate(plainToInstance(CreateDriverDto, { ...base, ...over }))).map((e) => e.property);

  it('accepts a clean three-part name', async () => {
    expect(await check({})).toEqual([]);
  });

  it('rejects a title in any part', async () => {
    expect(await check({ firstName: 'Sgt. Abebe' })).toEqual(['firstName']);
    expect(await check({ middleName: 'Dr. Bikila' })).toEqual(['middleName']);
  });

  it('rejects missing or too-short parts', async () => {
    expect(await check({ lastName: undefined })).toEqual(['lastName']);
    expect(await check({ middleName: 'B' })).toEqual(['middleName']);
  });
});
