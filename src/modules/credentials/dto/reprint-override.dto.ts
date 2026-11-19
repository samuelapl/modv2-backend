import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ReprintReason } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsString, MaxLength, ValidateIf } from 'class-validator';

export class ReprintOverrideDto {
  @ApiProperty({ enum: ReprintReason, example: ReprintReason.DAMAGED })
  @IsEnum(ReprintReason)
  reasonCode: ReprintReason;

  @ApiPropertyOptional({ description: 'Required when the reason is DATA_CORRECTION.' })
  @ValidateIf(
    (o: ReprintOverrideDto) =>
      o.reasonCode === ReprintReason.DATA_CORRECTION || o.note !== undefined,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  note?: string;
}
