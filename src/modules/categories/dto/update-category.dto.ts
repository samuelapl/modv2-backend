import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

export class UpdateCategoryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(18)
  @Max(60)
  minAgeRequired?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  validityYears?: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((o) => o.prerequisiteCatId !== null)
  @IsUUID()
  prerequisiteCatId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  requiresNationalLicense?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  requiresMedical?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
