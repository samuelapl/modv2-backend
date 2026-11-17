import { NotificationCategory, NotificationChannel } from '@prisma/client';

export interface SendNotificationInput {
  userId: string;
  title: string;
  message: string;
  category: NotificationCategory;
  channels?: NotificationChannel[];
  link?: string;
  metadata?: Record<string, any>;
}
