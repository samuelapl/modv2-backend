import { Injectable, Logger, OnApplicationBootstrap, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cron } from '@nestjs/schedule';
import { CredentialStatus, VerificationStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export type ExpiryTrigger = 'schedule' | 'startup' | 'manual';

export interface ExpirySweepResult {
  trigger: ExpiryTrigger;
  ranAt: string;
  credentialsExpired: string[];
  licensesExpired: string[];
}

/** Ethiopian time (EAT, UTC+3) — the nightly run happens at 00:05 local time. */
export const EXPIRY_TIMEZONE = 'Africa/Addis_Ababa';

/**
 * Keeps stored statuses in line with expiry dates.
 *
 * - Driving permits: ACTIVE → EXPIRED once the expiry date has passed.
 * - National licenses: VERIFIED / UNVERIFIED → EXPIRED once the expiry date has passed.
 *
 * Runs nightly, and once on startup to catch up after any downtime.
 * Safe to run repeatedly: already-expired records are never touched again.
 */
@Injectable()
export class ExpiryService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ExpiryService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly eventEmitter?: EventEmitter2,
  ) {}

  onApplicationBootstrap() {
    // Don't block startup; just catch up in the background.
    if (process.env.NODE_ENV === 'test') return;
    this.runExpirySweep('startup').catch((err) =>
      this.logger.error(`Startup expiry sweep failed: ${err?.message ?? err}`),
    );
  }

  @Cron('5 0 * * *', { name: 'nightly-expiry-sweep', timeZone: EXPIRY_TIMEZONE })
  async handleNightlySweep() {
    try {
      await this.runExpirySweep('schedule');
      await this.dispatchExpiryWarnings();
    } catch (err: any) {
      this.logger.error(`Nightly expiry sweep failed: ${err?.message ?? err}`);
    }
  }

  /**
   * Dispatches upcoming expiry warnings at milestones (30, 15, 7, 3, 1 days).
   */
  async dispatchExpiryWarnings(now: Date = new Date()): Promise<number> {
    const MILESTONE_DAYS = [30, 15, 7, 3, 1];
    const maxFuture = new Date(now.getTime() + 31 * 24 * 60 * 60 * 1000);

    const upcoming = await this.prisma.issuedCredential.findMany({
      where: {
        status: CredentialStatus.ACTIVE,
        expiryDate: {
          gt: now,
          lte: maxFuture,
        },
      },
      select: {
        id: true,
        credentialNumber: true,
        expiryDate: true,
        driverProfile: {
          select: {
            userId: true,
          },
        },
      },
    });

    let dispatched = 0;
    for (const cred of upcoming) {
      const msDiff = cred.expiryDate.getTime() - now.getTime();
      const daysRemaining = Math.ceil(msDiff / (24 * 60 * 60 * 1000));
      if (MILESTONE_DAYS.includes(daysRemaining)) {
        this.eventEmitter?.emit('expiry.warning', {
          driverUserId: cred.driverProfile.userId,
          permitNumber: cred.credentialNumber,
          daysRemaining,
          expiryDate: cred.expiryDate.toISOString().slice(0, 10),
        });
        dispatched++;
      }
    }
    return dispatched;
  }

  async runExpirySweep(
    trigger: ExpiryTrigger,
    now: Date = new Date(),
  ): Promise<ExpirySweepResult | null> {
    if (this.running) {
      this.logger.warn('Expiry sweep already in progress — skipped.');
      return null;
    }
    this.running = true;

    try {
      const [credentials, licenses] = await Promise.all([
        this.prisma.issuedCredential.findMany({
          where: { status: CredentialStatus.ACTIVE, expiryDate: { lte: now } },
          select: { id: true, credentialNumber: true, expiryDate: true },
        }),
        this.prisma.nationalLicense.findMany({
          where: {
            verificationStatus: {
              in: [VerificationStatus.VERIFIED, VerificationStatus.UNVERIFIED],
            },
            expiryDate: { lte: now },
          },
          select: {
            id: true,
            licenseNumber: true,
            verificationStatus: true,
            expiryDate: true,
          },
        }),
      ]);

      const result: ExpirySweepResult = {
        trigger,
        ranAt: now.toISOString(),
        credentialsExpired: credentials.map((c) => c.credentialNumber),
        licensesExpired: licenses.map((l) => l.licenseNumber),
      };

      if (credentials.length === 0 && licenses.length === 0) {
        this.logger.log(`Expiry sweep (${trigger}): nothing to expire.`);
        return result;
      }

      await this.prisma.$transaction(async (tx) => {
        if (credentials.length > 0) {
          // Re-check status in the WHERE so a concurrent change (e.g. suspension) wins.
          await tx.issuedCredential.updateMany({
            where: {
              id: { in: credentials.map((c) => c.id) },
              status: CredentialStatus.ACTIVE,
            },
            data: { status: CredentialStatus.EXPIRED },
          });
        }

        if (licenses.length > 0) {
          await tx.nationalLicense.updateMany({
            where: {
              id: { in: licenses.map((l) => l.id) },
              verificationStatus: {
                in: [VerificationStatus.VERIFIED, VerificationStatus.UNVERIFIED],
              },
            },
            data: { verificationStatus: VerificationStatus.EXPIRED },
          });
        }

        await tx.auditLog.createMany({
          data: [
            ...credentials.map((c) => ({
              userId: null,
              action: 'AUTO_EXPIRE_CREDENTIAL',
              entityType: 'IssuedCredential',
              entityId: c.id,
              oldValue: {
                status: CredentialStatus.ACTIVE,
                credentialNumber: c.credentialNumber,
                expiryDate: c.expiryDate.toISOString(),
              },
              newValue: { status: CredentialStatus.EXPIRED, trigger },
            })),
            ...licenses.map((l) => ({
              userId: null,
              action: 'AUTO_EXPIRE_NATIONAL_LICENSE',
              entityType: 'NationalLicense',
              entityId: l.id,
              oldValue: {
                verificationStatus: l.verificationStatus,
                licenseNumber: l.licenseNumber,
                expiryDate: l.expiryDate.toISOString(),
              },
              newValue: { verificationStatus: VerificationStatus.EXPIRED, trigger },
            })),
          ],
        });
      });

      this.logger.log(
        `Expiry sweep (${trigger}): ${credentials.length} permit(s) and ${licenses.length} national license(s) marked EXPIRED.`,
      );
      return result;
    } finally {
      this.running = false;
    }
  }
}
