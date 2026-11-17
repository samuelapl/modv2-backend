import { ApiPropertyOptional } from '@nestjs/swagger';
import { CredentialStatus } from '@prisma/client';
import { IsEnum, IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class QueryCredentialsDto extends PaginationDto {
  @ApiPropertyOptional({ enum: CredentialStatus })
  @IsOptional()
  @IsEnum(CredentialStatus)
  status?: CredentialStatus;

  @ApiPropertyOptional({ example: 'CAT-HV' })
  @IsOptional()
  @IsString()
  categoryCode?: string;

  @ApiPropertyOptional({
    enum: ['EXPIRED', 'EXPIRING_SOON', 'VALID'],
    description: 'Past expiry, expiring within 90 days, or valid beyond that',
  })
  @IsOptional()
  @IsIn(['EXPIRED', 'EXPIRING_SOON', 'VALID'])
  expiry?: 'EXPIRED' | 'EXPIRING_SOON' | 'VALID';

  @ApiPropertyOptional({
    enum: ['RESTRICTED', 'UNRESTRICTED'],
    description: 'Whether the permit carries medical operating restrictions',
  })
  @IsOptional()
  @IsIn(['RESTRICTED', 'UNRESTRICTED'])
  restrictions?: 'RESTRICTED' | 'UNRESTRICTED';

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  driverProfileId?: string;
}
