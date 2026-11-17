import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ArrayMinSize,
} from 'class-validator';

export class RecordLicenseDto {
  @ApiProperty()
  @IsUUID()
  driverProfileId: string;

  @ApiProperty({ example: 'ETH-AA-2023-44102' })
  @IsString()
  @IsNotEmpty()
  licenseNumber: string;

  @ApiProperty({ example: 'Federal Transport Authority' })
  @IsString()
  @IsNotEmpty()
  issuingAuthority: string;

  @ApiProperty({ example: ['Category 1 - Auto', 'Dry Cargo 1'] })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  categories: string[];

  @ApiProperty({ example: '2023-01-15' })
  @IsDateString()
  issuedDate: string;

  @ApiProperty({ example: '2028-01-14' })
  @IsDateString()
  expiryDate: string;

  @ApiPropertyOptional({ example: '17312345-uuid.jpg' })
  @IsOptional()
  @IsString()
  documentEvidenceUrl?: string;
}
