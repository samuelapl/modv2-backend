import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { InAppProvider } from './providers/in-app.provider';
import { EmailProvider } from './providers/email.provider';
import { SmsProvider } from './providers/sms.provider';
import { NotificationsListener } from './notifications.listener';

@Module({
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    InAppProvider,
    EmailProvider,
    SmsProvider,
    NotificationsListener,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
