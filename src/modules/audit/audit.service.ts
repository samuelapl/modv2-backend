import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/paginated-result.dto';
import { computeChangedFields } from '../../common/utils/audit-sanitizer';
import { QueryAuditDto } from './dto/query-audit.dto';
import { AppNotFoundException } from '../../common/errors';

const AUDIT_INCLUDE = {
  user: {
    select: {
      id: true,
      serviceNumber: true,
      email: true,
      roles: true,
    },
  },
};

function sanitizeCsvCell(raw: unknown): string {
  const str = raw === null || raw === undefined ? '' : String(raw);
  const formulaSafe = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
  return `"${formulaSafe.replace(/"/g, '""')}"`;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  getStatus() {
    return {
      module: 'audit',
      description: 'Immutable Tamper-Evident Audit Logging',
      status: 'READY',
    };
  }

  private buildWhere(query: QueryAuditDto) {
    const where: any = {};

    if (query.action) where.action = query.action;
    if (query.entityType) where.entityType = query.entityType;
    if (query.entityId) where.entityId = query.entityId;
    if (query.userId) where.userId = query.userId;

    if (query.fromDate || query.toDate) {
      where.timestamp = {};
      if (query.fromDate) where.timestamp.gte = new Date(query.fromDate);
      if (query.toDate) {
        const end = new Date(query.toDate);
        if (query.toDate.length <= 10) {
          end.setUTCHours(23, 59, 59, 999);
        }
        where.timestamp.lte = end;
      }
    }

    if (query.search) {
      where.OR = [
        { action: { contains: query.search, mode: 'insensitive' } },
        { entityType: { contains: query.search, mode: 'insensitive' } },
        { entityId: { contains: query.search, mode: 'insensitive' } },
        { ipAddress: { contains: query.search, mode: 'insensitive' } },
        {
          user: {
            serviceNumber: { contains: query.search, mode: 'insensitive' },
          },
        },
      ];
    }

    return where;
  }

  async findAll(query: QueryAuditDto) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;
    const where = this.buildWhere(query);

    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        include: AUDIT_INCLUDE,
        orderBy: { timestamp: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return new PaginatedResult(items, total, page, limit);
  }

  async getFacets() {
    const [actionsRows, entityRows] = await Promise.all([
      this.prisma.auditLog.findMany({
        distinct: ['action'],
        select: { action: true },
        orderBy: { action: 'asc' },
      }),
      this.prisma.auditLog.findMany({
        distinct: ['entityType'],
        select: { entityType: true },
        orderBy: { entityType: 'asc' },
      }),
    ]);

    return {
      actions: actionsRows.map((r) => r.action),
      entityTypes: entityRows.map((r) => r.entityType),
    };
  }

  async findOne(id: string) {
    const log = await this.prisma.auditLog.findUnique({
      where: { id },
      include: AUDIT_INCLUDE,
    });

    if (!log) {
      throw new AppNotFoundException(
      'AUDIT_LOG_NOT_FOUND', {}, 'Audit log record not found.');
    }

    return {
      ...log,
      changedFields: computeChangedFields(log.oldValue, log.newValue),
    };
  }

  async exportCsv(query: QueryAuditDto): Promise<string> {
    const where = this.buildWhere(query);
    const rows = await this.prisma.auditLog.findMany({
      where,
      include: AUDIT_INCLUDE,
      orderBy: { timestamp: 'desc' },
      take: 2000,
    });

    const header = [
      'Timestamp',
      'ActorServiceNumber',
      'ActorRoles',
      'Action',
      'EntityType',
      'EntityId',
      'IpAddress',
      'ChangedFields',
      'BeforeSnapshot',
      'AfterSnapshot',
    ].join(',');

    const lines = rows.map((row) => {
      const changed = computeChangedFields(row.oldValue, row.newValue).join(';');
      return [
        sanitizeCsvCell(row.timestamp.toISOString()),
        sanitizeCsvCell(row.user?.serviceNumber || 'SYSTEM'),
        sanitizeCsvCell((row.user?.roles || []).join(';')),
        sanitizeCsvCell(row.action),
        sanitizeCsvCell(row.entityType),
        sanitizeCsvCell(row.entityId),
        sanitizeCsvCell(row.ipAddress || ''),
        sanitizeCsvCell(changed),
        sanitizeCsvCell(row.oldValue ? JSON.stringify(row.oldValue) : ''),
        sanitizeCsvCell(row.newValue ? JSON.stringify(row.newValue) : ''),
      ].join(',');
    });

    return [header, ...lines].join('\r\n');
  }
}
