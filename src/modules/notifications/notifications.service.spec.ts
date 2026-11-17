import { Test, TestingModule } from '@nestjs/testing';
import {
  NotificationCategory,
  NotificationChannel,
  NotificationStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AppNotFoundException } from '../../common/errors/app-error';
import { NotificationsService } from './notifications.service';
import { InAppProvider } from './providers/in-app.provider';
import { EmailProvider } from './providers/email.provider';
import { SmsProvider } from './providers/sms.provider';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let prisma: any;
  let inAppProvider: any;
  let emailProvider: any;
  let smsProvider: any;

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
      },
      notification: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        delete: jest.fn(),
      },
    };

    inAppProvider = {
      send: jest.fn(),
    };

    emailProvider = {
      sendEmail: jest.fn().mockResolvedValue(true),
    };

    smsProvider = {
      sendSms: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: InAppProvider, useValue: inAppProvider },
        { provide: EmailProvider, useValue: emailProvider },
        { provide: SmsProvider, useValue: smsProvider },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
  });

  describe('send', () => {
    it('should orchestrate In-App, Email and SMS multi-channel delivery', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'soldier@mod.gov.et',
        phone: '+251911223344',
        fullName: 'Sgt. Abebe Bikila',
        driverProfile: { contactPhone: '+251911223344' },
      });

      const mockNotification = {
        id: 'notif-1',
        userId: 'user-1',
        title: 'Application Approved',
        message: 'Your application has been approved by Command.',
        category: NotificationCategory.APPLICATION,
        channel: NotificationChannel.IN_APP,
        status: NotificationStatus.UNREAD,
      };

      inAppProvider.send.mockResolvedValue(mockNotification);

      const result = await service.send({
        userId: 'user-1',
        title: 'Application Approved',
        message: 'Your application has been approved by Command.',
        category: NotificationCategory.APPLICATION,
        link: '/applications/app-1',
      });

      expect(result).toEqual(mockNotification);
      expect(inAppProvider.send).toHaveBeenCalledTimes(1);
      expect(emailProvider.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'soldier@mod.gov.et',
          subject: 'Application Approved',
        }),
      );
      expect(smsProvider.sendSms).toHaveBeenCalledWith(
        expect.objectContaining({
          to: '+251911223344',
          message: expect.stringContaining('Application Approved'),
        }),
      );
    });

    it('should return null if user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.send({
        userId: 'unknown-user',
        title: 'Test',
        message: 'Test message',
        category: NotificationCategory.SYSTEM,
      });

      expect(result).toBeNull();
      expect(inAppProvider.send).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('should return paginated notifications with unread first', async () => {
      const items = [
        { id: 'notif-1', status: NotificationStatus.UNREAD },
        { id: 'notif-2', status: NotificationStatus.READ },
      ];
      prisma.notification.findMany.mockResolvedValue(items);
      prisma.notification.count.mockResolvedValue(2);

      const res = await service.findAll('user-1', { page: 1, limit: 10 });

      expect(res.items).toHaveLength(2);
      expect(res.total).toBe(2);
      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1' },
          orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        }),
      );
    });
  });

  describe('getUnreadCount', () => {
    it('should return unread count for badge', async () => {
      prisma.notification.count.mockResolvedValue(5);

      const res = await service.getUnreadCount('user-1');

      expect(res).toEqual({ unreadCount: 5 });
      expect(prisma.notification.count).toHaveBeenCalledWith({
        where: { userId: 'user-1', status: NotificationStatus.UNREAD },
      });
    });
  });

  describe('markAsRead', () => {
    it('should mark an existing notification as READ', async () => {
      prisma.notification.findFirst.mockResolvedValue({
        id: 'notif-1',
        userId: 'user-1',
        status: NotificationStatus.UNREAD,
      });
      prisma.notification.update.mockResolvedValue({
        id: 'notif-1',
        status: NotificationStatus.READ,
      });

      const res = await service.markAsRead('user-1', 'notif-1');

      expect(res.status).toBe(NotificationStatus.READ);
      expect(prisma.notification.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'notif-1' },
          data: expect.objectContaining({ status: NotificationStatus.READ }),
        }),
      );
    });

    it('should throw AppNotFoundException if notification does not exist', async () => {
      prisma.notification.findFirst.mockResolvedValue(null);

      await expect(service.markAsRead('user-1', 'notif-99')).rejects.toThrow(
        AppNotFoundException,
      );
    });
  });

  describe('markAllAsRead', () => {
    it('should mark all unread notifications as READ', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 4 });

      const res = await service.markAllAsRead('user-1');

      expect(res).toEqual({ count: 4 });
      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', status: NotificationStatus.UNREAD },
        data: expect.objectContaining({ status: NotificationStatus.READ }),
      });
    });
  });

  describe('remove', () => {
    it('should delete a notification', async () => {
      prisma.notification.findFirst.mockResolvedValue({
        id: 'notif-1',
        userId: 'user-1',
      });
      prisma.notification.delete.mockResolvedValue({});

      await service.remove('user-1', 'notif-1');

      expect(prisma.notification.delete).toHaveBeenCalledWith({
        where: { id: 'notif-1' },
      });
    });

    it('should throw AppNotFoundException if notification does not belong to user', async () => {
      prisma.notification.findFirst.mockResolvedValue(null);

      await expect(service.remove('user-1', 'notif-99')).rejects.toThrow(
        AppNotFoundException,
      );
    });
  });
});
