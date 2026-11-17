import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ApplicationStatus, NotificationCategory } from '@prisma/client';
import { NotificationsService } from './notifications.service';
import { SendNotificationInput } from './interfaces/notification.interface';

@Injectable()
export class NotificationsListener {
  private readonly logger = new Logger(NotificationsListener.name);

  constructor(private readonly notificationsService: NotificationsService) {}

  /**
   * Generic direct notification listener.
   */
  @OnEvent('notification.direct')
  async handleDirectNotification(payload: SendNotificationInput) {
    try {
      await this.notificationsService.send(payload);
    } catch (err: any) {
      this.logger.error(`Direct notification error: ${err?.message ?? err}`);
    }
  }

  /**
   * Safety violation / Disciplinary suspension imposed.
   */
  @OnEvent('safety.suspended')
  async handleSafetySuspension(payload: {
    driverUserId: string;
    permitNumber: string;
    reason: string;
    durationDays?: number;
    unitCoordinatorUserId?: string;
  }) {
    const daysText = payload.durationDays
      ? `for ${payload.durationDays} days`
      : 'until further order';

    // 1. Notify the driver
    await this.notificationsService.send({
      userId: payload.driverUserId,
      title: 'Driving Permit Suspended',
      message: `Your MoD Driving Permit (${payload.permitNumber}) has been suspended ${daysText}. Grounding Reason: ${payload.reason}`,
      category: NotificationCategory.SAFETY,
      link: '/my-license',
      metadata: { permitNumber: payload.permitNumber, reason: payload.reason },
    });

    // 2. Notify their Unit Transport Officer / Coordinator
    if (payload.unitCoordinatorUserId) {
      await this.notificationsService.send({
        userId: payload.unitCoordinatorUserId,
        title: 'Driver Suspended in Your Unit',
        message: `Driver permit ${payload.permitNumber} has been suspended ${daysText}. Ensure driver is grounded from vehicle operation.`,
        category: NotificationCategory.SAFETY,
        link: '/safety',
        metadata: { permitNumber: payload.permitNumber },
      });
    }
  }

  /**
   * Safety suspension lifted / reinstated.
   */
  @OnEvent('safety.reinstated')
  async handleSafetyReinstated(payload: {
    driverUserId: string;
    permitNumber: string;
    unitCoordinatorUserId?: string;
  }) {
    await this.notificationsService.send({
      userId: payload.driverUserId,
      title: 'Permit Suspension Lifted',
      message: `Your MoD Driving Permit (${payload.permitNumber}) suspension has been lifted. Driving authorization is restored.`,
      category: NotificationCategory.SAFETY,
      link: '/my-license',
      metadata: { permitNumber: payload.permitNumber },
    });

    if (payload.unitCoordinatorUserId) {
      await this.notificationsService.send({
        userId: payload.unitCoordinatorUserId,
        title: 'Driver Suspension Lifted',
        message: `Suspension on permit ${payload.permitNumber} has been lifted. Unit driving duties may resume.`,
        category: NotificationCategory.SAFETY,
        link: '/safety',
      });
    }
  }

  /**
   * 30/15/7 day expiry warnings dispatched from ExpiryService nightly sweep.
   */
  @OnEvent('expiry.warning')
  async handleExpiryWarning(payload: {
    driverUserId: string;
    permitNumber: string;
    daysRemaining: number;
    expiryDate: string;
    unitCoordinatorUserId?: string;
  }) {
    await this.notificationsService.send({
      userId: payload.driverUserId,
      title: `Driving Permit Expiring in ${payload.daysRemaining} Days`,
      message: `Your permit (${payload.permitNumber}) expires on ${payload.expiryDate}. Please initiate a renewal application to prevent operational grounding.`,
      category: NotificationCategory.EXPIRY,
      link: '/my-application',
      metadata: {
        permitNumber: payload.permitNumber,
        daysRemaining: payload.daysRemaining,
      },
    });

    if (payload.unitCoordinatorUserId) {
      await this.notificationsService.send({
        userId: payload.unitCoordinatorUserId,
        title: `Driver Permit Expiring: ${payload.permitNumber}`,
        message: `A driver in your unit holds permit ${payload.permitNumber} expiring on ${payload.expiryDate} (${payload.daysRemaining} days remaining).`,
        category: NotificationCategory.EXPIRY,
        link: '/drivers',
      });
    }
  }

