import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from './audit.service';

describe('AuditService', () => {
  let service: AuditService;
  const prismaMock = {
    auditLog: {
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditService,
        {
          provide: PrismaService,
          useValue: prismaMock,
        },
      ],
    }).compile();

    service = module.get<AuditService>(AuditService);
  });

  it('returns paginated audit logs filtered by action and entityType', async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([
      {
        id: 'log-1',
        action: 'IMPOSE_SUSPENSION',
        entityType: 'SuspensionRecord',
        entityId: 'susp-1',
        timestamp: new Date('2026-11-10T12:00:00Z'),
      },
    ]);
    prismaMock.auditLog.count.mockResolvedValue(1);

    const res = await service.findAll({
      page: 1,
      limit: 10,
      action: 'IMPOSE_SUSPENSION',
      entityType: 'SuspensionRecord',
    });

    expect(res.total).toBe(1);
    expect(res.items[0].action).toBe('IMPOSE_SUSPENSION');
    expect(prismaMock.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          action: 'IMPOSE_SUSPENSION',
          entityType: 'SuspensionRecord',
        }),
      }),
    );
  });

  it('derives changedFields between oldValue and newValue and throws 404 when missing', async () => {
    prismaMock.auditLog.findUnique.mockResolvedValueOnce(null);
    await expect(service.findOne('missing-id')).rejects.toThrow(NotFoundException);

    prismaMock.auditLog.findUnique.mockResolvedValueOnce({
      id: 'log-2',
      action: 'SCREEN_APPLICATION',
      entityType: 'Application',
      entityId: 'app-1',
      oldValue: { status: 'SUBMITTED', currentStage: 'SCREENING' },
      newValue: { status: 'TRAINING_PENDING', currentStage: 'TRAINING' },
      timestamp: new Date('2026-11-10T12:00:00Z'),
    });

    const detail = await service.findOne('log-2');
    expect(detail.changedFields).toEqual(['currentStage', 'status']);
  });

  it('neutralizes CSV formula-injection characters when exporting CSV', async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([
      {
        id: 'log-3',
        timestamp: new Date('2026-11-10T12:00:00Z'),
        action: '=CMD|calc',
        entityType: 'DriverProfile',
        entityId: '+malicious',
        ipAddress: '10.0.0.1',
        oldValue: null,
        newValue: { note: 'safe' },
        user: { serviceNumber: 'MOD-AUDIT-001', roles: ['AUDITOR'] },
      },
    ]);

    const csv = await service.exportCsv({});
    expect(csv).toContain(`"'=CMD|calc"`);
    expect(csv).toContain(`"'+malicious"`);
  });
});
