import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { CategoriesService } from './categories.service';

describe('CategoriesService', () => {
  let service: CategoriesService;
  const mockPrisma = {
    vehicleCategory: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CategoriesService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();

    service = module.get<CategoriesService>(CategoriesService);
  });

  it('returns active vehicle categories sorted cleanly', async () => {
    mockPrisma.vehicleCategory.findMany.mockResolvedValue([
      { id: 'cat-1', code: 'CAT-LV', name: 'Light Vehicle' },
    ]);

    const result = await service.findAll(false);
    expect(result).toHaveLength(1);
    expect(mockPrisma.vehicleCategory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true } }),
    );
  });

  it('rejects duplicate category code with 409 Conflict', async () => {
    mockPrisma.vehicleCategory.findUnique.mockResolvedValue({
      id: 'cat-1',
      code: 'CAT-LV',
    });

    await expect(
      service.create({ code: 'cat-lv', name: 'Duplicate LV' }),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects non-existent prerequisite category on create', async () => {
    mockPrisma.vehicleCategory.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    await expect(
      service.create({
        code: 'CAT-XH',
        name: 'Extra Heavy',
        prerequisiteCatId: 'missing-id',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('prevents self-referencing or circular prerequisites on update', async () => {
    mockPrisma.vehicleCategory.findUnique.mockResolvedValue({
      id: 'cat-hv',
      code: 'CAT-HV',
    });

    await expect(
      service.update('cat-hv', { prerequisiteCatId: 'cat-hv' }),
    ).rejects.toThrow(BadRequestException);

    // Cycle: cat-hv -> cat-mv -> cat-hv
    mockPrisma.vehicleCategory.findUnique
      .mockResolvedValueOnce({ id: 'cat-hv', prerequisiteCatId: null })
      .mockResolvedValueOnce({ id: 'cat-mv', prerequisiteCatId: 'cat-hv' });

    await expect(
      service.update('cat-hv', { prerequisiteCatId: 'cat-mv' }),
    ).rejects.toThrow(BadRequestException);
  });
});
