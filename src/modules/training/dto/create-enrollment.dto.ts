import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateEnrollmentDto {
  @ApiProperty()
  @IsUUID()
  driverProfileId: string;

  @ApiProperty()
  @IsUUID()
  courseId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  applicationId?: string;

  @ApiPropertyOptional({
    example: 'CAT-HV',
    description:
      'Category this enrollment trains for. Required only when the course covers several categories that could apply.',
  })
  @IsOptional()
  @IsString()
  categoryCode?: string;

  @ApiPropertyOptional({ example: 'MOD-INST-001' })
  @IsOptional()
  @IsString()
  instructorId?: string;

  @ApiPropertyOptional({ example: 'Assigned to Batch 2026-Q2 Convoy Yard' })
  @IsOptional()
  @IsString()
  notes?: string;
}
