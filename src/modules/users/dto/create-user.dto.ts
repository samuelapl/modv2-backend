import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SystemRole } from '@prisma/client';
import {
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MinLength,
  ValidateIf,
} from 'class-validator';
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_PATTERN,
  PASSWORD_POLICY_MESSAGE,
} from '../../../common/utils/password.util';
import { Permission } from '../../../common/enums/permissions.enum';

export class CreateUserDto {
  @ApiProperty({ example: 'MOD-NEW-101' })
  @IsString()
  @IsNotEmpty()
  serviceNumber: string;

  @ApiProperty({ example: 'Maj. Dawit Bekele' })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  fullName: string;

  @ApiProperty({ example: 'Major' })
  @IsString()
  @IsNotEmpty()
  rank: string;

  @ApiProperty({ example: '+251911223344' })
  @IsString()
  @IsNotEmpty()
  phone: string;

  @ApiPropertyOptional({ example: 'officer@mod.gov.et' })
  @IsOptional()
  @ValidateIf((o) => o.email !== '' && o.email !== null)
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({
    example: 'SecurePass@2026',
    minLength: 8,
    description:
      'Temporary password. Omit to have the server generate one (returned once as temporaryPassword). The user must change it on first login.',
  })
  @IsOptional()
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @Matches(PASSWORD_PATTERN, { message: PASSWORD_POLICY_MESSAGE })
  password?: string;

  @ApiProperty({ enum: SystemRole, isArray: true, example: [SystemRole.UNIT_COORDINATOR] })
  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(SystemRole, { each: true })
  roles: SystemRole[];

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((o) => o.unitId !== '' && o.unitId !== null)
  @IsUUID()
  unitId?: string;

  @ApiPropertyOptional({ enum: Permission, isArray: true })
  @IsOptional()
  @IsArray()
  @IsEnum(Permission, { each: true })
  customPermissions?: Permission[];
}
