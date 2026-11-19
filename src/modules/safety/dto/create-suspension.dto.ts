import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class CreateSuspensionDto {
  @ApiProperty()
  @IsUUID()
  driverProfileId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  credentialId?: string;

  @ApiProperty({ example: 'MoD Transport Regulation Art. 14.2' })
  @IsString()
  @IsNotEmpty()
  legalBasis: string;

  @ApiProperty({
    example: 'Substantiated severe convoy safety violation pending remediation.',
  })
  @IsString()
  @IsNotEmpty()
  reason: string;

  @ApiPropertyOptional({
    example: '2026-11-11',
    description: 'Date the suspension takes effect (defaults to today; cannot be in the future).',
  })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ example: '2026-12-10' })
  @IsOptional()
  @IsDateString()
  reviewDate?: string;

  @ApiPropertyOptional({ example: '2027-01-10', description: 'Planned end of a fixed-term suspension (must be after the start date).' })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}
