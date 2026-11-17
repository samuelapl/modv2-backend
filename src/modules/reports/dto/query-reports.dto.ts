import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class QueryReportsDto {
  @ApiPropertyOptional({ description: 'Optional unit UUID filter' })
  @IsOptional()
  @IsUUID()
  unitId?: string;

  @ApiPropertyOptional({
    description: 'Lookahead window in days for expiring permits (default 60)',
    default: 60,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  expiringDays?: number;
}
