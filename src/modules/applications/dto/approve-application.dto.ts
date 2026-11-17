import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApprovalAction } from '@prisma/client';
import { IsIn, IsOptional, IsString } from 'class-validator';

export class ApproveApplicationDto {
  @ApiProperty({
    enum: [
      ApprovalAction.APPROVED,
      ApprovalAction.REJECTED,
      ApprovalAction.RETURNED,
    ],
  })
  @IsIn([
    ApprovalAction.APPROVED,
    ApprovalAction.REJECTED,
    ApprovalAction.RETURNED,
  ])
  action: ApprovalAction;

  @ApiPropertyOptional({ example: 'Command authority approves issuance eligibility.' })
  @IsOptional()
  @IsString()
  comments?: string;
}
