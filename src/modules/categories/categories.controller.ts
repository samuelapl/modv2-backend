import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { AuditMeta } from '../../common/decorators/audit.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/enums/permissions.enum';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@ApiTags('Categories')
@ApiBearerAuth('JWT-auth')
@Controller('categories')
export class CategoriesController {
  constructor(private readonly service: CategoriesService) {}

  @Public()
  @Get('health')
  @ApiOperation({ summary: 'Check Categories module readiness' })
  getHealth() {
    return this.service.getStatus();
  }

  @Get()
  @RequirePermissions(Permission.CATEGORIES_READ)
  @ApiQuery({ name: 'includeInactive', required: false, type: Boolean })
  @ApiOperation({ summary: 'List MoD vehicle categories & prerequisite rules' })
  findAll(@Query('includeInactive') includeInactive?: string) {
    return this.service.findAll(includeInactive === 'true');
  }

  @Post()
  @AuditMeta('CREATE_CATEGORY', 'VehicleCategory', 'vehicleCategory')
  @RequirePermissions(Permission.CATEGORIES_MANAGE)
  @ApiOperation({ summary: 'Create a new MoD vehicle category rule' })
  create(@Body() dto: CreateCategoryDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @AuditMeta('UPDATE_CATEGORY', 'VehicleCategory', 'vehicleCategory')
  @RequirePermissions(Permission.CATEGORIES_MANAGE)
  @ApiOperation({ summary: 'Update a MoD vehicle category or prerequisite' })
  update(@Param('id') id: string, @Body() dto: UpdateCategoryDto) {
    return this.service.update(id, dto);
  }
}
