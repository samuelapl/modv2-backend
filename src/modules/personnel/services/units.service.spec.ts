import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { UnitsService } from './units.service';
import { PrismaService } from '../../../prisma/prisma.service';

describe('UnitsService', () => {
  let service: UnitsService;
  let prisma: {
    organizationalUnit: { findMany: jest.Mock; findUnique: jest.Mock; create: jest.Mock; update: jest.Mock; delete: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      organizationalUnit: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [UnitsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<UnitsService>(UnitsService);
  });

  it('should create a unit with uppercased code', async () => {
    prisma.organizationalUnit.findUnique.mockResolvedValue(null);
    prisma.organizationalUnit.create.mockResolvedValue({
      id: 'u1',
      code: 'NORTH-01',
      name: 'Northern Logistics',
    });

    const result = await service.create({
      code: 'north-01',
      name: 'Northern Logistics',
    });

    expect(result.code).toBe('NORTH-01');
  });

  it('should reject duplicate unit codes', async () => {
    prisma.organizationalUnit.findUnique.mockResolvedValue({ id: 'u1' });

    await expect(
      service.create({ code: 'LOG-CORPS', name: 'Duplicate' }),
    ).rejects.toThrow(ConflictException);
  });

  describe('edit & delete', () => {
    it('deletes an empty unit', async () => {
      prisma.organizationalUnit.findUnique.mockResolvedValue({
        id: 'u1',
        code: 'OLD-01',
        _count: { drivers: 0, users: 0, subUnits: 0 },
      });
      const res = await service.remove('u1');
      expect(prisma.organizationalUnit.delete).toHaveBeenCalledWith({ where: { id: 'u1' } });
      expect(res).toEqual({ id: 'u1', code: 'OLD-01', deleted: true });
    });

    it('refuses to delete a unit that still has drivers or accounts', async () => {
      prisma.organizationalUnit.findUnique.mockResolvedValue({
        id: 'u1',
        code: 'LOG-CORPS',
        _count: { drivers: 12, users: 3, subUnits: 0 },
      });
      await expect(service.remove('u1')).rejects.toThrow(
        /12 drivers, 3 user accounts/,
      );
      expect(prisma.organizationalUnit.delete).not.toHaveBeenCalled();
    });

    it('refuses to make a unit its own parent', async () => {
      prisma.organizationalUnit.findUnique.mockResolvedValue({ id: 'u1', code: 'A' });
      await expect(service.update('u1', { parentUnitId: 'u1' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('refuses to place a unit under its own sub-unit', async () => {
      // u1 is being moved under u2, but u2's parent is u1.
      prisma.organizationalUnit.findUnique.mockImplementation(({ where }: any) => {
        if (where.id === 'u1') return Promise.resolve({ id: 'u1', code: 'A', parentUnitId: null });
        if (where.id === 'u2') return Promise.resolve({ id: 'u2', parentUnitId: 'u1' });
        return Promise.resolve(null);
      });
      await expect(service.update('u1', { parentUnitId: 'u2' })).rejects.toThrow(
        /own sub-units/,
      );
    });

    it('rejects renaming the code to one that already exists', async () => {
      prisma.organizationalUnit.findUnique.mockImplementation(({ where }: any) =>
        Promise.resolve(where.id ? { id: 'u1', code: 'A' } : { id: 'u9', code: 'B' }),
      );
      await expect(service.update('u1', { code: 'b' })).rejects.toThrow(ConflictException);
    });

    it('can clear the parent to make a unit top-level', async () => {
      prisma.organizationalUnit.findUnique.mockResolvedValue({ id: 'u1', code: 'A' });
      await service.update('u1', { parentUnitId: null });
      expect(prisma.organizationalUnit.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { parentUnitId: null },
      });
    });
  });
});
