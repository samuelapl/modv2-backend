import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ReplacementReason } from '@prisma/client';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { PriorPermitDto } from './prior-permit.dto';

export class SubmitApplicationDto {
  @ApiPropertyOptional({
    type: [String],
    description: 'Corrected vehicle categories (standard applications only).',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  categoryIds?: string[];

  @ApiPropertyOptional({
    description: 'What was corrected. Required when resubmitting a returned application.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @ApiPropertyOptional({
    enum: ReplacementReason,
    description: 'Corrected replacement reason (replacement applications only).',
  })
  @IsOptional()
  @IsEnum(ReplacementReason)
  replacementReason?: ReplacementReason;

  @ApiPropertyOptional({
    type: PriorPermitDto,
    description:
      'Corrected existing-permit details (already-trained applications only). Its categories replace the requested categories.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => PriorPermitDto)
  priorPermit?: PriorPermitDto;
}
