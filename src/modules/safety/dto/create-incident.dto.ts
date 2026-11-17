import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IncidentSeverity } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class CreateIncidentDto {
  @ApiProperty()
  @IsUUID()
  driverProfileId: string;

  @ApiProperty({ example: '2026-11-09T14:30:00.000Z' })
  @IsDateString()
  incidentDate: string;

  @ApiPropertyOptional({
    example: 'Addis Ababa Ring Road Sector (Generalized Area)',
  })
  @IsOptional()
  @IsString()
  location?: string;

  @ApiProperty({ enum: IncidentSeverity, example: IncidentSeverity.SEVERE })
  @IsEnum(IncidentSeverity)
  severity: IncidentSeverity;

  @ApiProperty({
    example: 'Convoy cargo truck brushed perimeter barrier during night turn.',
  })
  @IsString()
  @IsNotEmpty()
  description: string;

  @ApiPropertyOptional({ example: 'Remedial Convoy Training Required' })
  @IsOptional()
  @IsString()
  correctiveAction?: string;
}
