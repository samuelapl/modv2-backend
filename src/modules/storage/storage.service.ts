import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Minio from 'minio';
import { randomUUID } from 'crypto';
import * as path from 'path';
import {
  ALLOWED_BUCKETS,
  AllowedBucket,
  UploadResponseDto,
} from './dto/storage.dto';
import { AppBadRequestException } from '../../common/errors';

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

@Injectable()
export class StorageService implements OnModuleInit {
  private minioClient: Minio.Client;
  private readonly logger = new Logger(StorageService.name);

  constructor(private readonly configService: ConfigService) {
    const endPoint = this.configService.get<string>('MINIO_ENDPOINT', 'localhost');
    const port = Number(this.configService.get<number>('MINIO_PORT', 9004));
    const useSSL =
      this.configService.get<string>('MINIO_USE_SSL', 'false') === 'true';
    const accessKey = this.configService.get<string>('MINIO_ACCESS_KEY', 'minio_admin');
    const secretKey = this.configService.get<string>(
      'MINIO_SECRET_KEY',
      'minio_admin_secret_2026',
    );

    this.minioClient = new Minio.Client({
      endPoint,
      port,
      useSSL,
      accessKey,
      secretKey,
    });
  }

  async onModuleInit() {
    await this.ensureBucketsExist();
  }

  async ensureBucketsExist() {
    for (const bucket of ALLOWED_BUCKETS) {
      try {
        const exists = await this.minioClient.bucketExists(bucket);
        if (!exists) {
          await this.minioClient.makeBucket(bucket);
          this.logger.log(`Created MinIO bucket: ${bucket}`);
        }
      } catch (error) {
        this.logger.warn(`MinIO bucket check warning for ${bucket}: ${error.message}`);
      }
    }
  }

  async uploadFile(
    bucket: AllowedBucket,
    file: Express.Multer.File,
  ): Promise<UploadResponseDto> {
    if (!file) {
      throw new AppBadRequestException(
      'STORAGE_NO_FILE', {}, 'No file uploaded.');
    }

    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      throw new AppBadRequestException(
      'STORAGE_UNSUPPORTED_TYPE', { mimeType: file.mimetype }, 
        `Unsupported file type: ${file.mimetype}. Allowed: JPEG, PNG, WEBP, PDF.`,
      );
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      throw new AppBadRequestException(
      'STORAGE_FILE_TOO_LARGE', {}, 'File size exceeds maximum limit of 5 MB.');
    }

    const ext = path.extname(file.originalname) || '.bin';
    const objectKey = `${Date.now()}-${randomUUID()}${ext}`;

    await this.minioClient.putObject(bucket, objectKey, file.buffer, file.size, {
      'Content-Type': file.mimetype,
    });

    const url = await this.getPresignedUrl(bucket, objectKey);

    return {
      bucket,
      objectKey,
      url,
      mimeType: file.mimetype,
      size: file.size,
    };
  }

  async getPresignedUrl(
    bucket: AllowedBucket,
    objectKey: string,
    expirySeconds = 3600,
  ): Promise<string> {
    return this.minioClient.presignedGetObject(bucket, objectKey, expirySeconds);
  }

  getStatus() {
    return {
      module: 'storage',
      description: 'MinIO S3 Document & Evidence Storage',
      buckets: [...ALLOWED_BUCKETS],
      status: 'READY',
    };
  }
}
