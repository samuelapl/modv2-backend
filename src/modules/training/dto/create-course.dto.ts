import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class CreateCourseDto {
  @ApiProperty({ example: 'TRN-HV-02' })
  @IsString()
  @IsNotEmpty()
  courseCode: string;

  @ApiProperty({ example: 'Advanced Heavy Tanker Logistics' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({
    type: [String],
    example: ['CAT-HV'],
    description: 'Vehicle categories this course qualifies a driver for.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  categoryCodes: string[];

  @ApiProperty({ example: 40, minimum: 1, maximum: 200 })
  @IsInt()
  @Min(1)
  @Max(200)
  durationHours: number;

  @ApiPropertyOptional({ example: 30, minimum: 1, maximum: 365 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  durationDays?: number;

  @ApiPropertyOptional({ example: 'Hazardous tanker braking, hill descent, and safety.' })
  @IsOptional()
  @IsString()
  syllabus?: string;
}
