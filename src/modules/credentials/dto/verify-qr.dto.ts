import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class VerifyQrDto {
  @ApiProperty({
    example: 'IDLMS2.eyJjcmVkIjoiTU9ELUFVVEgtMjAyNi0wMDAxIiwic2VyaWFsIjoiU04tMDAxIn0.sig...',
    description: 'Cryptographic QR token (supports IDLMS2 Ed25519 or IDLMS1 HMAC)',
  })
  @IsString()
  @IsNotEmpty()
  token: string;
}
