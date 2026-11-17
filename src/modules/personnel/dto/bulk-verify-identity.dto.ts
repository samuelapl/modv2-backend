import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsUUID,
} from 'class-validator';

export class BulkVerifyIdentityDto {
  @ApiProperty({ type: [String], description: 'Driver profile IDs to stamp as identity-verified' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  driverIds: string[];
}
