import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsUUID, ValidateIf } from 'class-validator';

export class UpdateUnitDto {
  @ApiPropertyOptional({ example: 'NORTH-TRANS-01' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  code?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Parent unit id, or null to make this a top-level unit.',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  parentUnitId?: string | null;
}
