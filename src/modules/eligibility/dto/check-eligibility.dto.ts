import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CheckEligibilityDto {
  @ApiPropertyOptional({ example: 'MOD-1234' })
  @IsOptional()
  @IsString()
  serviceNumber?: string;

  @ApiPropertyOptional({ example: 'MOD-AUTH-2026-0001' })
  @IsOptional()
  @IsString()
  credentialNumber?: string;

  @ApiProperty({ example: 'CAT-SP' })
  @IsString()
  @IsNotEmpty()
  categoryCode: string;
}
