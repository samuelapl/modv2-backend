import { ApiPropertyOptional } from '@nestjs/swagger';
import { IncidentSeverity, InvestigationStatus } from '@prisma/client';
import { IsEnum, IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class QuerySafetyDto extends PaginationDto {
  @ApiPropertyOptional({ enum: IncidentSeverity })
  @IsOptional()
  @IsEnum(IncidentSeverity)
  severity?: IncidentSeverity;

  @ApiPropertyOptional({ enum: InvestigationStatus })
  @IsOptional()
  @IsEnum(InvestigationStatus)
  investigationStatus?: InvestigationStatus;

  @ApiPropertyOptional({ example: 'true' })
  @IsOptional()
  @IsString()
  isActive?: string;

  @ApiPropertyOptional({
    enum: ['ACTIVE', 'REINSTATED', 'REVOKED'],
    description: 'Suspensions: still active, ended by reinstatement, or ended by revocation',
  })
  @IsOptional()
  @IsIn(['ACTIVE', 'REINSTATED', 'REVOKED'])
  state?: 'ACTIVE' | 'REINSTATED' | 'REVOKED';

  @ApiPropertyOptional({
    enum: ['PENDING', 'COMPLETED', 'NONE'],
    description: 'Incidents: corrective action pending, completed, or none assigned',
  })
  @IsOptional()
  @IsIn(['PENDING', 'COMPLETED', 'NONE'])
  remedial?: 'PENDING' | 'COMPLETED' | 'NONE';

  @ApiPropertyOptional({
    enum: ['30D', '90D', '365D'],
    description: 'Incidents that happened within the last N days',
  })
  @IsOptional()
  @IsIn(['30D', '90D', '365D'])
  period?: '30D' | '90D' | '365D';

  @ApiPropertyOptional({
    enum: ['OVERDUE', 'UPCOMING', 'NONE'],
    description: 'Suspensions: review date passed, within 30 days, or not set',
  })
  @IsOptional()
  @IsIn(['OVERDUE', 'UPCOMING', 'NONE'])
  review?: 'OVERDUE' | 'UPCOMING' | 'NONE';

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  driverProfileId?: string;
}
