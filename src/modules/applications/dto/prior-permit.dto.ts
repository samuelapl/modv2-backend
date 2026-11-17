import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

/** Existing (pre-system) permit held by an already-trained driver. */
export class PriorPermitDto {
  @ApiProperty({ type: [String], example: ['CAT-LV', 'CAT-HV'] })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  categoryCodes: string[];

  @ApiProperty({ example: 'MOD-P-1234' })
  @IsString()
  @IsNotEmpty()
  permitNumber: string;

  @ApiProperty({ example: '2023-05-10', description: 'Original issue date — kept on the new credential' })
  @IsDateString()
  issueDate: string;

  @ApiProperty({ example: '2028-05-10', description: 'Original expiry date — kept on the new credential' })
  @IsDateString()
  expiryDate: string;

  @ApiPropertyOptional({ example: 'TRN-889' })
  @IsOptional()
  @IsString()
  trainingReference?: string;

  @ApiPropertyOptional({ description: 'Object key of the scanned permit in the certificates bucket' })
  @IsOptional()
  @IsString()
  documentUrl?: string;
}

/** Record an existing permit for a driver who is already registered. */
export class CreatePreTrainedApplicationDto {
  @ApiProperty()
  @IsUUID()
  driverProfileId: string;

  @ApiProperty({ type: PriorPermitDto })
  @ValidateNested()
  @Type(() => PriorPermitDto)
  priorPermit: PriorPermitDto;
}

export class BulkDecideApplicationsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  applicationIds: string[];

  @ApiPropertyOptional({ example: 'Existing permits verified against unit records.' })
  @IsOptional()
  @IsString()
  comments?: string;
}
