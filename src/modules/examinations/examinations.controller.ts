import {
  Body,
  Controller,
  Get,
  Post,
  Query,
} from '@nestjs/common';
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
import { ExaminationsService } from './examinations.service';
import { RecordExamResultDto } from './dto/record-exam-result.dto';
import { QueryExaminationsDto } from './dto/query-examinations.dto';
import { QueryExamCandidatesDto } from './dto/query-exam-candidates.dto';

@ApiTags('Examinations')
@ApiBearerAuth('JWT-auth')
@Controller('examinations')
export class ExaminationsController {
  constructor(private readonly service: ExaminationsService) {}

  @Public()
  @Get('health')
  @ApiOperation({ summary: 'Check Examinations module readiness' })
  getHealth() {
    return this.service.getStatus();
  }

  @Get('stats')
  @RequireAnyPermission(
    Permission.EXAMS_MANAGE_SCHEDULES,
    Permission.EXAMS_GRADE_LOCKED,
    Permission.APPLICATIONS_VIEW_ALL,
  )
  @ApiOperation({ summary: 'Examination workload and pass-rate summary' })
  getStats() {
    return this.service.getStats();
  }

  @Get('candidates')
  @RequireAnyPermission(
    Permission.EXAMS_MANAGE_SCHEDULES,
    Permission.EXAMS_GRADE_LOCKED,
  )
  @ApiOperation({ summary: 'List EXAM_PENDING applications awaiting assessment' })
  findPendingCandidates(@Query() query: QueryExamCandidatesDto) {
    return this.service.findPendingCandidates(query);
  }

  @Get()
  @RequireAnyPermission(
    Permission.EXAMS_MANAGE_SCHEDULES,
    Permission.EXAMS_GRADE_LOCKED,
    Permission.APPLICATIONS_VIEW_ALL,
    Permission.APPLICATIONS_VIEW_OWN,
  )
  @ApiOperation({ summary: 'List immutable examination records scoped by PBAC' })
  findAll(
    @Query() query: QueryExaminationsDto,
    @CurrentUser() user: RequestUserContext,
  ) {
    return this.service.findAll(query, user);
  }

  @Post()
  @AuditMeta('RECORD_EXAM_RESULT', 'ExaminationRecord', 'examinationRecord')
  @RequirePermissions(Permission.EXAMS_GRADE_LOCKED)
  @ApiOperation({ summary: 'Record and lock theoretical or practical exam score' })
  recordResult(
    @Body() dto: RecordExamResultDto,
    @CurrentUser() user: RequestUserContext,
  ) {
    return this.service.recordResult(dto, user);
  }
}
