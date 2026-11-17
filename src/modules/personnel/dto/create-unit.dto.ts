import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateUnitDto {
  @ApiProperty({ example: 'NORTH-TRANS-01' })
  @IsString()
  @IsNotEmpty()
  code: string;

  @ApiProperty({ example: 'Northern Command Transport Directorate' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  parentUnitId?: string;
}
