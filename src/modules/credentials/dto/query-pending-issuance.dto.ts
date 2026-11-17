import { ApiPropertyOptional } from '@nestjs/swagger';
import { ApplicationType } from '@prisma/client';
import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class QueryPendingIssuanceDto extends PaginationDto {
  @ApiPropertyOptional({ example: 'CAT-HV' })
  @IsOptional()
  @IsString()
  categoryCode?: string;

  @ApiPropertyOptional({ enum: ApplicationType })
  @IsOptional()
  @IsEnum(ApplicationType)
  type?: ApplicationType;

  @ApiPropertyOptional({ description: 'Training batch the candidate came from' })
  @IsOptional()
  @IsUUID()
  batchId?: string;
}
