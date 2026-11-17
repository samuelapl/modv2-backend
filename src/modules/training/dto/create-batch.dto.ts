import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

export class CreateBatchSessionDto {
  @ApiProperty({ description: 'Training course for this category session.' })
  @IsUUID()
  courseId: string;

  @ApiPropertyOptional({
    example: 'CAT-HV',
    description:
      'Category this session trains. Required when the course covers more than one category.',
  })
  @IsOptional()
  @IsString()
  categoryCode?: string;

  @ApiProperty({ description: 'User ID of the practical trainer (INSTRUCTOR role).' })
  @IsUUID()
  instructorUserId: string;

  @ApiProperty({ example: '2026-12-01' })
  @IsDateString()
  startDate: string;

  @ApiPropertyOptional({
    example: '2026-12-31',
    description: 'Defaults to startDate + course.durationDays.',
  })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiProperty({
    type: [String],
    description: 'TRAINING_PENDING applications to enroll in this category session.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  applicationIds: string[];
}

export class CreateBatchDto {
  @ApiPropertyOptional({ example: 'December intake — Logistics Training Wing' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({ type: [CreateBatchSessionDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateBatchSessionDto)
  sessions: CreateBatchSessionDto[];
}
