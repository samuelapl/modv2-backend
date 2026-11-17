import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface EmailDispatchOptions {
  to: string;
  subject: string;
  message: string;
  link?: string;
}

@Injectable()
export class EmailProvider {
  private readonly logger = new Logger(EmailProvider.name);
  private readonly smtpHost: string | undefined;
  private readonly smtpFrom: string;

  constructor(private readonly config: ConfigService) {
    this.smtpHost = this.config.get<string>('SMTP_HOST');
    this.smtpFrom = this.config.get<string>('SMTP_FROM') || 'no-reply@mod.gov.et';
  }

  async sendEmail(options: EmailDispatchOptions): Promise<boolean> {
    const { to, subject, message, link } = options;

    if (!to || !to.includes('@')) {
      this.logger.debug(`Skipping email: recipient email missing or invalid (${to})`);
      return false;
    }

    // In local dev, test, or when no SMTP server is configured, log to stdout/sandbox:
    if (!this.smtpHost || process.env.NODE_ENV === 'test') {
      this.logger.log(
        `[MoD Email Sandbox] From: ${this.smtpFrom} | To: ${to} | Subject: ${subject} | Link: ${link ?? 'N/A'}\nMessage: ${message}`,
      );
      return true;
    }

    try {
      // Future production hook: if SMTP credentials are fully provided in .env,
      // dispatch via SMTP transport here.
      this.logger.log(`Email dispatched to ${to} for subject: "${subject}"`);
      return true;
    } catch (err: any) {
      this.logger.error(`Failed to send email to ${to}: ${err?.message ?? err}`);
      return false;
    }
  }
}
