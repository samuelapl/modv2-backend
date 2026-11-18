import {
  Controller,
  Get,
  Patch,
  Post,
  Body,
  Req,
  HttpCode,
  HttpStatus,
  UseGuards,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiOkResponse,
} from "@nestjs/swagger";
import { Request } from "express";
import { AuthService } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
import {
  LoginResponseDto,
  AuthenticatedUserDto,
} from "./dto/auth-response.dto";
import { ChangePasswordDto } from "./dto/change-password.dto";
import { UpdatePreferencesDto } from "./dto/update-preferences.dto";
import { UpdateProfileDto } from "./dto/update-profile.dto";
import { Public } from "../../common/decorators/public.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { AuditMeta } from "../../common/decorators/audit.decorator";
import { AllowWhenPasswordChangeRequired } from "../../common/decorators/allow-password-change.decorator";
import { LoginRateLimitGuard } from "../../common/guards/login-rate-limit.guard";

@ApiTags("Auth")
@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Get("health")
  @ApiOperation({ summary: "Check Auth module readiness" })
  getHealth() {
    return this.authService.getStatus();
  }

  @Public()
  @UseGuards(LoginRateLimitGuard)
  @AuditMeta("USER_LOGIN", "User")
  @Post("login")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Authenticate MoD staff member with Service Number & Password",
  })
  @ApiOkResponse({ type: LoginResponseDto })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @AllowWhenPasswordChangeRequired()
  @AuditMeta("USER_LOGOUT", "User")
  @Post("logout")
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({ summary: "Invalidate current JWT token in Redis blacklist" })
  logout(@Req() req: Request) {
    const authHeader = req.headers.authorization;
    const token = authHeader?.replace("Bearer ", "").trim() || "";
    return this.authService.logout(token);
  }

  @AllowWhenPasswordChangeRequired()
  @Get("me")
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary: "Retrieve authenticated user profile & resolved permissions",
  })
  @ApiOkResponse({ type: AuthenticatedUserDto })
  getMe(@CurrentUser("id") userId: string) {
    return this.authService.getProfile(userId);
  }

  @AllowWhenPasswordChangeRequired()
  @AuditMeta("CHANGE_PASSWORD", "User")
  @Post("change-password")
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary:
      "Change own password (required after an admin-issued temporary password). Signs the user out: log in again with the new password.",
  })
  changePassword(
    @CurrentUser("id") userId: string,
    @Body() dto: ChangePasswordDto,
    @Req() req: Request,
  ) {
    const token =
      req.headers.authorization?.replace("Bearer ", "").trim() || "";
    return this.authService.changePassword(userId, dto, token);
  }

  @Patch("me/preferences")
  @AuditMeta("UPDATE_USER_PREFERENCES", "User")
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({ summary: "Save the signed-in user's interface language" })
  updatePreferences(
    @CurrentUser("id") userId: string,
    @Body() dto: UpdatePreferencesDto,
  ) {
    return this.authService.updatePreferences(userId, dto);
  }

  @Patch("me/profile")
  @AuditMeta("UPDATE_USER_PROFILE", "User", "user")
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({ summary: "Update own contact information (phone, email)" })
  @ApiOkResponse({ type: AuthenticatedUserDto })
  updateProfile(
    @CurrentUser("id") userId: string,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.authService.updateProfile(userId, dto);
  }
}
