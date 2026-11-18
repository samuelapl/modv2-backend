import {
  Controller,
  Post,
  Param,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { KeycloakAdminService } from './keycloak-admin.service';
import { KeycloakSyncService } from './keycloak-sync.service';
import { toIdlmsIdentity } from './name-mapping';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { AuditMeta } from '../../common/decorators/audit.decorator';
import { Permission } from '../../common/enums/permissions.enum';
import { AppBadRequestException, AppNotFoundException, AppUnauthorizedException } from '../../common/errors';

@ApiTags('Keycloak')
@ApiBearerAuth('JWT-auth')
@Controller('keycloak')
export class KeycloakController {
  private readonly logger = new Logger(KeycloakController.name);

  constructor(
    private readonly adminService: KeycloakAdminService,
    private readonly syncService: KeycloakSyncService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * On-demand identity synchronization with Keycloak for the configured group.
   */
  @Post('sync')
  @AuditMeta('SYNC_KEYCLOAK_GROUP', 'KeycloakGroup')
  @RequirePermissions(Permission.USERS_MANAGE)
  @ApiOperation({ summary: 'Trigger on-demand synchronization with Keycloak group' })
  async syncGroup() {
    return this.syncService.syncKeycloakGroup();
  }

  /**
   * Synchronizes a user identity from Keycloak into IDLMS by service number.
   * If disabled in Keycloak, mirrors isActive = false and blacklists in Redis.
   */
  @Post('sync-user/:serviceNumber')
  @AuditMeta('SYNC_KEYCLOAK_USER', 'User', 'user', 'serviceNumber')
  @RequirePermissions(Permission.USERS_MANAGE)
  @ApiOperation({ summary: 'Sync user identity and enabled state from Keycloak' })
  async syncUser(@Param('serviceNumber') serviceNumber: string) {
    const normalizedServiceNumber = serviceNumber.trim().toUpperCase();
    const kcUser = await this.adminService.findUserByServiceNumber(normalizedServiceNumber);

    if (!kcUser) {
      throw new AppNotFoundException(
        'USERS_NOT_FOUND',
        { serviceNumber: normalizedServiceNumber },
        `User ${normalizedServiceNumber} not found in Keycloak.`,
      );
    }

    const mapped = toIdlmsIdentity(kcUser);

    let user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { serviceNumber: normalizedServiceNumber },
          ...(kcUser.id ? [{ keycloakId: kcUser.id }] : []),
        ],
      },
    });

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          serviceNumber: normalizedServiceNumber,
          keycloakId: kcUser.id ?? null,
          firstName: mapped.firstName,
          middleName: mapped.middleName,
          lastName: mapped.lastName,
          fullName: mapped.fullName,
          rank: mapped.rank,
          phone: mapped.phone,
          email: mapped.email,
          roles: [],
          isActive: kcUser.enabled ?? true,
          lastSyncedAt: new Date(),
        },
      });
    } else {
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: {
          keycloakId: kcUser.id ?? user.keycloakId,
          firstName: mapped.firstName ?? user.firstName,
          middleName: mapped.middleName ?? user.middleName,
          lastName: mapped.lastName ?? user.lastName,
          fullName: mapped.fullName || user.fullName,
          rank: mapped.rank ?? user.rank,
          phone: mapped.phone ?? user.phone,
          email: mapped.email ?? user.email,
          isActive: kcUser.enabled ?? user.isActive,
          lastSyncedAt: new Date(),
        },
      });
    }

    // Disabled propagation: if account disabled in Keycloak, immediately blacklist in Redis
    if (kcUser.enabled === false) {
      await this.redis.set(`jwt_user_disabled:${user.id}`, '1', 86400);
      this.logger.log(`Account ${normalizedServiceNumber} disabled in Keycloak; marked inactive locally.`);
    }

    return {
      synced: true,
      serviceNumber: user.serviceNumber,
      userId: user.id,
      enabled: user.isActive,
      lastSyncedAt: user.lastSyncedAt,
    };
  }

  /**
   * Webhook endpoint for Keycloak Admin Event listeners.
   * Keycloak event listener / webhook can POST here when user status changes.
   */
  @Public()
  @Post('webhook/event')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Keycloak admin event webhook receiver' })
  async handleWebhook(
    @Body() event: any,
    @Headers('x-webhook-secret') webhookSecret?: string,
  ) {
    const expectedSecret = process.env.KEYCLOAK_WEBHOOK_SECRET;
    if (expectedSecret && webhookSecret !== expectedSecret) {
      throw new AppUnauthorizedException('AUTH_INVALID_CREDENTIALS', {}, 'Invalid webhook secret.');
    }

    const username = event?.details?.username || event?.resourcePath?.split('/')[1];
    if (username) {
      const normalizedServiceNumber = username.trim().toUpperCase();
      try {
        const kcUser = await this.adminService.findUserByServiceNumber(normalizedServiceNumber);
        if (kcUser) {
          const user = await this.prisma.user.findFirst({
            where: {
              OR: [
                { serviceNumber: normalizedServiceNumber },
                ...(kcUser.id ? [{ keycloakId: kcUser.id }] : []),
              ],
            },
          });
          if (user) {
            await this.prisma.user.update({
              where: { id: user.id },
              data: {
                isActive: kcUser.enabled ?? user.isActive,
                lastSyncedAt: new Date(),
              },
            });
            if (kcUser.enabled === false) {
              await this.redis.set(`jwt_user_disabled:${user.id}`, '1', 86400);
            }
          }
        }
      } catch (err) {
        this.logger.warn(`Failed processing webhook event for ${username}: ${(err as Error).message}`);
      }
    }

    return { received: true };
  }
}
