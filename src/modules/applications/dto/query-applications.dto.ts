import { ApiPropertyOptional } from '@nestjs/swagger';
import { ApplicationStatus, ApplicationType } from '@prisma/client';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class QueryApplicationsDto extends PaginationDto {
  @ApiPropertyOptional({ enum: ApplicationStatus })
  @IsOptional()
  @IsEnum(ApplicationStatus)
  status?: ApplicationStatus;

  @ApiPropertyOptional({ enum: ApplicationType })
  @IsOptional()
  @IsEnum(ApplicationType)
  type?: ApplicationType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  driverProfileId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  unitId?: string;
}
