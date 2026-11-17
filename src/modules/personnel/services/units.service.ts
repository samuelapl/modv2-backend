import { Injectable } from '@nestjs/common';
import {
  AppBadRequestException,
  AppConflictException,
  AppNotFoundException,
} from '../../../common/errors';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateUnitDto } from '../dto/create-unit.dto';
import { UpdateUnitDto } from '../dto/update-unit.dto';

@Injectable()
export class UnitsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.organizationalUnit.findMany({
      orderBy: { code: 'asc' },
      include: {
        parentUnit: { select: { id: true, code: true, name: true } },
        _count: { select: { drivers: true, users: true, subUnits: true } },
      },
    });
  }

  async create(dto: CreateUnitDto) {
    const code = dto.code.trim().toUpperCase();
    const existing = await this.prisma.organizationalUnit.findUnique({
      where: { code },
    });
    if (existing) {
      throw new AppConflictException(
        'UNIT_CODE_EXISTS',
        { code },
        `Organizational unit ${code} already exists.`,
      );
    }
    if (dto.parentUnitId)
      await this.assertExists(dto.parentUnitId, 'Parent unit');

    return this.prisma.organizationalUnit.create({
      data: {
        code,
        name: dto.name.trim(),
        parentUnitId: dto.parentUnitId,
      },
    });
  }

  async update(id: string, dto: UpdateUnitDto) {
    const unit = await this.prisma.organizationalUnit.findUnique({
      where: { id },
    });
    if (!unit) {
      throw new AppNotFoundException(
        'UNIT_NOT_FOUND',
        {},
        'Organizational unit not found.',
      );
    }

    let code: string | undefined;
    if (dto.code !== undefined) {
      code = dto.code.trim().toUpperCase();
      if (code !== unit.code) {
        const clash = await this.prisma.organizationalUnit.findUnique({
          where: { code },
        });
        if (clash) {
          throw new AppConflictException(
            'UNIT_CODE_EXISTS',
            { code },
            `Organizational unit ${code} already exists.`,
          );
        }
      }
    }

    if (dto.parentUnitId) {
      if (dto.parentUnitId === id) {
        throw new AppBadRequestException(
          'UNIT_CANNOT_BE_OWN_PARENT',
          {},
          'A unit cannot be its own parent.',
        );
      }
      await this.assertExists(dto.parentUnitId, 'Parent unit');
      if (await this.isDescendant(dto.parentUnitId, id)) {
        throw new AppBadRequestException(
          'UNIT_CANNOT_MOVE_UNDER_SUBUNIT',
          {},
          'A unit cannot be placed under one of its own sub-units.',
        );
      }
    }

    return this.prisma.organizationalUnit.update({
      where: { id },
      data: {
        ...(code !== undefined ? { code } : {}),
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.parentUnitId !== undefined
          ? { parentUnitId: dto.parentUnitId }
          : {}),
      },
    });
  }

  /**
   * Delete a unit only when nothing depends on it — drivers, user accounts
   * and sub-units must be moved first so no record is left without a unit.
   */
  async remove(id: string) {
    const unit = await this.prisma.organizationalUnit.findUnique({
      where: { id },
      include: {
        _count: { select: { drivers: true, users: true, subUnits: true } },
      },
    });
    if (!unit) {
      throw new AppNotFoundException(
        'UNIT_NOT_FOUND',
        {},
        'Organizational unit not found.',
      );
    }

    const { drivers, users, subUnits } = unit._count;
    if (drivers || users || subUnits) {
      const parts = [
        drivers && `${drivers} driver${drivers === 1 ? '' : 's'}`,
        users && `${users} user account${users === 1 ? '' : 's'}`,
        subUnits && `${subUnits} sub-unit${subUnits === 1 ? '' : 's'}`,
      ].filter(Boolean);
      throw new AppConflictException(
        'UNIT_HAS_DEPENDENTS',
        { code: unit.code, drivers, users, subUnits },
        `Cannot delete ${unit.code}: it still has ${parts.join(', ')}. Move them to another unit first.`,
      );
    }

    await this.prisma.organizationalUnit.delete({ where: { id } });
    return { id, code: unit.code, deleted: true };
  }

  private async assertExists(id: string, label: string) {
    const found = await this.prisma.organizationalUnit.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!found)
      throw new AppNotFoundException(
        'PARENT_UNIT_NOT_FOUND',
        {},
        `${label} not found.`,
      );
  }

  /** True when `candidateId` sits somewhere below `ancestorId`. */
  private async isDescendant(candidateId: string, ancestorId: string) {
    let current: string | null = candidateId;
    const seen = new Set<string>();
    while (current && !seen.has(current)) {
      if (current === ancestorId) return true;
      seen.add(current);
      const row: { parentUnitId: string | null } | null =
        await this.prisma.organizationalUnit.findUnique({
          where: { id: current },
          select: { parentUnitId: true },
        });
      current = row?.parentUnitId ?? null;
    }
    return false;
  }
}
