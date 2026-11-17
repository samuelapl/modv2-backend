import { ApiPropertyOptional } from '@nestjs/swagger';
import { Gender } from '@prisma/client';
import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { BLOOD_GROUPS } from './create-driver.dto';

/**
 * What a driver may edit on their own profile. Deliberately excludes fullName,
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

  @ApiPropertyOptional({ description: 'Object storage key of the uploaded photo' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  photoUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  contactPhone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

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
