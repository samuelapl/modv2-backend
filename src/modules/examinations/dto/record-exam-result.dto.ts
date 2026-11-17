import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ExamOutcome, ExamType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class RecordExamResultDto {
  @ApiProperty()
  @IsUUID()
  driverProfileId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  applicationId?: string;

  @ApiProperty({ enum: ExamType, example: ExamType.THEORETICAL })
  @IsEnum(ExamType)
  examType: ExamType;

  @ApiProperty({ example: 'CAT-SP' })
  @IsString()
  @IsNotEmpty()
  categoryCode: string;

  @ApiPropertyOptional({ example: 85, minimum: 0, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  scorePercent?: number;

  @ApiProperty({ enum: ExamOutcome, example: ExamOutcome.PASS })
  @IsEnum(ExamOutcome)
  outcome: ExamOutcome;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  examDate?: string;

  @ApiPropertyOptional({ example: '17312345-exam-sheet.pdf' })
  @IsOptional()
  @IsString()
  evidenceUrl?: string;

  @ApiPropertyOptional({ example: 'Passed road maneuver and convoy signal assessment.' })
  @IsOptional()
  @IsString()
  notes?: string;
}
