import { ApiPropertyOptional } from '@nestjs/swagger';
import { ExamOutcome, ExamType } from '@prisma/client';
import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class QueryExaminationsDto extends PaginationDto {
  @ApiPropertyOptional({ enum: ExamType })
  @IsOptional()
  @IsEnum(ExamType)
  examType?: ExamType;

  @ApiPropertyOptional({ enum: ExamOutcome })
  @IsOptional()
  @IsEnum(ExamOutcome)
  outcome?: ExamOutcome;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  categoryCode?: string;

  @ApiPropertyOptional({ description: 'Training batch the candidate came from' })
  @IsOptional()
  @IsUUID()
  batchId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  applicationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  driverProfileId?: string;
}
