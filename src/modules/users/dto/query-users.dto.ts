import { ApiPropertyOptional } from '@nestjs/swagger';
import { SystemRole } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, Matches } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class QueryUsersDto extends PaginationDto {
  @ApiPropertyOptional({ enum: SystemRole })
  @IsOptional()
  @IsEnum(SystemRole)
  role?: SystemRole;

  @ApiPropertyOptional({
    description: 'Filter by organizational unit UUID or UNASSIGNED',
  })
  @IsOptional()
  @Matches(
    /^(UNASSIGNED|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
    { message: 'unitId must be a valid UUID or UNASSIGNED' },
  )
  unitId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  isActive?: boolean;
}
