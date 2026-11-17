import { ApiProperty } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsUUID } from 'class-validator';

export class BulkDeleteUsersDto {
  @ApiProperty({ type: [String], description: 'List of user account UUIDs to delete' })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID(undefined, { each: true })
  ids: string[];
}
