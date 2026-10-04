import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as brevo from '@getbrevo/brevo';
import {
  OrderConfirmationData,
  OrderStatusUpdateData,
  RenderedMail,
  RenewalReminderData,
} from './mail.types';
import { renderOrderConfirmationMail } from './templates/order-confirmation.template';
import { renderOrderStatusUpdateMail } from './templates/order-status-update.template';
import { renderPasswordResetMail } from './templates/password-reset.template';
import { renderRenewalReminderMail } from './templates/renewal-reminder.template';
import { renderVerificationMail } from './templates/verification.template';
import { mailIdentity } from './templates/mail-theme';

export { OrderConfirmationData, OrderStatusUpdateData, RenewalReminderData } from './mail.types';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly client: brevo.BrevoClient | null;
  private readonly senderEmail: string;
  private readonly senderName: string;
  private readonly replyToEmail?: string;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('BREVO_API_KEY');
    const from = this.configService.get<string>(
      'MAIL_FROM',
      `"${mailIdentity.fromName}" <noreply@fashionai.com>`,
    );
    const sender = this.parseMailbox(from);
    this.senderName = sender.name || mailIdentity.fromName;
    this.senderEmail = sender.email;
    this.replyToEmail = this.configService.get<string>('MAIL_REPLY_TO')?.trim() || undefined;

    if (apiKey) {
      this.client = new brevo.BrevoClient({ auth: { apiKey: () => apiKey } } as any);
      this.logger.log('Brevo email service initialized');
    } else {
      this.logger.warn('BREVO_API_KEY not configured. E-mails will be suppressed.');
      this.client = null;
    }
  }

  async sendVerificationEmail(email: string, otp: string): Promise<void> {
    await this.sendMail(email, 'verification', renderVerificationMail({ email, otp }));
  }

  async sendPasswordResetEmail(email: string, token: string): Promise<void> {
    const resetUrl = this.buildFrontendUrl('/reset-password', { token });
    await this.sendMail(email, 'password-reset', renderPasswordResetMail({ email, resetUrl }));
  }

  async sendOrderConfirmationEmail(email: string, order: OrderConfirmationData): Promise<void> {
    const detailUrl = this.buildFrontendUrl(`/orders/${encodeURIComponent(order.orderId)}`);
    await this.sendMail(
      email,
      'order-confirmation',
      renderOrderConfirmationMail({ ...order, detailUrl }),
    );
  }

  async sendOrderStatusUpdateEmail(email: string, data: OrderStatusUpdateData): Promise<void> {
    const detailUrl = this.buildFrontendUrl(`/orders/${encodeURIComponent(data.orderId)}`);
    await this.sendMail(
      email,
      'order-status-update',
      renderOrderStatusUpdateMail({ ...data, detailUrl }),
    );
  }

  async sendRenewalReminderEmail(email: string, data: RenewalReminderData): Promise<void> {
    const subscriptionUrl = this.buildFrontendUrl('/subscription');
    await this.sendMail(
      email,
      'renewal-reminder',
      renderRenewalReminderMail({ ...data, subscriptionUrl }),
    );
  }

  private async sendMail(to: string, kind: string, mail: RenderedMail): Promise<void> {
    if (!this.client) {
      this.logger.log(`Mail suppressed | kind=${kind}`);
      return;
    }

    try {
      const payload: Record<string, unknown> = {
        sender: { email: this.senderEmail, name: this.senderName },
        to: [{ email: to }],
        subject: mail.subject,
        htmlContent: mail.html,
        textContent: mail.text,
      };
      if (this.replyToEmail) payload.replyTo = { email: this.replyToEmail };

      const result = await this.client.transactionalEmails.sendTransacEmail(payload as any);
      this.logger.log(`Email sent | kind=${kind} | messageId=${result.messageId}`);
    } catch (err: any) {
      const status = err?.response?.statusCode ?? err?.statusCode ?? err?.status;
      this.logger.error(
        `Failed to send email | kind=${kind} | status=${status ?? 'unknown'} | error=${err?.message ?? String(err)}`,
      );
      throw err;
    }
  }

  private buildFrontendUrl(pathname: string, params?: Record<string, string>): string {
    const base = this.configService.get<string>('FRONTEND_URL', 'http://localhost:3000');
    const url = new URL(base);
    if (url.username || url.password || url.search || url.hash) {
      throw new Error('Invalid FRONTEND_URL');
    }
    url.pathname = pathname;
    url.search = '';
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }
    }
    return url.toString();
  }

  private parseMailbox(value: string): { name: string; email: string } {
    if (/\r|\n/.test(value)) throw new Error('Invalid MAIL_FROM');
    const match = value.match(/^"?([^"<]+)"?\s*<([^>]+)>$/);
    if (match) return { name: match[1].trim(), email: match[2].trim() };
    return { name: mailIdentity.fromName, email: value.trim() };
  }
}
