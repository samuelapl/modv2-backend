import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MedicalFitnessOutcome } from '@prisma/client';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { ALLOWED_OPERATIONAL_RESTRICTIONS } from '../constants/medical-restrictions';

export class RecordMedicalReviewDto {
  @ApiProperty()
  @IsUUID()
  driverProfileId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  applicationId?: string;

  @ApiProperty({ example: 'Armed Forces Comprehensive Specialized Hospital' })
  @IsString()
  @IsNotEmpty()
  medicalFacility: string;

  @ApiProperty({ example: 'MED-OF-4410' })
  @IsString()
  @IsNotEmpty()
  reviewerBadgeNumber: string;

  @ApiProperty({
    enum: MedicalFitnessOutcome,
    example: MedicalFitnessOutcome.FIT_WITH_RESTRICTIONS,
  })
  @IsEnum(MedicalFitnessOutcome)
  outcome: MedicalFitnessOutcome;

  @ApiProperty({
    type: [String],
    enum: ALLOWED_OPERATIONAL_RESTRICTIONS,
    example: ['CORRECTIVE_LENSES'],
  })
  @IsArray()
  @IsIn(ALLOWED_OPERATIONAL_RESTRICTIONS, { each: true })
  operationalRestrictions: string[];

  @ApiProperty({ example: '2026-11-10' })
  @IsDateString()
  assessmentDate: string;

  @ApiProperty({ example: '2029-11-10' })
  @IsDateString()
  reviewDueDate: string;

  @ApiPropertyOptional({ example: '17312345-medical-fit.pdf' })
  @IsOptional()
  @IsString()
  documentProofUrl?: string;
}
