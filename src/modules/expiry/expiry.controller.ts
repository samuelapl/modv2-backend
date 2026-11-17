import { Controller, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { RequirePermissions } from "../../common/decorators/permissions.decorator";
import { Permission } from "../../common/enums/permissions.enum";
import { ExpiryService } from "./expiry.service";

@ApiTags("System")
@ApiBearerAuth("JWT-auth")
@Controller("system/expiry")
export class ExpiryController {
  constructor(private readonly service: ExpiryService) {}

  @Post("run")
  @RequirePermissions(Permission.SYSTEM_CONFIGURE)
  @ApiOperation({
    summary: "Run the expiry sweep now (normally runs nightly at 00:05 EAT)",
  })
  runNow() {
    return this.service.runExpirySweep("manual");
  }
}
