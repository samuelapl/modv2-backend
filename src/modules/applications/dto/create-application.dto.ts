import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApplicationType, ReplacementReason } from '@prisma/client';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  ValidateIf,
} from 'class-validator';

export class CreateApplicationDto {
  @ApiProperty()
  @IsUUID()
  driverProfileId: string;

  @ApiProperty({ enum: ApplicationType, example: ApplicationType.NEW_AUTHORIZATION })
  @IsEnum(ApplicationType)
  type: ApplicationType;

  @ApiProperty({
    type: [String],
    description:
      'Requested categories. Ignored for REPLACEMENT — the replaced permit\'s categories are copied.',
  })
  @ValidateIf((o: CreateApplicationDto) => o.type !== ApplicationType.REPLACEMENT)
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  categoryIds: string[];

  @ApiPropertyOptional({
    enum: ReplacementReason,
    description: 'Required for REPLACEMENT applications.',
  })
  @ValidateIf((o: CreateApplicationDto) => o.type === ApplicationType.REPLACEMENT)
  @IsEnum(ReplacementReason, {
    message: 'Select why the card is being replaced (LOST, STOLEN or DAMAGED).',
  })
  replacementReason?: ReplacementReason;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  submitImmediately?: boolean = true;

  @ApiPropertyOptional({ example: 'Lost card incident report attached / operational transfer.' })
  @IsOptional()
  @IsString()
  notes?: string;
}
