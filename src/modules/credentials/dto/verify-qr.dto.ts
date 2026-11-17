import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class VerifyQrDto {
  @ApiProperty({ example: 'IDLMS1.eyJjcmVkIjoiTU9ELUFVVEgtMjAyNi0wMDAxIn0.abcd...' })
  @IsString()
  @IsNotEmpty()
  token: string;
}
