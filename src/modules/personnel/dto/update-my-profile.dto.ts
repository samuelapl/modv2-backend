import { ApiPropertyOptional } from '@nestjs/swagger';
import { Gender } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';
import { BLOOD_GROUPS } from './create-driver.dto';

/**
 * What a driver may edit on their own profile (contact phone and email are set by
 * the administrator at registration and are not editable here). Deliberately excludes fullName,
 * rank, serviceNumber, unit, personnel status and identity verification:
 * those stay under admin control (the global ValidationPipe rejects extras).
 */
export class UpdateMyProfileDto {
  @ApiPropertyOptional({ enum: Gender })
  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @ApiPropertyOptional({ example: '1995-03-10' })
  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @ApiPropertyOptional({ example: 'FAN-123456789012' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  nationalIdNumber?: string;

  @ApiPropertyOptional({ enum: BLOOD_GROUPS })
  @IsOptional()
  @IsIn([...BLOOD_GROUPS])
  bloodGroup?: string;

  @ApiPropertyOptional({
    example: 'ዳዊት ተስፋዬ ቦጋለ',
    description: 'Full name in Amharic, as it should be printed on the card.',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @Matches(/^[\u1200-\u137F\s.'-]+$/, {
    message: 'fullNameAm must be written in Amharic (Ethiopic) script.',
  })
  fullNameAm?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  emergencyContactName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  emergencyContactPhone?: string;
}
