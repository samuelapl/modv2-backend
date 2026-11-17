import { ApiPropertyOptional } from '@nestjs/swagger';
import { SystemRole } from '@prisma/client';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { Permission } from '../../../common/enums/permissions.enum';

export class UpdateUserDto {
  @ApiPropertyOptional({ example: 'Maj. Dawit Bekele' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  fullName?: string;

  @ApiPropertyOptional({ example: 'Major' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  rank?: string;

  @ApiPropertyOptional({ example: '+251911223344' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((o) => o.email !== '' && o.email !== null)
  @IsEmail()
  email?: string | null;

  @ApiPropertyOptional({ enum: SystemRole, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(SystemRole, { each: true })
  roles?: SystemRole[];

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((o) => o.unitId !== '' && o.unitId !== null)
  @IsUUID()
  unitId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ enum: Permission, isArray: true })
  @IsOptional()
  @IsArray()
  @IsEnum(Permission, { each: true })
  customPermissions?: Permission[];
}
