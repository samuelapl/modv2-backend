import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";

import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Public } from "../../common/decorators/public.decorator";
import { AuditMeta } from "../../common/decorators/audit.decorator";
import {
  RequireAnyPermission,
  RequirePermissions,
} from "../../common/decorators/permissions.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { MakerCheckerGuard } from "../../common/guards/maker-checker.guard";
import { Permission } from "../../common/enums/permissions.enum";
import { RequestUserContext } from "../personnel/services/drivers.service";
import { ApplicationsService } from "./applications.service";
import { CreateApplicationDto } from "./dto/create-application.dto";
import { SubmitApplicationDto } from "./dto/submit-application.dto";
import { QueryApplicationsDto } from "./dto/query-applications.dto";
import { ScreenApplicationDto } from "./dto/screen-application.dto";
import { ApproveApplicationDto } from "./dto/approve-application.dto";
import {
  BulkDecideApplicationsDto,
  CreatePreTrainedApplicationDto,
  DeclarePermitDto,
  VerifyDeclarationDto,
} from "./dto/prior-permit.dto";

@ApiTags("Applications")
@ApiBearerAuth("JWT-auth")
@Controller("applications")
export class ApplicationsController {
  constructor(private readonly service: ApplicationsService) {}

  @Public()
  @Get("health")
  @ApiOperation({ summary: "Check Applications module readiness" })
  getHealth() {
    return this.service.getStatus();
  }

  @Get()
  @RequireAnyPermission(
    Permission.APPLICATIONS_VIEW_ALL,
    Permission.APPLICATIONS_VIEW_OWN,
    Permission.APPLICATIONS_SCREEN,
    Permission.APPLICATIONS_APPROVE,
  )
  @ApiOperation({ summary: "List authorization applications scoped by PBAC" })
  findAll(
    @Query() query: QueryApplicationsDto,
    @CurrentUser() user: RequestUserContext,
  ) {
    return this.service.findAll(query, user);
  }

  @Get("additional-category-eligibility/:driverProfileId")
  @RequirePermissions(Permission.APPLICATIONS_CREATE)
  @ApiOperation({
    summary: "Driver's current permit and whether new categories can be added",
  })
  getAdditionalCategoryEligibility(
    @Param("driverProfileId") driverProfileId: string,
    @CurrentUser() user: RequestUserContext,
  ) {
    return this.service.getAdditionalCategoryEligibility(driverProfileId, user);
  }

  @Get("replacement-eligibility/:driverProfileId")
  @RequirePermissions(Permission.APPLICATIONS_CREATE)
  @ApiOperation({
    summary: "Driver's current permit and whether its card can be replaced",
  })
  getReplacementEligibility(
    @Param("driverProfileId") driverProfileId: string,
    @CurrentUser() user: RequestUserContext,
  ) {
    return this.service.getReplacementEligibility(driverProfileId, user);
  }

  @Get("renewal-eligibility/:driverProfileId")
  @RequirePermissions(Permission.APPLICATIONS_CREATE)
  @ApiOperation({
    summary:
      "Driver's current permit and its renewal window (5 months before to 5 months after expiry)",
  })
  getRenewalEligibility(
    @Param("driverProfileId") driverProfileId: string,
    @CurrentUser() user: RequestUserContext,
  ) {
    return this.service.getRenewalEligibility(driverProfileId, user);
  }

  @Get(":id")
  @RequireAnyPermission(
    Permission.APPLICATIONS_VIEW_ALL,
    Permission.APPLICATIONS_VIEW_OWN,
    Permission.APPLICATIONS_SCREEN,
    Permission.APPLICATIONS_APPROVE,
  )
  @ApiOperation({ summary: "Get application dossier and approval timeline" })
  findOne(@Param("id") id: string, @CurrentUser() user: RequestUserContext) {
    return this.service.findOne(id, user);
  }

