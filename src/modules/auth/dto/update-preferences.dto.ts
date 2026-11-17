import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

/** Interface languages the frontend ships (keep in sync with frontend LOCALES). */
export const SUPPORTED_LOCALES = ['en', 'am', 'om', 'ti'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export class UpdatePreferencesDto {
  @ApiProperty({ enum: SUPPORTED_LOCALES, example: 'am' })
  @IsIn(SUPPORTED_LOCALES as unknown as string[], {
    message: `preferredLocale must be one of: ${SUPPORTED_LOCALES.join(', ')}`,
  })
  preferredLocale: SupportedLocale;
}
