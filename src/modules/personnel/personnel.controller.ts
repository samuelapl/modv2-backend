import { Public } from '../../common/decorators/public.decorator';
import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PersonnelService } from './personnel.service';

@ApiTags('Personnel')
@Controller('personnel')
export class PersonnelController {
  constructor(private readonly service: PersonnelService) {}

  @Public()
  @Get('health')
  @ApiOperation({ summary: 'Check Personnel module readiness' })
  getHealth() {
    return this.service.getStatus();
  }
}
