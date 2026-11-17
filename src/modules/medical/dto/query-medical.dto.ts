import { ApiPropertyOptional } from '@nestjs/swagger';
import { MedicalFitnessOutcome } from '@prisma/client';
import { IsEnum, IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class QueryMedicalDto extends PaginationDto {
  @ApiPropertyOptional({ enum: MedicalFitnessOutcome })
  @IsOptional()
  @IsEnum(MedicalFitnessOutcome)
  outcome?: MedicalFitnessOutcome;

  @ApiPropertyOptional({ example: 'CAT-HV' })
  @IsOptional()
  @IsString()
  categoryCode?: string;

  @ApiPropertyOptional({ description: 'Training batch the candidate came from' })
  @IsOptional()
  @IsUUID()
  batchId?: string;

  @ApiPropertyOptional({ example: 'CORRECTIVE_LENSES' })
  @IsOptional()
  @IsString()
  restriction?: string;

  @ApiPropertyOptional({
    enum: ['OVERDUE', 'DUE_SOON', 'VALID'],
    description: 'Next review due: past, within 90 days, or later',
  })
  @IsOptional()
  @IsIn(['OVERDUE', 'DUE_SOON', 'VALID'])
  dueStatus?: 'OVERDUE' | 'DUE_SOON' | 'VALID';

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  driverProfileId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  applicationId?: string;
}
