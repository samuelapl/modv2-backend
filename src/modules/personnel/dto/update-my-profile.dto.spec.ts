import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateMyProfileDto } from './update-my-profile.dto';

const errorsFor = async (body: Record<string, unknown>) =>
  validate(plainToInstance(UpdateMyProfileDto, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

describe('UpdateMyProfileDto.fullNameAm', () => {
  it('accepts a full name written in Amharic', async () => {
    expect(await errorsFor({ fullNameAm: 'ዳዊት ተስፋዬ ቦጋለ' })).toHaveLength(0);
  });

  it('is optional', async () => {
    expect(await errorsFor({})).toHaveLength(0);
  });

  it.each([
    ['Latin letters', 'Dawit Tesfaye Bogale'],
    ['mixed scripts', 'ዳዊት Tesfaye'],
    ['digits', 'ዳዊት 123'],
    ['blank', ''],
  ])('rejects %s', async (_label, value) => {
    const errors = await errorsFor({ fullNameAm: value });
    expect(errors.map((e) => e.property)).toContain('fullNameAm');
  });

  it('still refuses fields a driver may not edit (rank, full name)', async () => {
    const errors = await errorsFor({ rank: 'General', fullName: 'X Y Z' });
    expect(errors.length).toBeGreaterThan(0);
  });
});
