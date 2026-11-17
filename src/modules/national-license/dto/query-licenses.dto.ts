import { ApiPropertyOptional } from '@nestjs/swagger';
import { VerificationStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class QueryLicensesDto extends PaginationDto {
  @ApiPropertyOptional({ enum: VerificationStatus })
  @IsOptional()
  @IsEnum(VerificationStatus)
  status?: VerificationStatus;

  @ApiPropertyOptional({ example: 60 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expiringWithinDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  unitId?: string;

  @ApiPropertyOptional({
    enum: ['EXPIRED', 'EXPIRING_SOON', 'VALID'],
    description: 'Already expired, expiring within 60 days, or valid beyond that',
  })
  @IsOptional()
  @IsIn(['EXPIRED', 'EXPIRING_SOON', 'VALID'])
  expiry?: 'EXPIRED' | 'EXPIRING_SOON' | 'VALID';

  @ApiPropertyOptional({ example: 'Oromia Transport Bureau' })
  @IsOptional()
  @IsString()
  issuingAuthority?: string;

  @ApiPropertyOptional({ example: 'Auto', description: 'National licence category' })
  @IsOptional()
  @IsString()
  category?: string;
}
