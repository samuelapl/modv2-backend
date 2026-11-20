import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class QueryWaitingDto extends PaginationDto {
  @ApiPropertyOptional({ example: 'CAT-HV', description: 'Only people waiting for this category' })
  @IsOptional()
  @IsString()
  categoryCode?: string;
}
