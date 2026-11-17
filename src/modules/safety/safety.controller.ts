import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { SkipAutoAudit } from '../../common/decorators/audit.decorator';
import {
  RequireAnyPermission,
  RequirePermissions,
} from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permission } from '../../common/enums/permissions.enum';
import { RequestUserContext } from '../personnel/services/drivers.service';
import { SafetyService } from './safety.service';
import { CreateIncidentDto } from './dto/create-incident.dto';
import { InvestigateIncidentDto } from './dto/investigate-incident.dto';
import { CreateSuspensionDto } from './dto/create-suspension.dto';
import { QuerySafetyDto } from './dto/query-safety.dto';
import { RevokePermitDto } from './dto/revoke-permit.dto';

@ApiTags('Safety')
@ApiBearerAuth('JWT-auth')
@SkipAutoAudit()
@Controller('safety')
export class SafetyController {
  constructor(private readonly service: SafetyService) {}

  @Public()
  @Get('health')
  @ApiOperation({ summary: 'Check Safety module readiness' })
  getHealth() {
    return this.service.getStatus();
  }

  @Get('stats')
  @RequireAnyPermission(
    Permission.SAFETY_REPORT_INCIDENT,
    Permission.SAFETY_INVESTIGATE,
    Permission.SAFETY_SUSPEND,
    Permission.SAFETY_REINSTATE,
    Permission.DRIVERS_VIEW_ALL,
  )
  @ApiOperation({ summary: 'Safety workload summary scoped by PBAC' })
  getStats(@CurrentUser() user: RequestUserContext) {
    return this.service.getStats(user);
  }

  @Get('incidents')
  @RequireAnyPermission(
    Permission.SAFETY_REPORT_INCIDENT,
    Permission.SAFETY_INVESTIGATE,
    Permission.SAFETY_SUSPEND,
    Permission.SAFETY_REINSTATE,
    Permission.DRIVERS_VIEW_ALL,
  )
  @ApiOperation({ summary: 'List incident reports scoped by PBAC' })
  findIncidents(
    @Query() query: QuerySafetyDto,
    @CurrentUser() user: RequestUserContext,
  ) {
    return this.service.findIncidents(query, user);
  }

  @Post('incidents')
  @RequirePermissions(Permission.SAFETY_REPORT_INCIDENT)
  @ApiOperation({ summary: 'Report safety incident or accident (Form 9)' })
  reportIncident(
    @Body() dto: CreateIncidentDto,
    @CurrentUser() user: RequestUserContext,
  ) {
    return this.service.reportIncident(dto, user);
  }

  @Patch('incidents/:id')
  @RequirePermissions(Permission.SAFETY_INVESTIGATE)
  @ApiOperation({ summary: 'Update investigation findings & remedial task status' })
  investigateIncident(
    @Param('id') id: string,
    @Body() dto: InvestigateIncidentDto,
    @CurrentUser() user: RequestUserContext,
  ) {
    return this.service.investigateIncident(id, dto, user);
  }

  @Get('suspensions')
  @RequireAnyPermission(
    Permission.SAFETY_REPORT_INCIDENT,
    Permission.SAFETY_INVESTIGATE,
    Permission.SAFETY_SUSPEND,
    Permission.SAFETY_REINSTATE,
    Permission.DRIVERS_VIEW_ALL,
  )
  @ApiOperation({ summary: 'List disciplinary suspension records scoped by PBAC' })
  findSuspensions(
    @Query() query: QuerySafetyDto,
    @CurrentUser() user: RequestUserContext,
  ) {
    return this.service.findSuspensions(query, user);
  }

  @Post('suspensions')
  @RequirePermissions(Permission.SAFETY_SUSPEND)
  @ApiOperation({ summary: 'Impose suspension & lock active QR credentials immediately' })
  imposeSuspension(
    @Body() dto: CreateSuspensionDto,
    @CurrentUser() user: RequestUserContext,
  ) {
    return this.service.imposeSuspension(dto, user);
  }

  @Post('suspensions/:id/reinstate')
  @RequirePermissions(Permission.SAFETY_REINSTATE)
  @ApiOperation({ summary: 'Reinstate driver & restore active credentials (Workflow 4)' })
  reinstateDriver(
    @Param('id') id: string,
    @CurrentUser() user: RequestUserContext,
  ) {
    return this.service.reinstateDriver(id, user);
  }

  @Get('revocations')
  @RequireAnyPermission(
    Permission.SAFETY_INVESTIGATE,
    Permission.SAFETY_SUSPEND,
    Permission.SAFETY_REINSTATE,
    Permission.DRIVERS_VIEW_ALL,
  )
  @ApiOperation({ summary: 'List permanently revoked permits' })
  findRevocations(
    @Query() query: QuerySafetyDto,
    @CurrentUser() user: RequestUserContext,
  ) {
    return this.service.findRevocations(query, user);
  }

  @Get('revocations/preview/:driverProfileId')
  @RequirePermissions(Permission.SAFETY_SUSPEND)
  @ApiOperation({ summary: 'Permits and suspension a revocation would affect' })
  previewRevocation(@Param('driverProfileId') driverProfileId: string) {
    return this.service.previewRevocation(driverProfileId);
  }

  @Post('revocations')
  @RequirePermissions(Permission.SAFETY_SUSPEND)
  @ApiOperation({ summary: "Permanently revoke a driver's permits" })
  revokePermit(
    @Body() dto: RevokePermitDto,
    @CurrentUser() user: RequestUserContext,
  ) {
    return this.service.revokePermit(dto, user);
  }
}
