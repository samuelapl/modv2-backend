import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';

export class BulkIssueCredentialsDto {
  @ApiProperty({ type: [String], description: 'Approved application IDs to issue permits for' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  applicationIds: string[];
}
