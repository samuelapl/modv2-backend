import { ApiPropertyOptional } from '@nestjs/swagger';
import { Gender, PersonnelStatus } from '@prisma/client';
import {
  IsEmail,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateIf,
} from 'class-validator';
import { BLOOD_GROUPS } from './create-driver.dto';

export class UpdateDriverDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  fullName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  rank?: string;

  @ApiPropertyOptional({ enum: Gender })
  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  nationalIdNumber?: string;

  @ApiPropertyOptional({ enum: BLOOD_GROUPS })
  @IsOptional()
  @IsIn([...BLOOD_GROUPS])
  bloodGroup?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  photoUrl?: string;

  @ApiPropertyOptional({ example: 'driver@mod.gov.et' })
  @IsOptional()
  @ValidateIf((o) => o.email !== '' && o.email !== null && o.email !== undefined)
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  contactPhone?: string;

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

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  unitId?: string;

  @ApiPropertyOptional({ enum: PersonnelStatus })
  @IsOptional()
  @IsEnum(PersonnelStatus)
  personnelStatus?: PersonnelStatus;
}
