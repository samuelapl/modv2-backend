import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class CreateCategoryDto {
  @ApiProperty({ example: 'CAT-AR' })
  @IsString()
  @IsNotEmpty()
  code: string;

  @ApiProperty({ example: 'Armoured Support & Utility Carrier' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ example: 'Armoured logistics carrier inside military sectors.' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ default: 21, minimum: 18, maximum: 60 })
  @IsOptional()
  @IsInt()
  @Min(18)
  @Max(60)
  minAgeRequired?: number = 18;

  @ApiPropertyOptional({ default: 3, minimum: 1, maximum: 10 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  validityYears?: number = 3;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  prerequisiteCatId?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  requiresNationalLicense?: boolean = false;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  requiresMedical?: boolean = true;
}
