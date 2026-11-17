import { ApiPropertyOptional } from '@nestjs/swagger';
import { IncidentSeverity, InvestigationStatus } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';

export class InvestigateIncidentDto {
  @ApiPropertyOptional({ enum: InvestigationStatus })
  @IsOptional()
  @IsEnum(InvestigationStatus)
  status?: InvestigationStatus;

  @ApiPropertyOptional({ enum: IncidentSeverity })
  @IsOptional()
  @IsEnum(IncidentSeverity)
  severity?: IncidentSeverity;

  @ApiPropertyOptional({ example: 'Complete 16h Remedial Convoy Safety Refresher' })
  @IsOptional()
  @IsString()
  correctiveAction?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  remedialCompleted?: boolean;
}
