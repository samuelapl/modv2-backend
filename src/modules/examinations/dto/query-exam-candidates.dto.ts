import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class QueryExamCandidatesDto extends PaginationDto {
  @ApiPropertyOptional({ example: 'CAT-HV' })
  @IsOptional()
  @IsString()
  categoryCode?: string;

  @ApiPropertyOptional({ description: 'Training batch the candidate came from' })
  @IsOptional()
  @IsUUID()
  batchId?: string;
}
