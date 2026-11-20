import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsOptional,
  IsUUID,
} from 'class-validator';

export const BULK_ATTENDANCE_MODES = ['ALL', 'DAY'] as const;
export type BulkAttendanceMode = (typeof BULK_ATTENDANCE_MODES)[number];

export class BulkMarkAttendanceDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  enrollmentIds: string[];

  @ApiProperty({
    enum: BULK_ATTENDANCE_MODES,
    description: 'ALL = attended every training day so far; DAY = attended the given date.',
  })
  @IsIn(BULK_ATTENDANCE_MODES)
  mode: BulkAttendanceMode;

  @ApiPropertyOptional({ example: '2026-11-23', description: 'Required for mode DAY.' })
  @IsOptional()
  @IsDateString({ strict: true })
  date?: string;
}
