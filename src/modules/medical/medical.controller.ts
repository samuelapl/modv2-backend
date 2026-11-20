import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { AuditMeta } from '../../common/decorators/audit.decorator';
import {
  RequireAnyPermission,
  RequirePermissions,
} from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permission } from '../../common/enums/permissions.enum';
import { RequestUserContext } from '../personnel/services/drivers.service';
import { MedicalService } from './medical.service';
import { VoidMedicalReviewDto } from './dto/void-medical-review.dto';
import { RecordMedicalReviewDto } from './dto/record-medical-review.dto';
import { QueryMedicalDto } from './dto/query-medical.dto';
import { QueryMedicalCandidatesDto } from './dto/query-medical-candidates.dto';

@ApiTags('Medical')
@ApiBearerAuth('JWT-auth')
@Controller('medical')
export class MedicalController {
  constructor(private readonly service: MedicalService) {}

  @Public()
  @Get('health')
  @ApiOperation({ summary: 'Check Medical module readiness' })
  getHealth() {
    return this.service.getStatus();
  }

  @Get('stats')
  @RequireAnyPermission(
    Permission.MEDICAL_RECORD_FIT,
    Permission.MEDICAL_VIEW_OUTCOME,
  )
  @ApiOperation({ summary: 'Medical clearance workload summary' })
  getStats() {
    return this.service.getStats();
  }

  @Get('candidates')
  @RequireAnyPermission(
    Permission.MEDICAL_RECORD_FIT,
    Permission.MEDICAL_VIEW_OUTCOME,
  )
  @ApiOperation({ summary: 'List MEDICAL_PENDING applications awaiting medical clearance' })
  findPendingCandidates(@Query() query: QueryMedicalCandidatesDto) {
    return this.service.findPendingCandidates(query);
  }

  @Get()
  @RequireAnyPermission(
    Permission.MEDICAL_RECORD_FIT,
    Permission.MEDICAL_VIEW_OUTCOME,
    Permission.APPLICATIONS_VIEW_OWN,
  )
  @ApiOperation({ summary: 'List privacy-guarded medical fitness reviews scoped by PBAC' })
  findAll(
    @Query() query: QueryMedicalDto,
    @CurrentUser() user: RequestUserContext,
  ) {
    return this.service.findAll(query, user);
  }

  @Post(':id/void')
  @AuditMeta('VOID_MEDICAL_REVIEW', 'MedicalFitnessReview', 'medicalFitnessReview')
  @RequirePermissions(Permission.MEDICAL_RECORD_FIT)
  @ApiOperation({ summary: 'Void a medical review recorded by mistake (kept for audit)' })
  voidReview(
    @Param('id') id: string,
    @Body() dto: VoidMedicalReviewDto,
    @CurrentUser() user: RequestUserContext,
  ) {
    return this.service.voidReview(id, dto, user);
  }

  @Post()
  @AuditMeta('RECORD_MEDICAL_REVIEW', 'MedicalFitnessReview', 'medicalFitnessReview')
  @RequirePermissions(Permission.MEDICAL_RECORD_FIT)
  @ApiOperation({ summary: 'Record fitness outcome and operational restrictions (Form 6)' })
  recordReview(
    @Body() dto: RecordMedicalReviewDto,
    @CurrentUser() user: RequestUserContext,
  ) {
    return this.service.recordReview(dto, user);
  }
}
