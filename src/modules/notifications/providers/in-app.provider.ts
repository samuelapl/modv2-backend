import { Injectable, Logger } from '@nestjs/common';
import { NotificationChannel, NotificationStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { SendNotificationInput } from '../interfaces/notification.interface';

@Injectable()
export class InAppProvider {
  private readonly logger = new Logger(InAppProvider.name);

  constructor(private readonly prisma: PrismaService) {}

  async send(input: SendNotificationInput) {
    try {
      const notification = await this.prisma.notification.create({
        data: {
          userId: input.userId,
          title: input.title,
          message: input.message,
          category: input.category,
          channel: NotificationChannel.IN_APP,
          status: NotificationStatus.UNREAD,
          link: input.link,
          metadata: input.metadata,
        },
      });
      return notification;
    } catch (err: any) {
      this.logger.error(`Failed to save In-App notification: ${err?.message ?? err}`);
      return null;
    }
  }
}
