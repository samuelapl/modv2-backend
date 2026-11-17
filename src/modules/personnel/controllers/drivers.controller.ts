import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  Header,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { DriversService, RequestUserContext } from '../services/drivers.service';
import { CreateDriverDto } from '../dto/create-driver.dto';
import { BulkCreateDriversDto } from '../dto/bulk-create-drivers.dto';
import { UpdateDriverDto } from '../dto/update-driver.dto';
import { UpdateMyProfileDto } from '../dto/update-my-profile.dto';
import { BulkVerifyIdentityDto } from '../dto/bulk-verify-identity.dto';
import { QueryDriversDto } from '../dto/query-drivers.dto';
import {
  RequirePermissions,
  RequireAnyPermission,
} from '../../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { AuditMeta } from '../../../common/decorators/audit.decorator';
import { Permission } from '../../../common/enums/permissions.enum';

@ApiTags('Personnel - Drivers')
@ApiBearerAuth('JWT-auth')
@Controller('personnel/drivers')
export class DriversController {
  constructor(private readonly driversService: DriversService) {}

  @Get()
  @RequireAnyPermission(
    Permission.DRIVERS_VIEW_ALL,
    Permission.DRIVERS_VIEW_UNIT,
    Permission.DRIVERS_VIEW_OWN,
  )
  @ApiOperation({ summary: 'List paginated drivers scoped by PBAC permissions' })
  findAll(
    @Query() query: QueryDriversDto,
    @CurrentUser() user: RequestUserContext,
  ) {
    return this.driversService.findAll(query, user);
  }

  // Self-service. Declared before ':id' so 'me' is not captured as an id. Open to
  // any signed-in user; a user without a driver profile gets DRIVER_NOT_FOUND.
  @Get('me')
  @ApiOperation({ summary: "The signed-in driver's own profile and missing required fields" })
  findMine(@CurrentUser('id') userId: string) {
    return this.driversService.findMine(userId);
  }

  @Patch('me')
  @AuditMeta('UPDATE_OWN_DRIVER_PROFILE', 'DriverProfile')
  @ApiOperation({ summary: 'Complete / update own driver profile (self-service fields only)' })
  updateMine(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateMyProfileDto,
  ) {
    return this.driversService.updateMine(userId, dto);
  }

  @Get(':id')
  @RequireAnyPermission(
    Permission.DRIVERS_VIEW_ALL,
    Permission.DRIVERS_VIEW_UNIT,
    Permission.DRIVERS_VIEW_OWN,
  )
  @ApiOperation({ summary: 'Get single driver profile dossier' })
  findOne(
    @Param('id') id: string,
    @CurrentUser() user: RequestUserContext,
  ) {
    return this.driversService.findOne(id, user);
  }

  @Post()
  @Header('Cache-Control', 'no-store')
  @AuditMeta('REGISTER_DRIVER', 'DriverProfile', 'driverProfile')
  @RequirePermissions(Permission.DRIVERS_REGISTER)
  @ApiOperation({ summary: 'Register new MoD driver profile (Form 1)' })
  create(
    @Body() dto: CreateDriverDto,
    @CurrentUser() user: RequestUserContext,
  ) {
    return this.driversService.create(dto, user);
  }

  @Post('bulk')
  @Header('Cache-Control', 'no-store')
  @AuditMeta('BULK_REGISTER_DRIVERS', 'DriverProfile')
  @RequirePermissions(Permission.DRIVERS_REGISTER)
  @ApiOperation({ summary: 'Bulk register driver profiles & portal accounts from reviewed CSV' })
  bulkCreate(
    @Body() dto: BulkCreateDriversDto,
    @CurrentUser() user: RequestUserContext,
  ) {
    return this.driversService.bulkCreate(dto, user);
  }

  // Declared before PATCH ':id' so the literal path isn't captured as an id.
  @Patch('bulk-verify-identity')
  @AuditMeta('BULK_VERIFY_DRIVER_IDENTITY', 'DriverProfile')
  @RequirePermissions(Permission.DRIVERS_UPDATE)
  @ApiOperation({ summary: 'Stamp identity verification on multiple drivers' })
  bulkVerifyIdentity(
    @Body() dto: BulkVerifyIdentityDto,
    @CurrentUser() user: RequestUserContext,
  ) {
    return this.driversService.bulkVerifyIdentity(dto.driverIds, user);
  }

  @Patch(':id')
  @AuditMeta('UPDATE_DRIVER', 'DriverProfile', 'driverProfile')
  @RequirePermissions(Permission.DRIVERS_UPDATE)
  @ApiOperation({ summary: 'Update driver profile or personnel status' })
  update(@Param('id') id: string, @Body() dto: UpdateDriverDto) {
    return this.driversService.update(id, dto);
  }

  @Post(':id/reset-password')
  @Header('Cache-Control', 'no-store')
  @AuditMeta('RESET_DRIVER_PASSWORD', 'DriverProfile')
  @RequirePermissions(Permission.DRIVERS_REGISTER)
  @ApiOperation({
    summary: "Issue a new temporary password for the driver's account (shown once)",
  })
  resetPassword(
    @Param('id') id: string,
    @CurrentUser() user: RequestUserContext,
  ) {
    return this.driversService.resetPassword(id, user);
  }

  @Patch(':id/verify-identity')
  @AuditMeta('VERIFY_DRIVER_IDENTITY', 'DriverProfile', 'driverProfile')
  @RequirePermissions(Permission.DRIVERS_UPDATE)
  @ApiOperation({ summary: 'Stamp driver identity as verified by officer' })
  verifyIdentity(
    @Param('id') id: string,
    @CurrentUser() user: RequestUserContext,
  ) {
    return this.driversService.verifyIdentity(id, user);
  }
}
