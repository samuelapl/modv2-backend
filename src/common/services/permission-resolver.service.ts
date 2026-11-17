import { Injectable } from '@nestjs/common';
import { SystemRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';

@Injectable()
export class PermissionResolverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async resolveUserPermissions(
    roles: SystemRole[],
    customPermissions: string[] = [],
  ): Promise<string[]> {
    const permissionSet = new Set<string>(customPermissions);
    const uncachedRoles: SystemRole[] = [];

    for (const role of roles) {
      const cached = await this.redis.get(`role_perms:${role}`);
      if (cached) {
        try {
          const parsed: string[] = JSON.parse(cached);
          parsed.forEach((p) => permissionSet.add(p));
          continue;
        } catch {
          // Fall back to DB lookup on corrupt cache payload
        }
      }
      uncachedRoles.push(role);
    }

    if (uncachedRoles.length > 0) {
      const roleTemplates = await this.prisma.rolePermission.findMany({
        where: { role: { in: uncachedRoles } },
      });

      for (const template of roleTemplates) {
        template.permissions.forEach((p) => permissionSet.add(p));
        await this.redis.set(
          `role_perms:${template.role}`,
          JSON.stringify(template.permissions),
          300,
        );
      }
    }

    return Array.from(permissionSet);
  }

  async invalidateRoleCache(role: SystemRole): Promise<void> {
    await this.redis.del(`role_perms:${role}`);
  }
}
