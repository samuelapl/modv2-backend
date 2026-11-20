import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { PoliciesService } from './policies.service';
import { AppBadRequestException, AppNotFoundException } from '../../common/errors';

describe('PoliciesService', () => {
  let service: PoliciesService;

  const mockPrisma: any = {
    policy: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PoliciesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<PoliciesService>(PoliciesService);
  });

  describe('list', () => {
    it('returns default value when nothing is stored in database', async () => {
      mockPrisma.policy.findMany.mockResolvedValue([]);
      const list = await service.list();
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({
        key: 'training.minAttendancePercent',
        defaultValue: 100,
        value: 100,
        isDefault: true,
      });
    });

    it('returns stored value when present in database', async () => {
      mockPrisma.policy.findMany.mockResolvedValue([
        {
          key: 'training.minAttendancePercent',
          value: 80,
          updatedAt: new Date('2026-11-20'),
          updatedById: 'user-1',
        },
      ]);
      const list = await service.list();
      expect(list[0]).toMatchObject({
        key: 'training.minAttendancePercent',
        defaultValue: 100,
        value: 80,
        isDefault: false,
        updatedById: 'user-1',
      });
    });
  });

  describe('getNumber', () => {
    it('returns stored number value', async () => {
      mockPrisma.policy.findUnique.mockResolvedValue({
        key: 'training.minAttendancePercent',
        value: 75,
      });
      const val = await service.getNumber('training.minAttendancePercent');
      expect(val).toBe(75);
    });

    it('falls back to default if no row stored', async () => {
      mockPrisma.policy.findUnique.mockResolvedValue(null);
      const val = await service.getNumber('training.minAttendancePercent');
      expect(val).toBe(100);
    });

    it('throws AppNotFoundException for unknown policy key', async () => {
      await expect(service.getNumber('unknown.policy')).rejects.toThrow(
        AppNotFoundException,
      );
    });
  });

  describe('update', () => {
    it('validates integer range and writes before/after audit log', async () => {
      mockPrisma.policy.findUnique.mockResolvedValue({
        key: 'training.minAttendancePercent',
        value: 100,
      });
      const updatedAt = new Date();
      mockPrisma.policy.upsert.mockResolvedValue({
        key: 'training.minAttendancePercent',
        value: 80,
        updatedAt,
      });

      const res = await service.update(
        'training.minAttendancePercent',
        80,
        'admin-1',
      );
      expect(res).toEqual({
        key: 'training.minAttendancePercent',
        value: 80,
        updatedAt,
      });

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          userId: 'admin-1',
          action: 'UPDATE_POLICY',
          entityType: 'Policy',
          entityId: 'training.minAttendancePercent',
          oldValue: { value: 100 },
          newValue: { value: 80 },
        },
      });
    });

    it('rejects values below min or above max with AppBadRequestException', async () => {
      await expect(
        service.update('training.minAttendancePercent', 0, 'admin-1'),
      ).rejects.toThrow(AppBadRequestException);

      await expect(
        service.update('training.minAttendancePercent', 101, 'admin-1'),
      ).rejects.toThrow(AppBadRequestException);
    });

    it('rejects non-integer values', async () => {
      await expect(
        service.update('training.minAttendancePercent', 85.5, 'admin-1'),
      ).rejects.toThrow(AppBadRequestException);
    });

    it('rejects unknown policy key', async () => {
      await expect(
        service.update('unknown.policy', 50, 'admin-1'),
      ).rejects.toThrow(AppNotFoundException);
    });
  });
});
