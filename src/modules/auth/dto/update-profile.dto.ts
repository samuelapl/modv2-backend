import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString } from 'class-validator';

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: '+251911223344', description: 'Contact phone number' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ example: 'officer@mod.gov.et', description: 'Contact email address' })
  @IsOptional()
  @IsEmail()
  email?: string;
}
