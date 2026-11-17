import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { AuditMeta, SkipAutoAudit } from '../../common/decorators/audit.decorator';
import {
  RequireAnyPermission,
  RequirePermissions,
} from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { QueryPendingIssuanceDto } from './dto/query-pending-issuance.dto';
import { Permission } from '../../common/enums/permissions.enum';
import { RequestUserContext } from '../personnel/services/drivers.service';
import { CredentialsService } from './credentials.service';
import { IssueCredentialDto } from './dto/issue-credential.dto';
import { BulkIssueCredentialsDto } from './dto/bulk-issue-credentials.dto';
import { QueryCredentialsDto } from './dto/query-credentials.dto';
import { VerifyQrDto } from './dto/verify-qr.dto';

@ApiTags('Credentials')
@ApiBearerAuth('JWT-auth')
@Controller('credentials')
export class CredentialsController {
  constructor(private readonly service: CredentialsService) {}

  @Public()
  @Get('health')
  @ApiOperation({ summary: 'Check Credentials module readiness' })
  getHealth() {
    return this.service.getStatus();
  }

  @Get('stats')
  @RequireAnyPermission(
    Permission.CREDENTIALS_ISSUE,
    Permission.CREDENTIALS_VERIFY_QR,
    Permission.APPLICATIONS_VIEW_ALL,
  )
  @ApiOperation({ summary: 'Credential issuance and registry summary' })
  getStats() {
    return this.service.getStats();
  }

  @Get('pending')
  @RequireAnyPermission(
    Permission.CREDENTIALS_ISSUE,
    Permission.APPLICATIONS_VIEW_ALL,
  )
  @ApiOperation({ summary: 'List APPROVED applications awaiting credential issuance' })
  findPendingIssuance(@Query() query: QueryPendingIssuanceDto) {
    return this.service.findPendingIssuance(query);
  }

  @Get()
  @RequireAnyPermission(
    Permission.CREDENTIALS_ISSUE,
    Permission.CREDENTIALS_VERIFY_QR,
    Permission.DRIVERS_VIEW_ALL,
    Permission.CREDENTIALS_VIEW_OWN,
  )
  @ApiOperation({ summary: 'List issued MoD credentials scoped by PBAC' })
  findAll(
    @Query() query: QueryCredentialsDto,
    @CurrentUser() user: RequestUserContext,
  ) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @RequireAnyPermission(
    Permission.CREDENTIALS_ISSUE,
    Permission.CREDENTIALS_VERIFY_QR,
    Permission.DRIVERS_VIEW_ALL,
    Permission.CREDENTIALS_VIEW_OWN,
  )
  @ApiOperation({ summary: 'Get issued credential and signed QR Data URL' })
  findOne(
    @Param('id') id: string,
    @CurrentUser() user: RequestUserContext,
  ) {
    return this.service.findOne(id, user);
  }

  @Post(':id/print')
  @SkipAutoAudit()
  @RequirePermissions(Permission.CREDENTIALS_ISSUE)
  @ApiOperation({ summary: 'Record official one-time print of driving credential & audit trail' })
  recordPrint(
    @Param('id') id: string,
    @CurrentUser() user: RequestUserContext,
  ) {
    return this.service.recordPrint(id, user);
  }

  @Post('issue')
  @SkipAutoAudit()
  @RequirePermissions(Permission.CREDENTIALS_ISSUE)
  @ApiOperation({ summary: 'Issue active MoD driving credential & signed QR (Form 7)' })
  issue(
    @Body() dto: IssueCredentialDto,
    @CurrentUser() user: RequestUserContext,
  ) {
    return this.service.issueFromApplication(dto, user);
  }

  @Post('bulk-issue')
  @AuditMeta('BULK_ISSUE_CREDENTIALS', 'IssuedCredential')
  @RequirePermissions(Permission.CREDENTIALS_ISSUE)
  @ApiOperation({ summary: 'Issue permits for multiple approved applications' })
  bulkIssue(
    @Body() dto: BulkIssueCredentialsDto,
    @CurrentUser() user: RequestUserContext,
  ) {
    return this.service.bulkIssue(dto.applicationIds, user);
  }

  @Post('verify-qr')
  @AuditMeta('VERIFY_QR_CREDENTIAL', 'IssuedCredential')
  @RequireAnyPermission(
    Permission.CREDENTIALS_VERIFY_QR,
    Permission.CREDENTIALS_ISSUE,
  )
  @ApiOperation({ summary: 'Verify cryptographic HMAC QR payload and DB status' })
  verifyQr(@Body() dto: VerifyQrDto) {
    return this.service.verifyQrToken(dto.token);
  }
}
