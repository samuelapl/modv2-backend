import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VerificationStatus } from '@prisma/client';
import { IsIn, IsOptional, IsString } from 'class-validator';

export class VerifyLicenseDto {
  @ApiProperty({
    enum: [
      VerificationStatus.VERIFIED,
      VerificationStatus.REJECTED,
      VerificationStatus.EXPIRED,
    ],
  })
  @IsIn([
    VerificationStatus.VERIFIED,
    VerificationStatus.REJECTED,
    VerificationStatus.EXPIRED,
  ])
  status: VerificationStatus;

  @ApiPropertyOptional({ example: 'Verified against physical card and FTA register.' })
  @IsOptional()
  @IsString()
  verificationNotes?: string;
}
