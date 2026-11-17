import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SystemRole } from '@prisma/client';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { QueryUsersDto } from './dto/query-users.dto';
import { UpdateRolePermissionsDto } from './dto/update-role-permissions.dto';
import { BulkDeleteUsersDto } from './dto/bulk-delete-users.dto';
import { Public } from '../../common/decorators/public.decorator';
import { AuditMeta } from '../../common/decorators/audit.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/enums/permissions.enum';

@ApiTags('Users')
@ApiBearerAuth('JWT-auth')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Public()
  @Get('health')
  @ApiOperation({ summary: 'Check Users module readiness' })
  getHealth() {
    return this.usersService.getStatus();
  }

  @Get()
  @RequirePermissions(Permission.USERS_MANAGE)
  @ApiOperation({ summary: 'List paginated MoD user accounts' })
  findAll(@Query() query: QueryUsersDto) {
    return this.usersService.findAll(query);
  }

  @Post()
  @AuditMeta('CREATE_USER', 'User', 'user')
  @RequirePermissions(Permission.USERS_MANAGE)
  @ApiOperation({ summary: 'Create internal MoD staff user account' })
  create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }

  @Post('bulk-delete')
  @AuditMeta('BULK_DELETE_USERS', 'User', 'user')
  @RequirePermissions(Permission.USERS_MANAGE)
  @ApiOperation({ summary: 'Bulk delete MoD staff user accounts without operational history' })
  bulkRemove(
    @Body() dto: BulkDeleteUsersDto,
    @CurrentUser('id') actorId: string,
  ) {
    return this.usersService.bulkRemove(dto.ids, actorId);
  }

  @Get('roles/templates')
  @RequirePermissions(Permission.ROLES_MANAGE)
  @ApiOperation({ summary: 'List all 12 MoD role permission templates' })
  getRoleTemplates() {
    return this.usersService.getRoleTemplates();
  }

  @Get('permissions/catalog')
  @RequirePermissions(Permission.ROLES_MANAGE)
  @ApiOperation({ summary: 'List grouped catalog of all system permissions' })
  getPermissionCatalog() {
    return this.usersService.getAvailablePermissions();
  }

  @Patch('roles/:role/permissions')
  @AuditMeta('UPDATE_ROLE_PERMISSIONS', 'RolePermission', 'rolePermission', 'role')
  @RequirePermissions(Permission.ROLES_MANAGE)
  @ApiOperation({ summary: 'Update granular permissions assigned to a role template' })
  updateRolePermissions(
    @Param('role') role: SystemRole,
    @Body() dto: UpdateRolePermissionsDto,
  ) {
    return this.usersService.updateRolePermissions(role, dto);
  }

  @Get(':id')
  @RequirePermissions(Permission.USERS_MANAGE)
  @ApiOperation({ summary: 'Get single user account details' })
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Patch(':id')
  @AuditMeta('UPDATE_USER', 'User', 'user')
  @RequirePermissions(Permission.USERS_MANAGE)
  @ApiOperation({ summary: 'Update user roles, status, or delegated permissions' })
  update(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.usersService.update(id, dto);
  }

  @Delete(':id')
  @AuditMeta('DELETE_USER', 'User', 'user')
  @RequirePermissions(Permission.USERS_MANAGE)
  @ApiOperation({ summary: 'Delete an unused MoD staff user account' })
  remove(@Param('id') id: string, @CurrentUser('id') actorId: string) {
    return this.usersService.remove(id, actorId);
  }
}
