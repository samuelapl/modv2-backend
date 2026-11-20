import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AppBadRequestException, AppNotFoundException } from '../../common/errors';
import {
  findPolicyDefinition,
  NumberPolicyDefinition,
  POLICY_DEFINITIONS,
} from './policy.definitions';

@Injectable()
export class PoliciesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Every policy with its current value (the default when nobody changed it). */
  async list() {
    const rows = await this.prisma.policy.findMany();
    const byKey = new Map(rows.map((r) => [r.key, r]));
    return POLICY_DEFINITIONS.map((def) => {
      const row = byKey.get(def.key);
      return {
        key: def.key,
        group: def.group,
        type: def.type,
        min: def.min,
        max: def.max,
        unit: 'unit' in def ? def.unit : undefined,
        defaultValue: def.default,
        value: row ? (row.value as number) : def.default,
        isDefault: !row,
        updatedAt: row?.updatedAt ?? null,
        updatedById: row?.updatedById ?? null,
      };
    });
  }

  /** Current value of a number policy; falls back to the default. */
  async getNumber(key: string): Promise<number> {
    const def = this.definitionOrThrow(key);
    const row = await this.prisma.policy.findUnique({ where: { key } });
    const value = row?.value;
    return typeof value === 'number' && Number.isFinite(value) ? value : def.default;
  }

  async update(key: string, raw: unknown, actorId: string) {
    const def = this.definitionOrThrow(key);
    const value = this.validateNumber(def, raw);

    const previous = await this.getNumber(key);
    const saved = await this.prisma.policy.upsert({
      where: { key },
      create: { key, value, updatedById: actorId },
      update: { value, updatedById: actorId },
    });

    // Policy changes affect everyone, so they are always audited (before/after).
    await this.prisma.auditLog.create({
      data: {
        userId: actorId,
        action: 'UPDATE_POLICY',
        entityType: 'Policy',
        entityId: key,
        oldValue: { value: previous },
        newValue: { value },
      },
    });

    return { key, value: saved.value as number, updatedAt: saved.updatedAt };
  }

  private definitionOrThrow(key: string): NumberPolicyDefinition {
    const def = findPolicyDefinition(key);
    if (!def) {
      throw new AppNotFoundException('POLICY_NOT_FOUND', { key }, `Unknown policy: ${key}.`);
    }
    return def;
  }

  private validateNumber(def: NumberPolicyDefinition, raw: unknown): number {
    const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
    if (
      typeof n !== 'number' ||
      !Number.isFinite(n) ||
      (def.integer && !Number.isInteger(n)) ||
      n < def.min ||
      n > def.max
    ) {
      throw new AppBadRequestException(
        'POLICY_VALUE_INVALID',
        { key: def.key, min: def.min, max: def.max },
        `${def.key} must be a whole number between ${def.min} and ${def.max}.`,
      );
    }
    return n;
  }
}
