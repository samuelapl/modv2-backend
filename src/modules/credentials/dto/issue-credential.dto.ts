import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export class IssueCredentialDto {
  @ApiProperty()
  @IsUUID()
  applicationId: string;

  @ApiPropertyOptional({ example: 'SN-MOD-2026-CUSTOM1' })
  @IsOptional()
  @IsString()
  serialNumber?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  validityYearsOverride?: number;
}
