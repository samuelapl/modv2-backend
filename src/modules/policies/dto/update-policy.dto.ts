import { ApiProperty } from '@nestjs/swagger';
import { IsDefined } from 'class-validator';

export class UpdatePolicyDto {
  @ApiProperty({ example: 80, description: 'The new value. Its type and limits come from the policy definition.' })
  @IsDefined()
  value: unknown;
}
