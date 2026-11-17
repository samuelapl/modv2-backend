import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Gender, PersonnelStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_PATTERN,
  PASSWORD_POLICY_MESSAGE,
} from '../../../common/utils/password.util';
import { PriorPermitDto } from '../../applications/dto/prior-permit.dto';

export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;

export class CreateDriverDto {
  @ApiProperty({ example: 'MOD-77001' })
  @IsString()
  @IsNotEmpty()
  serviceNumber: string;

  @ApiProperty({ example: 'Sgt. Abebe Bikila' })
  @IsString()
  @IsNotEmpty()
  fullName: string;

  @ApiPropertyOptional({ example: 'Sergeant' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  rank?: string;

  @ApiPropertyOptional({ enum: Gender, example: Gender.MALE })
  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @ApiPropertyOptional({ example: 'FAN-123456789012' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  nationalIdNumber?: string;

  @ApiPropertyOptional({
    example: '1995-03-10',
    description:
      'Normally entered by the driver when completing their profile. Required here only when recording an existing permit (priorPermit).',
  })
  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @ApiPropertyOptional({ enum: BLOOD_GROUPS, example: 'O+' })
  @IsOptional()
  @IsIn([...BLOOD_GROUPS])
  bloodGroup?: string;

  @ApiPropertyOptional({ example: '17312345-uuid.jpg' })
  @IsOptional()
  @IsString()
  photoUrl?: string;

  @ApiProperty({ example: 'driver@mod.gov.et' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: '+251911223344' })
  @IsString()
  @IsNotEmpty()
  contactPhone: string;

  @ApiPropertyOptional({ example: 'Almaz Bikila' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  emergencyContactName?: string;

  @ApiPropertyOptional({ example: '+251911887766' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  emergencyContactPhone?: string;

  @ApiProperty()
  @IsUUID()
  unitId: string;

  @ApiPropertyOptional({ enum: PersonnelStatus, default: PersonnelStatus.ACTIVE })
  @IsOptional()
  @IsEnum(PersonnelStatus)
  personnelStatus?: PersonnelStatus;

  @ApiPropertyOptional({
    minLength: 8,
    description:
      'Temporary password. Omit to have the server generate one (returned once as temporaryPassword). The driver must change it on first login.',
  })
  @IsOptional()
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @Matches(PASSWORD_PATTERN, { message: PASSWORD_POLICY_MESSAGE })
  initialPassword?: string;

  @ApiPropertyOptional({
    type: PriorPermitDto,
    description:
      'Set for an already-trained driver: creates a PRE_TRAINED application that goes straight to command approval.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => PriorPermitDto)
  priorPermit?: PriorPermitDto;
}
