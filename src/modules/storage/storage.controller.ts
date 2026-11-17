import {
  Controller,
  Get,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
  ApiOkResponse,
} from '@nestjs/swagger';
import { StorageService } from './storage.service';
import {
  UploadQueryDto,
  PresignedUrlQueryDto,
  UploadResponseDto,
} from './dto/storage.dto';
import { Public } from '../../common/decorators/public.decorator';
import { AuditMeta } from '../../common/decorators/audit.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/enums/permissions.enum';

@ApiTags('Storage')
@ApiBearerAuth('JWT-auth')
@Controller('storage')
export class StorageController {
  constructor(private readonly storageService: StorageService) {}

  @Public()
  @Get('health')
  @ApiOperation({ summary: 'Check Storage module readiness' })
  getHealth() {
    return this.storageService.getStatus();
  }

  @Post('upload')
  @AuditMeta('UPLOAD_STORAGE_EVIDENCE', 'StorageObject')
  @RequirePermissions(Permission.STORAGE_UPLOAD)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiOkResponse({ type: UploadResponseDto })
  @ApiOperation({ summary: 'Upload photo or PDF evidence directly to MinIO bucket' })
  uploadFile(
    @Query() query: UploadQueryDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.storageService.uploadFile(query.bucket, file);
  }

  @Get('presigned-url')
  @RequirePermissions(Permission.STORAGE_DOWNLOAD)
  @ApiOperation({ summary: 'Generate temporary signed download URL for MinIO object' })
  async getPresignedUrl(@Query() query: PresignedUrlQueryDto) {
    const url = await this.storageService.getPresignedUrl(
      query.bucket,
      query.objectKey,
    );
    return { url };
  }
}
