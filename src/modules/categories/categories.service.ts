import {
  Injectable,
} from '@nestjs/common';
import {
  AppBadRequestException,
  AppConflictException,
  AppNotFoundException,
} from '../../common/errors';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  getStatus() {
    return {
      module: 'categories',
      description: 'MoD Vehicle Categories & Prerequisite Rules',
      status: 'READY',
    };
  }

  async findAll(includeInactive = false) {
    return this.prisma.vehicleCategory.findMany({
      where: includeInactive ? undefined : { isActive: true },
      include: {
        prerequisite: {
          select: { id: true, code: true, name: true },
        },
        _count: {
          select: { applications: true, subsequentCats: true },
        },
      },
      orderBy: [{ minAgeRequired: 'asc' }, { code: 'asc' }],
    });
  }

  async create(dto: CreateCategoryDto) {
    const code = dto.code.trim().toUpperCase();
    const existing = await this.prisma.vehicleCategory.findUnique({
      where: { code },
    });
    if (existing) {
      throw new AppConflictException(
        'CATEGORY_CODE_ALREADY_EXISTS',
        { code },
        `Vehicle category code ${code} already exists.`,
      );
    }

    if (dto.prerequisiteCatId) {
      const prereq = await this.prisma.vehicleCategory.findUnique({
        where: { id: dto.prerequisiteCatId },
      });
      if (!prereq) {
        throw new AppNotFoundException(
          'CATEGORY_PREREQUISITE_NOT_FOUND',
          {},
          'Prerequisite vehicle category not found.',
        );
      }
    }

    return this.prisma.vehicleCategory.create({
      data: {
        code,
        name: dto.name.trim(),
        description: dto.description?.trim(),
        minAgeRequired: dto.minAgeRequired ?? 18,
        validityYears: dto.validityYears ?? 3,
        prerequisiteCatId: dto.prerequisiteCatId ?? null,
        requiresNationalLicense: dto.requiresNationalLicense ?? false,
        requiresMedical: dto.requiresMedical ?? true,
      },
      include: {
        prerequisite: { select: { id: true, code: true, name: true } },
      },
    });
  }

  async update(id: string, dto: UpdateCategoryDto) {
    const category = await this.prisma.vehicleCategory.findUnique({
      where: { id },
    });
    if (!category) {
      throw new AppNotFoundException(
        'CATEGORY_NOT_FOUND',
        {},
        'Vehicle category not found.',
      );
    }

    if (dto.prerequisiteCatId !== undefined && dto.prerequisiteCatId !== null) {
      await this.assertValidPrerequisite(id, dto.prerequisiteCatId);
    }

    return this.prisma.vehicleCategory.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description.trim() }
          : {}),
        ...(dto.minAgeRequired !== undefined
          ? { minAgeRequired: dto.minAgeRequired }
          : {}),
        ...(dto.validityYears !== undefined
          ? { validityYears: dto.validityYears }
          : {}),
        ...(dto.prerequisiteCatId !== undefined
          ? { prerequisiteCatId: dto.prerequisiteCatId }
          : {}),
        ...(dto.requiresNationalLicense !== undefined
          ? { requiresNationalLicense: dto.requiresNationalLicense }
          : {}),
        ...(dto.requiresMedical !== undefined
          ? { requiresMedical: dto.requiresMedical }
          : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
      include: {
        prerequisite: { select: { id: true, code: true, name: true } },
      },
    });
  }

  private async assertValidPrerequisite(categoryId: string, prereqId: string) {
    if (categoryId === prereqId) {
      throw new AppBadRequestException(
        'CATEGORY_PREREQUISITE_SELF_REFERENCE',
        {},
        'A vehicle category cannot reference itself as a prerequisite.',
      );
    }

    let cursorId: string | null = prereqId;
    const visited = new Set<string>([categoryId]);

    while (cursorId) {
      if (visited.has(cursorId)) {
        throw new AppBadRequestException(
          'CATEGORY_PREREQUISITE_CIRCULAR',
          {},
          'Circular prerequisite dependency detected between categories.',
        );
      }
      visited.add(cursorId);

      const node: { id: string; prerequisiteCatId: string | null } | null =
        await this.prisma.vehicleCategory.findUnique({
          where: { id: cursorId },
          select: { id: true, prerequisiteCatId: true },
        });
      if (!node) {
        throw new AppNotFoundException(
          'CATEGORY_PREREQUISITE_NOT_FOUND',
          {},
          'Prerequisite vehicle category not found.',
        );
      }
      cursorId = node.prerequisiteCatId;
    }
  }
}
