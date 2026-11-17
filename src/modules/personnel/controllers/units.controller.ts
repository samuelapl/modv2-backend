import { Controller, Get, Post, Patch, Delete, Body, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UnitsService } from '../services/units.service';
import { CreateUnitDto } from '../dto/create-unit.dto';
import { UpdateUnitDto } from '../dto/update-unit.dto';
import {
  RequirePermissions,
  RequireAnyPermission,
} from '../../../common/decorators/permissions.decorator';
import { Permission } from '../../../common/enums/permissions.enum';
import { AuditMeta } from '../../../common/decorators/audit.decorator';

@ApiTags('Personnel - Units')
@ApiBearerAuth('JWT-auth')
@Controller('personnel/units')
export class UnitsController {
  constructor(private readonly unitsService: UnitsService) {}

  @Get()
  @RequireAnyPermission(
    Permission.UNITS_MANAGE,
    Permission.USERS_MANAGE,
    Permission.DRIVERS_REGISTER,
    Permission.DRIVERS_VIEW_ALL,
    Permission.DRIVERS_VIEW_UNIT,
  )
  @ApiOperation({ summary: 'List MoD organizational units' })
  findAll() {
    return this.unitsService.findAll();
  }

  @Post()
  @AuditMeta('CREATE_UNIT', 'OrganizationalUnit', 'organizationalUnit')
  @RequirePermissions(Permission.UNITS_MANAGE)
  @ApiOperation({ summary: 'Create a broad administrative MoD organizational unit' })
  create(@Body() dto: CreateUnitDto) {
    return this.unitsService.create(dto);
  }

  @Patch(':id')
  @AuditMeta('UPDATE_UNIT', 'OrganizationalUnit', 'organizationalUnit')
  @RequirePermissions(Permission.UNITS_MANAGE)
  @ApiOperation({ summary: 'Update organizational unit details' })
  update(@Param('id') id: string, @Body() dto: UpdateUnitDto) {
    return this.unitsService.update(id, dto);
  }

  @Delete(':id')
  @AuditMeta('DELETE_UNIT', 'OrganizationalUnit', 'organizationalUnit')
  @RequirePermissions(Permission.UNITS_MANAGE)
  @ApiOperation({ summary: 'Delete an organizational unit that has no drivers, users or sub-units' })
  remove(@Param('id') id: string) {
    return this.unitsService.remove(id);
  }
}
