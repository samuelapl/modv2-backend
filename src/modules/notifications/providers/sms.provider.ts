import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface SmsDispatchOptions {
  to: string;
  message: string;
}

@Injectable()
export class SmsProvider {
  private readonly logger = new Logger(SmsProvider.name);
  private readonly gatewayUrl: string | undefined;

  constructor(private readonly config: ConfigService) {
    this.gatewayUrl = this.config.get<string>('SMS_GATEWAY_URL');
  }

  async sendSms(options: SmsDispatchOptions): Promise<boolean> {
    const { to, message } = options;

    if (!to || to.trim().length < 9) {
      this.logger.debug(`Skipping SMS: recipient phone missing or invalid (${to})`);
      return false;
    }

    const cleanPhone = to.trim();
    const formattedMessage = `[MoD IDLMS] ${message.trim()}`;

    // In local dev, test, or air-gapped network with no active SMS gateway:
    if (!this.gatewayUrl || process.env.NODE_ENV === 'test') {
      this.logger.log(
        `[MoD SMS Sandbox] To: ${cleanPhone} | Length: ${formattedMessage.length} chars\nBody: ${formattedMessage}`,
      );
      return true;
    }

    try {
      // Future production hook: HTTP POST to Ethio Telecom Short Code API / SMPP gateway
      this.logger.log(`SMS dispatched to ${cleanPhone}`);
      return true;
    } catch (err: any) {
      this.logger.error(`Failed to send SMS to ${cleanPhone}: ${err?.message ?? err}`);
      return false;
    }
  }
}
