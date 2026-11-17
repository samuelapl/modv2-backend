import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class QueryMedicalCandidatesDto extends PaginationDto {
  @ApiPropertyOptional({ example: 'CAT-HV' })
  @IsOptional()
  @IsString()
  categoryCode?: string;

  @ApiPropertyOptional({ description: 'Training batch the candidate came from' })
  @IsOptional()
  @IsUUID()
  batchId?: string;

  @ApiPropertyOptional({
    enum: ['FIRST', 'REEVALUATION'],
    description: 'FIRST = never assessed; REEVALUATION = previously deferred',
  })
  @IsOptional()
  @IsIn(['FIRST', 'REEVALUATION'])
  reviewState?: 'FIRST' | 'REEVALUATION';
}
