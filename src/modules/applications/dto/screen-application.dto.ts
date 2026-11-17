import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApplicationStatus } from '@prisma/client';
import { IsIn, IsOptional, IsString } from 'class-validator';

export type ScreeningAction = 'START_SCREENING' | 'ADVANCE_STAGE' | 'RETURN' | 'REJECT';

export class ScreenApplicationDto {
  @ApiProperty({ enum: ['START_SCREENING', 'ADVANCE_STAGE', 'RETURN', 'REJECT'] })
  @IsIn(['START_SCREENING', 'ADVANCE_STAGE', 'RETURN', 'REJECT'])
  action: ScreeningAction;

  @ApiPropertyOptional({
    enum: [
      ApplicationStatus.TRAINING_PENDING,
      ApplicationStatus.EXAM_PENDING,
      ApplicationStatus.MEDICAL_PENDING,
      ApplicationStatus.READY_FOR_APPROVAL,
    ],
  })
  @IsOptional()
  @IsIn([
    ApplicationStatus.TRAINING_PENDING,
    ApplicationStatus.EXAM_PENDING,
    ApplicationStatus.MEDICAL_PENDING,
    ApplicationStatus.READY_FOR_APPROVAL,
  ])
  targetStage?: ApplicationStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  comments?: string;
}
