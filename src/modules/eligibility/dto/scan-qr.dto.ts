import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ScanQrDto {
  @ApiProperty({ example: 'IDLMS1.eyJjcmVkIjoiTU9ELUFVVEgtMjAyNi0wMDAxIn0...' })
  @IsString()
  @IsNotEmpty()
  token: string;

  @ApiPropertyOptional({ example: 'CAT-SP' })
  @IsOptional()
  @IsString()
  categoryCode?: string;
}
