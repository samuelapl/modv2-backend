import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({
    example: 'MOD-ADMIN-001',
    description: 'Official Ministry of Defence Service Number',
  })
  @IsString()
  @IsNotEmpty()
  serviceNumber: string;

  @ApiProperty({
    example: 'Password12',
    description: 'Staff portal password',
  })
  @IsString()
  @MinLength(6)
  password: string;
}
