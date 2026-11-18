import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SystemRole } from '@prisma/client';
import { KeycloakAdminService } from './keycloak-admin.service';
import { toIdlmsIdentity, toIdlmsServiceNumber } from './name-mapping';
import {
  ensureDriverProfile,
  getDefaultRoles,
  getSyncScope,
  isServiceAccount,
  resolveUnitId,
} from './provisioning';
import { KeycloakUserRepresentation } from './name-mapping';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';

export interface KeycloakSyncResult {
  totalProcessed: number;
  created: number;
  updated: number;
  disabled: number;
  /** Linked users deleted in Keycloak and removed locally (they had no operational records). */
  removed: number;
  /** Linked users deleted in Keycloak but kept locally as inactive because they have records. */
  deactivated: number;
  durationMs: number;
}

@Injectable()
export class KeycloakSyncService {
  private readonly logger = new Logger(KeycloakSyncService.name);
  private isSyncing = false;

  constructor(
    private readonly adminService: KeycloakAdminService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Scheduled cron job that syncs the IDLMS user group from Keycloak.
   * Default: every 15 minutes. Only active when IDENTITY_PROVIDER=keycloak.
   */
  @Cron(process.env.KEYCLOAK_SYNC_CRON || '0 */15 * * * *')
  async handleScheduledSync(): Promise<void> {
    if (process.env.IDENTITY_PROVIDER !== 'keycloak') {
      return;
    }

    try {
      this.logger.log('Starting scheduled Keycloak identity sync...');
      const res = await this.syncKeycloakGroup();
      this.logger.log(
        `Scheduled sync completed: ${res.totalProcessed} processed, ${res.created} created, ${res.updated} updated, ${res.disabled} disabled, ${res.removed} removed, ${res.deactivated} deactivated (${res.durationMs}ms)`,
      );
    } catch (err) {
      this.logger.error(`Scheduled Keycloak sync failed: ${(err as Error).message}`);
    }
  }

  /**
   * Executes identity synchronization for users in the configured group (or entire realm).
   * Safe for concurrent invocations (guarded by isSyncing lock).
   */
  async syncKeycloakGroup(groupName?: string): Promise<KeycloakSyncResult> {
    if (this.isSyncing) {
      this.logger.warn('Keycloak sync already in progress. Skipping overlapping run.');
      return { totalProcessed: 0, created: 0, updated: 0, disabled: 0, removed: 0, deactivated: 0, durationMs: 0 };
    }

    this.isSyncing = true;
    const startTime = Date.now();
    const targetGroup = groupName || process.env.KEYCLOAK_SYNC_GROUP || 'idlms-users';

    let createdCount = 0;
    let updatedCount = 0;
    let disabledCount = 0;

    try {
      // The full realm list is needed for the removal check in both scopes.
      const allUsers = await this.adminService.listAllUsers();

      let kcUsers: KeycloakUserRepresentation[];
      if (getSyncScope() === 'group') {
        kcUsers = await this.adminService.listGroupMembers(targetGroup);
        this.logger.log(`Fetched ${kcUsers.length} users from Keycloak group "${targetGroup}".`);
      } else {
        if (!allUsers) {
          this.logger.error('Keycloak sync aborted: the realm user list could not be read.');
          return { totalProcessed: 0, created: 0, updated: 0, disabled: 0, removed: 0, deactivated: 0, durationMs: Date.now() - startTime };
        }
        kcUsers = allUsers.filter((u) => !isServiceAccount(u));
        this.logger.log(`Fetched ${kcUsers.length} users from the Keycloak realm.`);
      }

      for (const kcUser of kcUsers) {
        if (!kcUser.username) continue;

        const serviceNumber = toIdlmsServiceNumber(kcUser.username);
        const mapped = toIdlmsIdentity(kcUser);

        const existingUser = await this.prisma.user.findFirst({
          where: {
            OR: [
              { serviceNumber },
              ...(kcUser.id ? [{ keycloakId: kcUser.id }] : []),
            ],
          },
        });

        if (!existingUser) {
          // Provision person locally with this platform's default role (DEFAULT_ROLE) and unit.
          const unitId = await resolveUnitId(this.prisma, mapped.unitCode);
          const created = await this.prisma.user.create({
            data: {
              serviceNumber,
              keycloakId: kcUser.id ?? null,
              firstName: mapped.firstName,
              middleName: mapped.middleName,
              lastName: mapped.lastName,
              fullName: mapped.fullName || serviceNumber,
              rank: mapped.rank,
              phone: mapped.phone,
              email: mapped.email,
              roles: getDefaultRoles(),
              ...(unitId ? { unitId } : {}),
              // An admin set the password in Keycloak, so the person must choose their own.
              mustChangePassword: true,
              isActive: kcUser.enabled ?? true,
              lastSyncedAt: new Date(),
            },
          });

          await ensureDriverProfile(this.prisma, created);

          if (kcUser.enabled === false) {
            await this.redis.set(`jwt_user_disabled:${created.id}`, '1', 86400);
            disabledCount++;
          }

          createdCount++;
        } else {
          // Refresh local identity copy. Unit is only filled in when IDLMS has none yet.
          const unitId = existingUser.unitId ? null : await resolveUnitId(this.prisma, mapped.unitCode);
          await this.prisma.user.update({
            where: { id: existingUser.id },
            data: {
              ...(unitId ? { unitId } : {}),
              keycloakId: kcUser.id ?? existingUser.keycloakId,
              firstName: mapped.firstName ?? existingUser.firstName,
              middleName: mapped.middleName ?? existingUser.middleName,
              lastName: mapped.lastName ?? existingUser.lastName,
              fullName: mapped.fullName || existingUser.fullName,
              rank: mapped.rank ?? existingUser.rank,
              phone: mapped.phone ?? existingUser.phone,
              email: mapped.email ?? existingUser.email,
              isActive: kcUser.enabled ?? existingUser.isActive,
              lastSyncedAt: new Date(),
            },
          });

          if (kcUser.enabled === false) {
            await this.redis.set(`jwt_user_disabled:${existingUser.id}`, '1', 86400);
            disabledCount++;
          }

          updatedCount++;
        }
      }

      const { removed, deactivated } = await this.reconcileRemovedUsers(allUsers);

      const durationMs = Date.now() - startTime;
      return {
        totalProcessed: kcUsers.length,
        created: createdCount,
        updated: updatedCount,
        disabled: disabledCount,
        removed,
        deactivated,
        durationMs,
      };
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Handles users that were deleted in Keycloak: a linked local user whose Keycloak account no
   * longer exists is deleted if nothing depends on them, otherwise kept as an inactive account
   * (their applications, exams and credentials must stay for the audit trail).
   *
   * Guarded so a bad read can never wipe users: it does nothing if Keycloak could not be read,
   * returned no users, or would remove more than KEYCLOAK_SYNC_MAX_REMOVALS accounts at once
   * (default: 10% of linked users, at least 5). System administrators are never touched.
   */
  private async reconcileRemovedUsers(
    kcUsers: KeycloakUserRepresentation[] | null,
  ): Promise<{ removed: number; deactivated: number }> {
    const none = { removed: 0, deactivated: 0 };

    if (!kcUsers || kcUsers.length === 0) {
      this.logger.warn('Skipping removal check: Keycloak users could not be read (or the realm is empty).');
      return none;
    }
    const kcIds = new Set(kcUsers.map((u) => u.id).filter((id): id is string => Boolean(id)));

    const linked = await this.prisma.user.findMany({
      where: { keycloakId: { not: null } },
      select: {
        id: true,
        serviceNumber: true,
        roles: true,
        keycloakId: true,
        driverProfile: { select: { id: true } },
        _count: {
          select: {
            approvalsGiven: true,
            examinationsGiven: true,
            issuedCredentials: true,
            suspensionsImposed: true,
          },
        },
      },
    });

    const missing = linked.filter((u) => !kcIds.has(u.keycloakId as string));
    if (missing.length === 0) return none;

    const limit =
      Number(process.env.KEYCLOAK_SYNC_MAX_REMOVALS) || Math.max(5, Math.ceil(linked.length * 0.1));
    if (missing.length > limit) {
      this.logger.error(
        `Refusing to remove ${missing.length} users missing from Keycloak (limit ${limit}). ` +
          'Check Keycloak, or raise KEYCLOAK_SYNC_MAX_REMOVALS if this is intended.',
      );
      return none;
    }

    let removed = 0;
    let deactivated = 0;

    for (const user of missing) {
      if (user.roles.includes(SystemRole.SYSTEM_ADMIN)) {
        this.logger.warn(`${user.serviceNumber} is missing from Keycloak but is a system administrator; left unchanged.`);
        continue;
      }

      const hasRecords =
        user.driverProfile !== null ||
        user._count.approvalsGiven > 0 ||
        user._count.examinationsGiven > 0 ||
        user._count.issuedCredentials > 0 ||
        user._count.suspensionsImposed > 0;

      if (!hasRecords) {
        try {
          await this.prisma.$transaction(async (tx) => {
            await tx.auditLog.updateMany({ where: { userId: user.id }, data: { userId: null } });
            await tx.user.delete({ where: { id: user.id } });
          });
          this.logger.log(`Removed ${user.serviceNumber}: deleted in Keycloak and has no records.`);
          removed++;
          continue;
        } catch (err) {
          // Something else still references them: fall through and keep the account inactive.
          this.logger.warn(`Could not delete ${user.serviceNumber} (${(err as Error).message}); deactivating instead.`);
        }
      }

      // keycloakId is cleared so the account is not re-processed every sync; if the person is
      // later re-created in Keycloak the sync links them again by service number.
      await this.prisma.user.update({
        where: { id: user.id },
        data: { isActive: false, keycloakId: null, lastSyncedAt: new Date() },
      });
      await this.redis.set(`jwt_user_disabled:${user.id}`, '1', 86400);
      this.logger.log(`Deactivated ${user.serviceNumber}: deleted in Keycloak but has records to keep.`);
      deactivated++;
    }

    return { removed, deactivated };
  }
}
