import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { SkipAutoAudit } from '../../common/decorators/audit.decorator';
import { Permission } from '../../common/enums/permissions.enum';
import { RequestUserContext } from '../personnel/services/drivers.service';
import { PoliciesService } from './policies.service';
import { UpdatePolicyDto } from './dto/update-policy.dto';

@ApiTags('Policies')
@ApiBearerAuth('JWT-auth')
@Controller('policies')
export class PoliciesController {
  constructor(private readonly service: PoliciesService) {}

  @Get()
  @RequirePermissions(Permission.POLICIES_MANAGE)
  @ApiOperation({ summary: 'List all policies with their current values' })
  list() {
    return this.service.list();
  }

  @Patch(':key')
  @SkipAutoAudit() // the service writes a before/after audit entry itself
  @RequirePermissions(Permission.POLICIES_MANAGE)
  @ApiOperation({ summary: 'Change a policy value' })
  update(
    @Param('key') key: string,
    @Body() dto: UpdatePolicyDto,
    @CurrentUser() user: RequestUserContext,
  ) {
    return this.service.update(key, dto.value, user.id);
  }
}