  /**
   * Application submitted into the central screening queue.
   */
  @OnEvent('application.submitted')
  async handleApplicationSubmitted(payload: {
    applicationId: string;
    applicationNumber: string;
    driverUserId: string;
    screenerUserIds?: string[];
  }) {
    // Notify the driver
    await this.notificationsService.send({
      userId: payload.driverUserId,
      title: 'Application Received',
      message: `Your application (${payload.applicationNumber}) has been submitted for MoD HQ screening.`,
      category: NotificationCategory.APPLICATION,
      link: `/applications/${payload.applicationId}`,
      metadata: { applicationNumber: payload.applicationNumber },
    });

    // Notify central screeners if list provided
    if (payload.screenerUserIds && payload.screenerUserIds.length > 0) {
      for (const screenerId of payload.screenerUserIds) {
        await this.notificationsService.send({
          userId: screenerId,
          title: 'New Application Awaiting Screening',
          message: `Application ${payload.applicationNumber} is queued for verification and screening.`,
          category: NotificationCategory.APPLICATION,
          link: `/applications/${payload.applicationId}`,
        });
      }
    }
  }

  /**
   * Application status transitions (APPROVED, REJECTED, RETURNED_FOR_CORRECTION).
   */
  @OnEvent('application.status_changed')
  async handleApplicationStatusChanged(payload: {
    applicationId: string;
    applicationNumber: string;
    driverUserId: string;
    newStatus: ApplicationStatus;
    comments?: string;
    unitCoordinatorUserId?: string;
  }) {
    const { newStatus, applicationNumber, applicationId, driverUserId, comments } =
      payload;

    if (newStatus === ApplicationStatus.APPROVED) {
      const msg = `Application ${applicationNumber} has been APPROVED by Command Authority. Forwarded to Credential Issuer for card printing.`;
      await this.notificationsService.send({
        userId: driverUserId,
        title: 'Application Approved by Command',
        message: msg,
        category: NotificationCategory.APPLICATION,
        link: `/applications/${applicationId}`,
        metadata: { applicationNumber, status: newStatus },
      });
      if (payload.unitCoordinatorUserId) {
        await this.notificationsService.send({
          userId: payload.unitCoordinatorUserId,
          title: `Application ${applicationNumber} Approved`,
          message: msg,
          category: NotificationCategory.APPLICATION,
          link: `/applications/${applicationId}`,
        });
      }
    } else if (newStatus === ApplicationStatus.REJECTED) {
      const reason = comments ? ` Reason: ${comments}` : '';
      const msg = `Application ${applicationNumber} was REJECTED by Command Authority.${reason}`;
      await this.notificationsService.send({
        userId: driverUserId,
        title: 'Application Rejected',
        message: msg,
        category: NotificationCategory.APPLICATION,
        link: `/applications/${applicationId}`,
        metadata: { applicationNumber, status: newStatus, comments },
      });
      if (payload.unitCoordinatorUserId) {
        await this.notificationsService.send({
          userId: payload.unitCoordinatorUserId,
          title: `Application ${applicationNumber} Rejected`,
          message: msg,
          category: NotificationCategory.APPLICATION,
          link: `/applications/${applicationId}`,
        });
      }
    } else if (newStatus === ApplicationStatus.RETURNED_FOR_CORRECTION) {
      const note = comments ? ` Note: ${comments}` : '';
      const msg = `Application ${applicationNumber} returned for correction.${note} Please review and resubmit.`;
      await this.notificationsService.send({
        userId: driverUserId,
        title: 'Application Returned for Correction',
        message: msg,
        category: NotificationCategory.APPLICATION,
        link: `/applications/${applicationId}`,
        metadata: { applicationNumber, status: newStatus, comments },
      });
      if (payload.unitCoordinatorUserId) {
        await this.notificationsService.send({
          userId: payload.unitCoordinatorUserId,
          title: `Application ${applicationNumber} Returned`,
          message: msg,
          category: NotificationCategory.APPLICATION,
          link: `/applications/${applicationId}`,
        });
      }
    }
  }

  /**
   * Final credential card printed and dispatched.
   */
  @OnEvent('credential.issued')
  async handleCredentialIssued(payload: {
    driverUserId: string;
    credentialNumber: string;
    categories: string[];
  }) {
    await this.notificationsService.send({
      userId: payload.driverUserId,
      title: 'MoD Driving Permit Card Ready',
      message: `Your official MoD Driving Permit (${payload.credentialNumber}) covering [${payload.categories.join(
        ', ',
      )}] has been printed and is ready for collection at Central HQ Dispatch.`,
      category: NotificationCategory.CREDENTIAL,
      link: '/my-license',
      metadata: { credentialNumber: payload.credentialNumber },
    });
  }
}
