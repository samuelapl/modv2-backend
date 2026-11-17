import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsString } from 'class-validator';

export const ALLOWED_BUCKETS = [
  'driver-photos',
  'national-licenses',
  'medical-documents',
  'certificates',
] as const;

export type AllowedBucket = (typeof ALLOWED_BUCKETS)[number];

export class UploadQueryDto {
  @ApiProperty({ enum: ALLOWED_BUCKETS, example: 'driver-photos' })
  @IsIn(ALLOWED_BUCKETS)
  bucket: AllowedBucket;
}

export class PresignedUrlQueryDto {
  @ApiProperty({ enum: ALLOWED_BUCKETS, example: 'driver-photos' })
  @IsIn(ALLOWED_BUCKETS)
  bucket: AllowedBucket;

  @ApiProperty({ example: '17312345-uuid.jpg' })
  @IsString()
  @IsNotEmpty()
  objectKey: string;
}

export class UploadResponseDto {
  @ApiProperty()
  bucket: string;

  @ApiProperty()
  objectKey: string;

  @ApiProperty()
  url: string;

  @ApiProperty()
  mimeType: string;

  @ApiProperty()
  size: number;
}
