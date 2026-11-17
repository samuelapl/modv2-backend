import { Body, Controller, Get, Post } from '@nestjs/common';
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
import { EligibilityService } from './eligibility.service';
import { CheckEligibilityDto } from './dto/check-eligibility.dto';
import { ScanQrDto } from './dto/scan-qr.dto';

@ApiTags('Eligibility')
@ApiBearerAuth('JWT-auth')
@SkipAutoAudit()
@Controller('eligibility')
export class EligibilityController {
  constructor(private readonly service: EligibilityService) {}

  @Public()
  @Get('health')
  @ApiOperation({ summary: 'Check Eligibility module readiness' })
  getHealth() {
    return this.service.getStatus();
  }

  @Get('categories')
  @RequireAnyPermission(
    Permission.ELIGIBILITY_CHECK,
    Permission.CREDENTIALS_VERIFY_QR,
    Permission.CATEGORIES_READ,
  )
  @ApiOperation({ summary: 'List active vehicle categories for dispatch checks' })
  getActiveCategories() {
    return this.service.getActiveCategories();
  }

  @Post('check')
  @RequirePermissions(Permission.ELIGIBILITY_CHECK)
  @ApiOperation({ summary: 'Evaluate 7-gate pre-dispatch driver-to-vehicle eligibility (Form 10)' })
  checkEligibility(
    @Body() dto: CheckEligibilityDto,
    @CurrentUser() user: RequestUserContext,
  ) {
    return this.service.checkEligibility(dto, user);
  }

  @Post('scan-qr')
  @RequireAnyPermission(
    Permission.CREDENTIALS_VERIFY_QR,
    Permission.ELIGIBILITY_CHECK,
  )
  @ApiOperation({ summary: 'Verify signed QR payload and real-time checkpoint eligibility' })
  scanQr(
    @Body() dto: ScanQrDto,
    @CurrentUser() user: RequestUserContext,
  ) {
    return this.service.scanQrCheckpoint(dto, user);
  }
}
