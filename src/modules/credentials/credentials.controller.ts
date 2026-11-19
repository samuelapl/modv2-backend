import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
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
import { ReprintOverrideDto } from './dto/reprint-override.dto';
import { CardPrintService } from './card/card-print.service';
import { CardReprintService } from './card/card-reprint.service';

@ApiTags('Credentials')
@ApiBearerAuth('JWT-auth')
@Controller('credentials')
export class CredentialsController {
  constructor(
    private readonly service: CredentialsService,
    private readonly cardPrint: CardPrintService,
    private readonly cardReprint: CardReprintService,
  ) {}

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

  @Get('readiness/:driverProfileId')
  @RequirePermissions(Permission.CREDENTIALS_ISSUE)
  @ApiOperation({ summary: 'Which statutory card fields are still missing for a driver' })
  getIssuanceReadiness(@Param('driverProfileId') driverProfileId: string) {
    return this.service.getIssuanceReadiness(driverProfileId);
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

  /**
   * Generates the CR80 front+back PDF and, in the same step, takes the
   * one-time print lock. Answers with raw PDF bytes (not the JSON envelope).
   */
  @Post(':id/print')
  @SkipAutoAudit()
  @RequirePermissions(Permission.CREDENTIALS_PRINT)
  @ApiOperation({ summary: 'Generate the one-time printable CR80 PVC card (PDF, front + back)' })
  async printCard(
    @Param('id') id: string,
    @CurrentUser() user: RequestUserContext,
    @Res() res: Response,
  ) {
    const { pdf, filename } = await this.cardPrint.printCard(id, user);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
      'Content-Length': String(pdf.length),
      'Cache-Control': 'no-store',
    });
    res.end(pdf);
  }

  @Post(':id/reprint-override')
  @SkipAutoAudit()
  @RequirePermissions(Permission.CREDENTIALS_REPRINT_OVERRIDE)
  @ApiOperation({ summary: 'Supervisor override: replace card serial/QR and allow one more print' })
  reprintOverride(
    @Param('id') id: string,
    @Body() dto: ReprintOverrideDto,
    @CurrentUser() user: RequestUserContext,
  ) {
    return this.cardReprint.authorizeReprint(id, dto.reasonCode, dto.note, user);
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
