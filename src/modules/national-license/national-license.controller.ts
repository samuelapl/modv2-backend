import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { NationalLicenseService } from './national-license.service';
import { RecordLicenseDto } from './dto/record-license.dto';
import { VerifyLicenseDto } from './dto/verify-license.dto';
import { QueryLicensesDto } from './dto/query-licenses.dto';
import { Public } from '../../common/decorators/public.decorator';
import { AuditMeta } from '../../common/decorators/audit.decorator';
import {
  RequirePermissions,
  RequireAnyPermission,
} from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permission } from '../../common/enums/permissions.enum';
import { RequestUserContext } from '../personnel/services/drivers.service';

@ApiTags('NationalLicense')
@ApiBearerAuth('JWT-auth')
@Controller('national-license')
export class NationalLicenseController {
  constructor(private readonly service: NationalLicenseService) {}

  @Public()
  @Get('health')
  @ApiOperation({ summary: 'Check NationalLicense module readiness' })
  getHealth() {
    return this.service.getStatus();
  }

  @Get('stats')
  @RequireAnyPermission(
    Permission.NATIONAL_DL_VERIFY,
    Permission.DRIVERS_VIEW_ALL,
    Permission.DRIVERS_VIEW_UNIT,
    Permission.DRIVERS_VIEW_OWN,
  )
  @ApiOperation({ summary: 'National licence verification summary' })
  getStats(@CurrentUser() user: RequestUserContext) {
    return this.service.getStats(user);
  }

  @Get()
  @RequireAnyPermission(
    Permission.NATIONAL_DL_VERIFY,
    Permission.DRIVERS_VIEW_ALL,
    Permission.DRIVERS_VIEW_UNIT,
    Permission.DRIVERS_VIEW_OWN,
  )
  @ApiOperation({ summary: 'List national driving licenses scoped by PBAC' })
  findAll(
    @Query() query: QueryLicensesDto,
    @CurrentUser() user: RequestUserContext,
  ) {
    return this.service.findAll(query, user);
  }

  @Get('driver/:driverId')
  @RequireAnyPermission(
    Permission.NATIONAL_DL_VERIFY,
    Permission.DRIVERS_VIEW_ALL,
    Permission.DRIVERS_VIEW_UNIT,
    Permission.DRIVERS_VIEW_OWN,
  )
  @ApiOperation({ summary: 'Get national driving license for a specific driver' })
  findByDriverId(
    @Param('driverId') driverId: string,
    @CurrentUser() user: RequestUserContext,
  ) {
    return this.service.findByDriverId(driverId, user);
  }

  @Post()
  @AuditMeta('UPSERT_NATIONAL_LICENSE', 'NationalLicense', 'nationalLicense')
  @RequirePermissions(Permission.NATIONAL_DL_SUBMIT)
  @ApiOperation({ summary: 'Record or update driver national license (Form 2)' })
  upsert(
    @Body() dto: RecordLicenseDto,
    @CurrentUser() user: RequestUserContext,
  ) {
    return this.service.upsertForDriver(dto, user);
  }

  @Patch(':id/verify')
  @AuditMeta('VERIFY_NATIONAL_LICENSE', 'NationalLicense', 'nationalLicense')
  @RequirePermissions(Permission.NATIONAL_DL_VERIFY)
  @ApiOperation({ summary: 'Verify, reject, or mark expired a national license' })
  verify(
    @Param('id') id: string,
    @Body() dto: VerifyLicenseDto,
    @CurrentUser() user: RequestUserContext,
  ) {
    return this.service.verifyLicense(id, dto, user);
  }
}
