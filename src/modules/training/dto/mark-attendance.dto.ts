import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsDateString } from 'class-validator';

export class MarkAttendanceDto {
  @ApiProperty({
    example: ['2026-11-23', '2026-11-24'],
    description: 'Every training day the trainee attended (yyyy-mm-dd). Days not listed count as absent.',
  })
  @IsArray()
  @ArrayMaxSize(400)
  @IsDateString({ strict: true }, { each: true })
  attendedDates: string[];
}
