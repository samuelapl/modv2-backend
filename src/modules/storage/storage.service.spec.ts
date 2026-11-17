import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StorageService } from './storage.service';

describe('StorageService', () => {
  let service: StorageService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorageService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((_key: string, defaultValue: any) => defaultValue),
          },
        },
      ],
    }).compile();

    service = module.get<StorageService>(StorageService);
  });

  it('should be defined and report required buckets', () => {
    const status = service.getStatus();
    expect(status.status).toBe('READY');
    expect(status.buckets).toContain('driver-photos');
    expect(status.buckets).toContain('national-licenses');
  });

  it('should reject unsupported MIME types', async () => {
    const badFile = {
      originalname: 'script.exe',
      mimetype: 'application/x-msdownload',
      size: 1024,
      buffer: Buffer.from('abc'),
    } as Express.Multer.File;

    await expect(service.uploadFile('driver-photos', badFile)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('should reject files exceeding 5 MB', async () => {
    const largeFile = {
      originalname: 'huge.jpg',
      mimetype: 'image/jpeg',
      size: 6 * 1024 * 1024,
      buffer: Buffer.alloc(10),
    } as Express.Multer.File;

    await expect(service.uploadFile('driver-photos', largeFile)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('should upload valid image and return signed URL', async () => {
    const mockClient = {
      putObject: jest.fn().mockResolvedValue({ etag: '123' }),
      presignedGetObject: jest.fn().mockResolvedValue('http://localhost:9004/driver-photos/test.jpg'),
    };
    (service as any).minioClient = mockClient;

    const validFile = {
      originalname: 'portrait.jpg',
      mimetype: 'image/jpeg',
      size: 1024,
      buffer: Buffer.from('fake-jpeg'),
    } as Express.Multer.File;

    const result = await service.uploadFile('driver-photos', validFile);

    expect(mockClient.putObject).toHaveBeenCalled();
    expect(result.bucket).toBe('driver-photos');
    expect(result.objectKey).toMatch(/\.jpg$/);
    expect(result.url).toContain('http://localhost:9004');
  });
});
