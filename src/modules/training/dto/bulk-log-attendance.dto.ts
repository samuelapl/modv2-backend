import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CourseStatus } from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

export const BULK_HOURS_MODES = ['ADD', 'SET', 'FULL'] as const;
export type BulkHoursMode = (typeof BULK_HOURS_MODES)[number];

export class BulkLogAttendanceDto {
  @ApiProperty({ type: [String], description: 'Training enrollments to update.' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  enrollmentIds: string[];

  @ApiProperty({
    enum: BULK_HOURS_MODES,
    description:
      "SET = set every total to `hours`; FULL = set each total to its course's required hours (`hours` ignored); ADD = add `hours` to each trainee's current total.",
  })
  @IsIn(BULK_HOURS_MODES as unknown as string[])
  mode: BulkHoursMode;

  @ApiProperty({ example: 24, minimum: 0, maximum: 500 })
  @ValidateIf((o: BulkLogAttendanceDto) => o.mode !== 'FULL')
  @IsInt()
  @Min(0)
  @Max(500)
  hours?: number;

  @ApiPropertyOptional({
    enum: CourseStatus,
    description:
      'Outcome to set on every trainee. Omit to keep each status (Planned trainees move to In Progress once they have hours).',
  })
  @IsOptional()
  @IsEnum(CourseStatus)
  status?: CourseStatus;

  @ApiPropertyOptional({
    example: 'Day 3 — yard maneuvers, all present.',
    description: "Appended to each trainee's instructor notes.",
  })
  @IsOptional()
  @IsString()
  notes?: string;
}
