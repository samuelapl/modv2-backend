import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { Observable, from } from 'rxjs';
import { mergeMap } from 'rxjs/operators';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AUDIT_META_KEY,
  AuditMetaOptions,
  AuditPrismaModel,
  SKIP_AUTO_AUDIT_KEY,
} from '../decorators/audit.decorator';
import { sanitizeAuditValue } from '../utils/audit-sanitizer';

const MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const req = context.switchToHttp().getRequest<Request & { user?: any }>();
    const method = (req.method || 'GET').toUpperCase();
    if (!MUTATING_METHODS.has(method)) {
      return next.handle();
    }

    const skipAudit = this.reflector.getAllAndOverride<boolean>(
      SKIP_AUTO_AUDIT_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (skipAudit) {
      return next.handle();
    }

    const meta = this.reflector.getAllAndOverride<AuditMetaOptions | undefined>(
      AUDIT_META_KEY,
      [context.getHandler(), context.getClass()],
    );

    const idParamKey = meta?.idParam || 'id';
    const rawTargetId = req.params?.[idParamKey];

    return from(this.fetchBeforeSnapshot(meta?.prismaModel, rawTargetId)).pipe(
      mergeMap((beforeSnapshot) =>
        next.handle().pipe(
          mergeMap(async (result) => {
            await this.persistAuditLog(
              req,
              method,
              meta,
              rawTargetId,
              beforeSnapshot,
              result,
            );
            return result;
          }),
        ),
      ),
    );
  }

  private async fetchBeforeSnapshot(
    model?: AuditPrismaModel,
    targetId?: string,
  ): Promise<unknown> {
    if (!model || !targetId) return null;

    try {
      switch (model) {
        case 'application':
          return await this.prisma.application.findUnique({ where: { id: targetId } });
        case 'nationalLicense':
          return await this.prisma.nationalLicense.findUnique({
            where: { id: targetId },
          });
        case 'examinationRecord':
          return await this.prisma.examinationRecord.findUnique({
            where: { id: targetId },
          });
        case 'medicalFitnessReview':
          return await this.prisma.medicalFitnessReview.findUnique({
            where: { id: targetId },
          });
        case 'trainingEnrollment':
          return await this.prisma.trainingEnrollment.findUnique({
            where: { id: targetId },
          });
        case 'trainingCourse':
          return await this.prisma.trainingCourse.findUnique({
            where: { id: targetId },
          });
        case 'driverProfile':
          return await this.prisma.driverProfile.findUnique({
            where: { id: targetId },
          });
        case 'user':
          return await this.prisma.user.findUnique({ where: { id: targetId } });
        case 'vehicleCategory':
          return await this.prisma.vehicleCategory.findUnique({
            where: { id: targetId },
          });
        case 'organizationalUnit':
          return await this.prisma.organizationalUnit.findUnique({
            where: { id: targetId },
          });
        case 'rolePermission':
          return await this.prisma.rolePermission.findUnique({
            where: { role: targetId as any },
          });
        default:
          return null;
      }
    } catch {
      return null;
    }
  }

  private async persistAuditLog(
    req: Request & { user?: any },
    method: string,
    meta: AuditMetaOptions | undefined,
    rawTargetId: string | undefined,
    beforeSnapshot: unknown,
    result: unknown,
  ): Promise<void> {
    try {
      const entityType =
        meta?.entityType || this.inferEntityType(req.originalUrl || req.url);
      const action =
        meta?.action || `${method}_${entityType.toUpperCase()}`;

      const rawResultObj =
        result && typeof result === 'object' ? (result as Record<string, any>) : null;
      const resultObj =
        rawResultObj &&
        typeof rawResultObj.success === 'boolean' &&
        'data' in rawResultObj &&
        'timestamp' in rawResultObj &&
        rawResultObj.data &&
        typeof rawResultObj.data === 'object'
          ? (rawResultObj.data as Record<string, any>)
          : rawResultObj;

      const entityId = String(
        rawTargetId ||
          resultObj?.id ||
          resultObj?.user?.id ||
          'SYSTEM',
      );

      const userId: string | null =
        req.user?.id || resultObj?.user?.id || null;

      const forwarded = req.headers['x-forwarded-for'];
      const rawIp =
        (Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0])?.trim() ||
        req.ip ||
        null;
      const ipAddress = rawIp ? rawIp.replace(/^::ffff:/, '') : null;

      const uaHeader = req.headers['user-agent'];
      const userAgent =
        typeof uaHeader === 'string' && uaHeader.trim()
          ? uaHeader.trim().slice(0, 250)
          : null;

      const oldValue = beforeSnapshot
        ? sanitizeAuditValue(beforeSnapshot)
        : undefined;
      const afterSource =
        resultObj && Object.keys(resultObj).length > 0
          ? resultObj
          : req.body && Object.keys(req.body).length > 0
            ? req.body
            : null;
      const newValue = afterSource
        ? sanitizeAuditValue(afterSource)
        : undefined;

      await this.prisma.auditLog.create({
        data: {
          userId,
          action,
          entityType,
          entityId,
          ipAddress,
          userAgent,
          oldValue: oldValue as any,
          newValue: newValue as any,
        },
      });
    } catch (err) {
      this.logger.error(
        `Failed to write AuditLog for ${method} ${req.url}: ${(err as Error).message}`,
      );
    }
  }

  private inferEntityType(url: string): string {
    const clean = url.split('?')[0].replace(/^\/api\/v\d+\//, '');
    const segment = clean.split('/').filter(Boolean)[0] || 'System';
    return segment
      .split('-')
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
      .join('');
  }
}
