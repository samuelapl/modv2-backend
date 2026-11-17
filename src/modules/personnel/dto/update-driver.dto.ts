import { ApiPropertyOptional } from '@nestjs/swagger';
import { Gender, PersonnelStatus } from '@prisma/client';
import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateIf,
} from 'class-validator';
import { IsPersonName } from '../../../common/utils/person-name.util';
import { BLOOD_GROUPS } from './create-driver.dto';

export class UpdateDriverDto {
  @ApiPropertyOptional({ description: 'Given name. Send all three name parts together.' })
  @IsOptional()
  @IsPersonName()
  firstName?: string;

  @ApiPropertyOptional({ description: "Father's name." })
  @IsOptional()
  @IsPersonName()
  middleName?: string;

  @ApiPropertyOptional({ description: "Grandfather's name." })
  @IsOptional()
  @IsPersonName()
  lastName?: string;

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

  @ApiPropertyOptional({ example: '1995-03-10' })
  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

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
