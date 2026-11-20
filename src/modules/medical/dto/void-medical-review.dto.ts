import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class VoidMedicalReviewDto {
  @ApiProperty({ example: 'Recorded against the wrong driver.' })
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason: string;
}
