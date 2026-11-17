import { Injectable, Logger } from '@nestjs/common';
import {
  Notification,
  NotificationChannel,
  NotificationStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/paginated-result.dto';
import { AppNotFoundException } from '../../common/errors/app-error';
import { InAppProvider } from './providers/in-app.provider';
import { EmailProvider } from './providers/email.provider';
import { SmsProvider } from './providers/sms.provider';
import { QueryNotificationsDto } from './dto/query-notifications.dto';
import { SendNotificationInput } from './interfaces/notification.interface';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inAppProvider: InAppProvider,
    private readonly emailProvider: EmailProvider,
    private readonly smsProvider: SmsProvider,
  ) {}

  /**
   * Orchestrates multi-channel dispatch (In-App, Email, SMS).
   * Asynchronous, non-blocking: errors in Email/SMS delivery are logged but never fail the transaction.
   */
  async send(input: SendNotificationInput): Promise<Notification | null> {
    const channels = input.channels || [
      NotificationChannel.IN_APP,
      NotificationChannel.EMAIL,
      NotificationChannel.SMS,
    ];

    // 1. Fetch user & driver contact coordinates
    const recipient = await this.prisma.user.findUnique({
      where: { id: input.userId },
      select: {
        id: true,
        email: true,
        phone: true,
        fullName: true,
        driverProfile: {
          select: { contactPhone: true },
        },
      },
    });

    if (!recipient) {
      this.logger.warn(
        `Cannot send notification: User with ID ${input.userId} does not exist.`,
      );
      return null;
    }

    let inAppNotification: Notification | null = null;

    // 2. Channel: IN_APP (Postgres Table)
    if (channels.includes(NotificationChannel.IN_APP)) {
      inAppNotification = await this.inAppProvider.send(input);
    }

    // 3. Channel: EMAIL
    if (channels.includes(NotificationChannel.EMAIL) && recipient.email) {
      this.emailProvider
        .sendEmail({
          to: recipient.email,
          subject: input.title,
          message: input.message,
          link: input.link,
        })
        .catch((err) =>
          this.logger.error(`Email dispatch background error: ${err?.message ?? err}`),
        );
    }

    // 4. Channel: SMS
    const targetPhone =
      recipient.phone || recipient.driverProfile?.contactPhone;
    if (channels.includes(NotificationChannel.SMS) && targetPhone) {
      this.smsProvider
        .sendSms({
          to: targetPhone,
          message: `${input.title}: ${input.message}`,
        })
        .catch((err) =>
          this.logger.error(`SMS dispatch background error: ${err?.message ?? err}`),
        );
    }

    return inAppNotification;
  }

  /**
   * Retrieves paginated notifications for a specific user.
   * Default ordering puts UNREAD messages first, then sorted newest to oldest.
   */
  async findAll(
    userId: string,
    query: QueryNotificationsDto,
  ): Promise<PaginatedResult<Notification>> {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = { userId };

    if (query.status) {
      where.status = query.status;
    } else if (query.unreadOnly) {
      where.status = NotificationStatus.UNREAD;
    }

    if (query.category) {
      where.category = query.category;
    }

    const [items, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        skip,
        take: limit,
      }),
      this.prisma.notification.count({ where }),
    ]);

    return new PaginatedResult(items, total, page, limit);
  }

  /**
   * Lightweight unread counter for the frontend header bell badge.
   */
  async getUnreadCount(userId: string): Promise<{ unreadCount: number }> {
    const unreadCount = await this.prisma.notification.count({
      where: {
        userId,
        status: NotificationStatus.UNREAD,
      },
    });

    return { unreadCount };
  }

  /**
   * Marks a single notification as READ.
   */
  async markAsRead(
    userId: string,
    notificationId: string,
  ): Promise<Notification> {
    const existing = await this.prisma.notification.findFirst({
      where: { id: notificationId, userId },
    });

    if (!existing) {
      throw new AppNotFoundException(
        'NOTIFICATION_NOT_FOUND',
        { id: notificationId },
        'Notification not found or access denied.',
      );
    }

    return this.prisma.notification.update({
      where: { id: notificationId },
      data: {
        status: NotificationStatus.READ,
        readAt: new Date(),
      },
    });
  }

  /**
   * Marks all UNREAD notifications for a user as READ in a single query.
   */
  async markAllAsRead(userId: string): Promise<{ count: number }> {
    const result = await this.prisma.notification.updateMany({
      where: {
        userId,
        status: NotificationStatus.UNREAD,
      },
      data: {
        status: NotificationStatus.READ,
        readAt: new Date(),
      },
    });

    return { count: result.count };
  }

  /**
   * Permanently removes a notification.
   */
  async remove(userId: string, notificationId: string): Promise<void> {
    const existing = await this.prisma.notification.findFirst({
      where: { id: notificationId, userId },
    });

    if (!existing) {
      throw new AppNotFoundException(
        'NOTIFICATION_NOT_FOUND',
        { id: notificationId },
        'Notification not found or access denied.',
      );
    }

    await this.prisma.notification.delete({
      where: { id: notificationId },
    });
  }
}
