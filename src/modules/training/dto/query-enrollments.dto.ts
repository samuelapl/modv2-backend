import { ApiPropertyOptional } from '@nestjs/swagger';
import { CourseStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class QueryEnrollmentsDto extends PaginationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  courseId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  applicationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  driverProfileId?: string;

  @ApiPropertyOptional({ description: 'Filter by training batch' })
  @IsOptional()
  @IsUUID()
  batchId?: string;

  @ApiPropertyOptional({ example: 'CAT-HV' })
  @IsOptional()
  @IsString()
  categoryCode?: string;

  @ApiPropertyOptional({ enum: CourseStatus })
  @IsOptional()
  @IsEnum(CourseStatus)
  status?: CourseStatus;

  @ApiPropertyOptional({
    description:
      'Only Planned / In Progress enrollments whose batch session has already ended.',
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  overdue?: boolean;
}
