import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsUUID, MinLength } from 'class-validator';

export class RevokePermitDto {
  @ApiProperty({ description: 'Driver whose permits are revoked' })
  @IsUUID()
  driverProfileId: string;

  @ApiProperty({ example: 'Disciplinary Code §22 — Gross negligence' })
  @IsString()
  @IsNotEmpty()
  legalBasis: string;

  @ApiProperty({
    example: 'Repeated substantiated convoy violations; permit permanently revoked.',
  })
  @IsString()
  @MinLength(5)
  reason: string;
}