  @Post()
  @AuditMeta("CREATE_APPLICATION", "Application", "application")
  @RequirePermissions(Permission.APPLICATIONS_CREATE)
  @ApiOperation({ summary: "Create/submit Form 3 authorization application" })
  create(
    @Body() dto: CreateApplicationDto,
    @CurrentUser() user: RequestUserContext,
  ) {
    return this.service.create(dto, user);
  }

  @Patch(":id/submit")
  @AuditMeta("SUBMIT_APPLICATION", "Application", "application")
  @RequirePermissions(Permission.APPLICATIONS_CREATE)
  @ApiOperation({ summary: "Submit draft or resubmit returned application" })
  submit(
    @Param("id") id: string,
    @Body() dto: SubmitApplicationDto,
    @CurrentUser() user: RequestUserContext,
  ) {
    return this.service.submit(id, dto, user);
  }

  @Patch(":id/screen")
  @AuditMeta("SCREEN_APPLICATION", "Application", "application")
  @RequirePermissions(Permission.APPLICATIONS_SCREEN)
  @ApiOperation({ summary: "Screen application and advance pipeline stage" })
  screen(
    @Param("id") id: string,
    @Body() dto: ScreenApplicationDto,
    @CurrentUser() user: RequestUserContext,
  ) {
    return this.service.screen(id, dto, user);
  }

  @Patch(":id/decision")
  @AuditMeta("DECIDE_APPLICATION", "Application", "application")
  @UseGuards(MakerCheckerGuard)
  @RequirePermissions(Permission.APPLICATIONS_APPROVE)
  @ApiOperation({ summary: "Final Maker-Checker command decision" })
  decide(
    @Param("id") id: string,
    @Body() dto: ApproveApplicationDto,
    @CurrentUser() user: RequestUserContext,
  ) {
    return this.service.decide(id, dto, user);
  }

  @Post("pre-trained")
  @AuditMeta("CREATE_PRE_TRAINED_APPLICATION", "Application", "application")
  @RequirePermissions(Permission.APPLICATIONS_CREATE)
  @ApiOperation({
    summary:
      "Record an existing permit for an already-registered, already-trained driver (goes straight to command approval)",
  })
  createPreTrained(
    @Body() dto: CreatePreTrainedApplicationDto,
    @CurrentUser() user: RequestUserContext,
  ) {
    return this.service.createPreTrained(dto, user);
  }

  @Post("declare-permit")
  @AuditMeta("DECLARE_EXISTING_PERMIT", "Application", "application")
  @RequirePermissions(Permission.APPLICATIONS_CREATE)
  @ApiOperation({
    summary:
      "Driver declares a permit held before this system (own profile; scan required). Nothing is authorized until an officer verifies it.",
  })
  declarePermit(
    @Body() dto: DeclarePermitDto,
    @CurrentUser() user: RequestUserContext,
  ) {
    return this.service.declarePermit(dto, user);
  }

  @Patch(":id/verify-declaration")
  @AuditMeta("VERIFY_PERMIT_DECLARATION", "Application", "application")
  @RequirePermissions(Permission.APPLICATIONS_SCREEN)
  @ApiOperation({
    summary:
      "Officer approves (to command approval) or returns a driver's permit declaration with a reason",
  })
  verifyDeclaration(
    @Param("id") id: string,
    @Body() dto: VerifyDeclarationDto,
    @CurrentUser() user: RequestUserContext,
  ) {
    return this.service.verifyDeclaration(id, dto, user);
  }

  @Patch("bulk-approve")
  @AuditMeta("BULK_APPROVE_APPLICATIONS", "Application")
  @RequirePermissions(Permission.APPLICATIONS_APPROVE)
  @ApiOperation({
    summary:
      "Approve many READY_FOR_APPROVAL applications at once (maker-checker enforced per application)",
  })
  bulkApprove(
    @Body() dto: BulkDecideApplicationsDto,
    @CurrentUser() user: RequestUserContext,
  ) {
    return this.service.bulkApprove(dto, user);
  }
}
