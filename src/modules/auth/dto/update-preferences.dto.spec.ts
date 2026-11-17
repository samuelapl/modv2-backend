import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdatePreferencesDto } from './update-preferences.dto';

const errorsFor = async (body: unknown) =>
  validate(plainToInstance(UpdatePreferencesDto, body as object));

describe('UpdatePreferencesDto', () => {
  it.each(['en', 'am', 'om', 'ti'])('accepts %s', async (preferredLocale) => {
    expect(await errorsFor({ preferredLocale })).toHaveLength(0);
  });

  it.each(['fr', 'AM', '', undefined])('rejects %p', async (preferredLocale) => {
    const errors = await errorsFor({ preferredLocale });
    expect(errors).toHaveLength(1);
    expect(Object.values(errors[0].constraints ?? {})[0]).toMatch(/en, am, om, ti/);
  });
});
