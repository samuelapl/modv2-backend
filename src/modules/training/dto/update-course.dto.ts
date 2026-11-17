import { ApiPropertyOptional } from '@nestjs/swagger';
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

export class UpdateCourseDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  title?: string;

  @ApiPropertyOptional({ type: [String], example: ['CAT-HV'] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  categoryCodes?: string[];

  @ApiPropertyOptional({ minimum: 1, maximum: 200 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  durationHours?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 365 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  durationDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  syllabus?: string;
}
