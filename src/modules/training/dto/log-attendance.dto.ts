import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CourseStatus } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class LogAttendanceDto {
  /** Optional: the day-by-day attendance now decides completion. */
  @ApiPropertyOptional({ example: 40, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  hoursAttended?: number;

  @ApiProperty({ enum: CourseStatus, example: CourseStatus.COMPLETED })
  @IsEnum(CourseStatus)
  status: CourseStatus;

  @ApiPropertyOptional({ example: '2026-11-10T10:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  completionDate?: string;

  @ApiPropertyOptional({ example: '17312345-cert.pdf' })
  @IsOptional()
  @IsString()
  certificateUrl?: string;

  @ApiPropertyOptional({ example: 'Completed all 40 yard and convoy hours cleanly.' })
  @IsOptional()
  @IsString()
  notes?: string;
}
