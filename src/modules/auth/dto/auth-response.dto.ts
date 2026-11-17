import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SystemRole } from '@prisma/client';

export class UnitSummaryDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  code: string;
}

export class AuthenticatedUserDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  serviceNumber: string;

  @ApiProperty({ nullable: true })
  fullName: string | null;

  @ApiProperty({ nullable: true })
  rank: string | null;

  @ApiProperty({ nullable: true })
  phone: string | null;

  @ApiProperty({ nullable: true })
  email: string | null;

  @ApiProperty({ enum: SystemRole, isArray: true })
  roles: SystemRole[];

  @ApiProperty({ nullable: true })
  unitId: string | null;

  @ApiPropertyOptional({ type: UnitSummaryDto, nullable: true })
  unit?: UnitSummaryDto | null;

  @ApiProperty({ type: [String] })
  permissions: string[];

  @ApiProperty({ enum: ['en', 'am'], example: 'en' })
  preferredLocale: string;

  @ApiProperty({
    description: 'True while the user still has an admin-issued temporary password.',
  })
  mustChangePassword: boolean;

  @ApiProperty({
    enum: ['INCOMPLETE', 'COMPLETE'],
    nullable: true,
    description: 'Driver profile status; null when the user has no driver profile.',
  })
  profileStatus: 'INCOMPLETE' | 'COMPLETE' | null;
}

export class LoginResponseDto {
  @ApiProperty()
  accessToken: string;

  @ApiProperty({ type: AuthenticatedUserDto })
  user: AuthenticatedUserDto;
}
