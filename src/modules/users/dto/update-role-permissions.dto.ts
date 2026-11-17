import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsEnum } from 'class-validator';
import { Permission } from '../../../common/enums/permissions.enum';

export class UpdateRolePermissionsDto {
  @ApiProperty({
    enum: Permission,
    isArray: true,
    example: [Permission.DRIVERS_REGISTER, Permission.APPLICATIONS_CREATE],
  })
  @IsArray()
  @IsEnum(Permission, { each: true })
  permissions: Permission[];
}
