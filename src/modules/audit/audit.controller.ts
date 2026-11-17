import {
  Controller,
  Get,
  Param,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/enums/permissions.enum';
import { AuditService } from './audit.service';
import { QueryAuditDto } from './dto/query-audit.dto';

@ApiTags('Audit')
@ApiBearerAuth('JWT-auth')
@Controller('audit')
export class AuditController {
  constructor(private readonly service: AuditService) {}

  @Public()
  @Get('health')
  @ApiOperation({ summary: 'Check Audit module readiness' })
  getHealth() {
    return this.service.getStatus();
  }

  @Get('facets')
  @RequirePermissions(Permission.AUDIT_VIEW_LOGS)
  @ApiOperation({ summary: 'List distinct audit actions and entity types for filters' })
  getFacets() {
    return this.service.getFacets();
  }

  @Get('export')
  @RequirePermissions(Permission.AUDIT_EXPORT)
  @ApiOperation({ summary: 'Download filtered immutable audit logs as formula-safe CSV' })
  async exportCsv(@Query() query: QueryAuditDto, @Res() res: Response) {
    const csv = await this.service.exportCsv(query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="idlms-audit-logs.csv"',
    );
    res.send(csv);
  }

  @Get('logs')
  @RequirePermissions(Permission.AUDIT_VIEW_LOGS)
  @ApiOperation({ summary: 'Query paginated tamper-evident audit logs' })
  findAll(@Query() query: QueryAuditDto) {
    return this.service.findAll(query);
  }

  @Get('logs/:id')
  @RequirePermissions(Permission.AUDIT_VIEW_LOGS)
  @ApiOperation({ summary: 'Inspect single audit entry with before/after JSON diff' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }
}
