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
import { IsPersonName } from '../../../common/utils/person-name.util';
import { Permission } from '../../../common/enums/permissions.enum';

export class UpdateUserDto {
  @ApiPropertyOptional({ example: 'Dawit', description: 'Given name. Send all three name parts together.' })
  @IsOptional()
  @IsPersonName()
  firstName?: string;

  @ApiPropertyOptional({ example: 'Bekele', description: "Father's name." })
  @IsOptional()
  @IsPersonName()
  middleName?: string;

  @ApiPropertyOptional({ example: 'Alemu', description: "Grandfather's name." })
  @IsOptional()
  @IsPersonName()
  lastName?: string;

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
