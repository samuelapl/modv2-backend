import { ApiPropertyOptional } from '@nestjs/swagger';
import { PersonnelStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class QueryDriversDto extends PaginationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  unitId?: string;

  @ApiPropertyOptional({ enum: PersonnelStatus })
  @IsOptional()
  @IsEnum(PersonnelStatus)
  personnelStatus?: PersonnelStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  verifiedOnly?: boolean;

  @ApiPropertyOptional({
    example: 'CAT-HV',
    description: 'Driving authorization class (vehicle category code)',
  })
  @IsOptional()
  @IsString()
  categoryCode?: string;

  @ApiPropertyOptional({
    enum: ['AUTHORIZED', 'SUSPENDED', 'IN_PROGRESS', 'NONE'],
    description:
      'AUTHORIZED = valid active permit; SUSPENDED = permit currently suspended; IN_PROGRESS = open application; NONE = no active or suspended permit. Scoped to categoryCode when given.',
  })
  @IsOptional()
  @IsIn(['AUTHORIZED', 'SUSPENDED', 'IN_PROGRESS', 'NONE'])
  authorization?: 'AUTHORIZED' | 'SUSPENDED' | 'IN_PROGRESS' | 'NONE';
}
