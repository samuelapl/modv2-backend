import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/enums/permissions.enum';
import { ReportsService } from './reports.service';
import { QueryReportsDto } from './dto/query-reports.dto';

@ApiTags('Reports')
@ApiBearerAuth('JWT-auth')
@Controller('reports')
export class ReportsController {
  constructor(private readonly service: ReportsService) {}

  @Public()
  @Get('health')
  @ApiOperation({ summary: 'Check Reports module readiness' })
  getHealth() {
    return this.service.getStatus();
  }

  @Get('executive-kpis')
  @RequirePermissions(Permission.REPORTS_VIEW)
  @ApiOperation({ summary: 'Retrieve live MoD executive KPIs and unit readiness' })
  getExecutiveKpis(@Query() query: QueryReportsDto) {
    return this.service.getExecutiveKpis(query);
  }

  @Get('category-distribution')
  @RequirePermissions(Permission.REPORTS_VIEW)
  @ApiOperation({ summary: 'Retrieve active credential endorsement distribution by vehicle class' })
  getCategoryDistribution(@Query() query: QueryReportsDto) {
    return this.service.getCategoryDistribution(query);
  }

  @Get('applications-trend')
  @RequirePermissions(Permission.REPORTS_VIEW)
  @ApiOperation({ summary: 'Monthly count of submitted applications, split by application type' })
  getApplicationsTrend(@Query() query: QueryReportsDto) {
    return this.service.getApplicationsTrend(query);
  }

  @Get('expiring-permits')
  @RequirePermissions(Permission.REPORTS_VIEW)
  @ApiOperation({ summary: 'List soon-to-expire active MoD permits ordered by urgency' })
  getExpiringPermits(@Query() query: QueryReportsDto) {
    return this.service.getExpiringPermits(query);
  }
}
