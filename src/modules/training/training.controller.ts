import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import {
  AuditMeta,
  SkipAutoAudit,
} from '../../common/decorators/audit.decorator';
import {
  RequireAnyPermission,
  RequirePermissions,
} from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permission } from '../../common/enums/permissions.enum';
import { RequestUserContext } from '../personnel/services/drivers.service';
import { TrainingService } from './training.service';
import { CreateCourseDto } from './dto/create-course.dto';
import { UpdateCourseDto } from './dto/update-course.dto';
import { CreateEnrollmentDto } from './dto/create-enrollment.dto';
import { LogAttendanceDto } from './dto/log-attendance.dto';
import { QueryEnrollmentsDto } from './dto/query-enrollments.dto';
import { QueryWaitingDto } from './dto/query-waiting.dto';
import { CreateBatchDto } from './dto/create-batch.dto';
import { BulkLogAttendanceDto } from './dto/bulk-log-attendance.dto';

@ApiTags('Training')
@ApiBearerAuth('JWT-auth')
@Controller('training')
export class TrainingController {
  constructor(private readonly service: TrainingService) {}

  @Public()
  @Get('health')
  @ApiOperation({ summary: 'Check Training module readiness' })
  getHealth() {
    return this.service.getStatus();
  }

  @Get('courses')
  @RequireAnyPermission(
    Permission.TRAINING_MANAGE_COURSES,
    Permission.TRAINING_LOG_ATTENDANCE,
    Permission.TRAINING_VIEW_OWN,
    Permission.CATEGORIES_READ,
  )
  @ApiQuery({ name: 'categoryCode', required: false })
  @ApiOperation({ summary: 'List MoD driver training courses' })
  findAllCourses(@Query('categoryCode') categoryCode?: string) {
    return this.service.findAllCourses(categoryCode);
  }

  @Post('courses')
  @AuditMeta('CREATE_TRAINING_COURSE', 'TrainingCourse', 'trainingCourse')
  @RequirePermissions(Permission.TRAINING_MANAGE_COURSES)
  @ApiOperation({ summary: 'Create a new MoD training course' })
  createCourse(@Body() dto: CreateCourseDto) {
    return this.service.createCourse(dto);
  }

  @Patch('courses/:id')
  @AuditMeta('UPDATE_TRAINING_COURSE', 'TrainingCourse', 'trainingCourse')
  @RequirePermissions(Permission.TRAINING_MANAGE_COURSES)
  @ApiOperation({ summary: 'Update a MoD training course' })
  updateCourse(@Param('id') id: string, @Body() dto: UpdateCourseDto) {
    return this.service.updateCourse(id, dto);
  }

  @Delete('courses/:id')
  @AuditMeta('DELETE_TRAINING_COURSE', 'TrainingCourse', 'trainingCourse')
  @RequirePermissions(Permission.TRAINING_MANAGE_COURSES)
  @ApiOperation({
    summary: 'Delete a MoD training course that has no training history',
  })
  deleteCourse(@Param('id') id: string) {
    return this.service.deleteCourse(id);
  }

  @Get('enrollments')
  @RequireAnyPermission(
    Permission.TRAINING_MANAGE_COURSES,
    Permission.TRAINING_LOG_ATTENDANCE,
    Permission.TRAINING_VIEW_OWN,
    Permission.APPLICATIONS_VIEW_ALL,
  )
  @ApiOperation({ summary: 'List training enrollments scoped by PBAC' })
  findAllEnrollments(
    @Query() query: QueryEnrollmentsDto,
    @CurrentUser() user: RequestUserContext,
  ) {
    return this.service.findAllEnrollments(query, user);
  }

  @Post('enrollments')
  @AuditMeta('ENROLL_TRAINING_CANDIDATE', 'TrainingEnrollment', 'trainingEnrollment')
  @RequirePermissions(Permission.TRAINING_MANAGE_COURSES)
  @ApiOperation({ summary: 'Enroll a candidate into a MoD training course' })
  enrollCandidate(@Body() dto: CreateEnrollmentDto) {
    return this.service.enrollCandidate(dto);
  }

  @Get('instructors')
  @RequirePermissions(Permission.TRAINING_MANAGE_COURSES)
  @ApiOperation({ summary: 'List active practical trainers (Instructor role)' })
  findInstructors() {
    return this.service.findInstructors();
  }

  @Get('waiting')
  @RequireAnyPermission(
    Permission.TRAINING_MANAGE_COURSES,
    Permission.TRAINING_LOG_ATTENDANCE,
  )
  @ApiOperation({
    summary: 'People waiting to be enrolled in a training batch',
  })
  findWaiting(@Query() query: QueryWaitingDto) {
    return this.service.findWaiting(query);
  }

  @Get('candidates')
  @RequirePermissions(Permission.TRAINING_MANAGE_COURSES)
  @ApiQuery({ name: 'categoryCode', required: true })
  @ApiOperation({
    summary: 'TRAINING_PENDING applications awaiting enrollment for a category',
  })
  findCandidates(@Query('categoryCode') categoryCode: string) {
    return this.service.findCandidates(categoryCode || '');
  }

  @Get('batches/next-code')
  @RequirePermissions(Permission.TRAINING_MANAGE_COURSES)
  @ApiOperation({ summary: 'Preview the next auto-generated batch code' })
  getNextBatchCode() {
    return this.service.getNextBatchCode();
  }

  @Get('batches')
  @RequireAnyPermission(
    Permission.TRAINING_MANAGE_COURSES,
    Permission.TRAINING_LOG_ATTENDANCE,
    Permission.EXAMS_MANAGE_SCHEDULES,
    Permission.EXAMS_GRADE_LOCKED,
    Permission.MEDICAL_RECORD_FIT,
    Permission.MEDICAL_VIEW_OUTCOME,
    Permission.CREDENTIALS_ISSUE,
    Permission.APPLICATIONS_VIEW_ALL,
  )
  @ApiOperation({ summary: 'List training batches with category sessions' })
  findAllBatches() {
    return this.service.findAllBatches();
  }

  @Post('batches')
  @AuditMeta('CREATE_TRAINING_BATCH', 'TrainingBatch', 'trainingBatch')
  @RequirePermissions(Permission.TRAINING_MANAGE_COURSES)
  @ApiOperation({
    summary: 'Create a training batch and enroll candidates per category',
  })
  createBatch(
    @Body() dto: CreateBatchDto,
    @CurrentUser() user: RequestUserContext,
  ) {
    return this.service.createBatch(dto, user);
  }

  @Patch('enrollments/bulk-attendance')
  @SkipAutoAudit()
  @RequirePermissions(Permission.TRAINING_LOG_ATTENDANCE)
  @ApiOperation({
    summary:
      'Log attendance hours for many trainees at once (rules enforced per trainee)',
  })
  bulkLogAttendance(
    @Body() dto: BulkLogAttendanceDto,
    @CurrentUser() user: RequestUserContext,
  ) {
    return this.service.bulkLogAttendance(dto, user);
  }

  @Patch('enrollments/:id/attendance')
  @AuditMeta('LOG_TRAINING_ATTENDANCE', 'TrainingEnrollment', 'trainingEnrollment')
  @RequirePermissions(Permission.TRAINING_LOG_ATTENDANCE)
  @ApiOperation({ summary: 'Log training attendance hours and completion status' })
  logAttendance(
    @Param('id') id: string,
    @Body() dto: LogAttendanceDto,
    @CurrentUser() user: RequestUserContext,
  ) {
    return this.service.logAttendance(id, dto, user);
  }
}
