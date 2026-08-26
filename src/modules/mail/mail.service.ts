import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrderStatus } from '@prisma/client';
import * as brevo from '@getbrevo/brevo';

export interface OrderStatusUpdateData {
  orderId: string;
  orderCode: number;
  status: OrderStatus;
  shippingInfo?: {
    name?: string;
    phone?: string;
    address?: string;
  } | null;
}

interface OrderStatusMailMeta {
  label: string;
  title: string;
  message: string;
  color: string;
}

const ORDER_STATUS_MAIL_META: Partial<Record<OrderStatus, OrderStatusMailMeta>> = {
  [OrderStatus.CONFIRMED]: {
    label: 'Đã xác nhận',
    title: 'Đơn hàng đã được xác nhận',
    message:
      'Shop đã xác nhận đơn hàng của bạn và đang chuẩn bị hàng để giao. Chúng tôi sẽ thông báo khi đơn được gửi đi.',
    color: '#4CAF50',
  },
  [OrderStatus.CANCELLED]: {
    label: 'Đã hủy',
    title: 'Đơn hàng đã bị hủy',
    message:
      'Đơn hàng của bạn đã được hủy. Nếu bạn đã thanh toán, khoản tiền sẽ được hoàn theo chính sách của shop. Vui lòng liên hệ nếu cần hỗ trợ.',
    color: '#E53935',
  },
};

export interface OrderConfirmationItem {
  name: string;
  quantity: number;
  color?: string | null;
  price: number;
}

export interface OrderConfirmationData {
  orderId: string;
  orderCode: number;
  items: OrderConfirmationItem[];
  itemsTotal: number;
  shippingFee: number;
  discountAmount: number;
  total: number;
  shippingInfo?: {
    name?: string;
    phone?: string;
    address?: string;
    note?: string;
  } | null;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly client: brevo.BrevoClient;
  private readonly senderEmail: string;
  private readonly senderName: string;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('BREVO_API_KEY');
    const from = this.configService.get<string>('MAIL_FROM', '"FashionAI" <noreply@fashionai.com>');

    // Parse "Name <email@domain.com>" format
    const match = from.match(/^"?([^"<]+)"?\s*<(.+)>$/);
    this.senderName = match ? match[1].trim() : 'FashionAI';
    this.senderEmail = match ? match[2].trim() : 'noreply@fashionai.com';

    if (apiKey) {
      this.client = new brevo.BrevoClient({ auth: { apiKey: () => apiKey } } as any);
      this.logger.log('Brevo email service initialized');
    } else {
      this.logger.warn('BREVO_API_KEY not configured. E-mails will be logged to console in dev mode.');
      this.client = null as any;
    }
  }

  async sendVerificationEmail(email: string, token: string): Promise<void> {
    const frontendUrl = this.configService.get<string>('FRONTEND_URL', 'http://localhost:3000');
    const verifyLink = `${frontendUrl}/verify-email?token=${token}`;
    const subject = '[FashionAI] Xác nhận địa chỉ email của bạn';
    const html = `
      <div style="font-family: Arial, sans-serif; padding: 20px;">
        <h2>Xác nhận địa chỉ Email</h2>
        <p>Cảm ơn bạn đã đăng ký tài khoản tại <strong>FashionAI</strong>.</p>
        <p>Vui lòng nhấp vào đường dẫn bên dưới để xác nhận email của bạn:</p>
        <p><a href="${verifyLink}" style="background-color: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">Xác nhận Email</a></p>
        <p>Hoặc truy cập link: <a href="${verifyLink}">${verifyLink}</a></p>
        <p>Đường dẫn này có hiệu lực trong 24 giờ.</p>
      </div>
    `;

    await this.sendMail(email, subject, html);
  }

  async sendPasswordResetEmail(email: string, token: string): Promise<void> {
    const frontendUrl = this.configService.get<string>('FRONTEND_URL', 'http://localhost:3000');
    const resetLink = `${frontendUrl}/reset-password?token=${token}`;
    const subject = '[FashionAI] Yêu cầu đặt lại mật khẩu';
    const html = `
      <div style="font-family: Arial, sans-serif; padding: 20px;">
        <h2>Đặt lại mật khẩu</h2>
        <p>Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản FashionAI của bạn.</p>
        <p>Vui lòng nhấp vào đường dẫn bên dưới để đặt lại mật khẩu:</p>
        <p><a href="${resetLink}" style="background-color: #2196F3; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">Đặt lại mật khẩu</a></p>
        <p>Hoặc truy cập link: <a href="${resetLink}">${resetLink}</a></p>
        <p>Đường dẫn này có hiệu lực trong 1 giờ. Nếu bạn không gửi yêu cầu này, vui lòng bỏ qua email.</p>
      </div>
    `;

    await this.sendMail(email, subject, html);
  }

  async sendOrderConfirmationEmail(
    email: string,
    order: OrderConfirmationData,
  ): Promise<void> {
    const frontendUrl = this.configService.get<string>(
      'FRONTEND_URL',
      'http://localhost:3000',
    );
    const detailLink = `${frontendUrl}/orders/${order.orderId}`;
    const fmt = (n: number) => `${Math.round(n).toLocaleString('vi-VN')}đ`;

    const itemRows = order.items
      .map((item) => {
        const variant = [item.color].filter(Boolean).join(' / ');
        return `
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee;">
              ${item.name}${variant ? ` <span style="color:#888;">(${variant})</span>` : ''}
            </td>
            <td style="padding: 8px; border-bottom: 1px solid #eee; text-align:center;">${item.quantity}</td>
            <td style="padding: 8px; border-bottom: 1px solid #eee; text-align:right;">${fmt(item.price * item.quantity)}</td>
          </tr>`;
      })
      .join('');

    const ship = order.shippingInfo;
    const shippingBlock = ship
      ? `
        <h3 style="margin-bottom: 4px;">Thông tin giao hàng</h3>
        <p style="margin: 2px 0;">${ship.name ?? ''}${ship.phone ? ` — ${ship.phone}` : ''}</p>
        <p style="margin: 2px 0;">${ship.address ?? ''}</p>
        ${ship.note ? `<p style="margin: 2px 0; color:#888;">Ghi chú: ${ship.note}</p>` : ''}`
      : '';

    const subject = `[FashionAI] Xác nhận đơn hàng #${order.orderCode}`;
    const html = `
      <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto;">
        <h2>Cảm ơn bạn đã đặt hàng!</h2>
        <p>Đơn hàng <strong>#${order.orderCode}</strong> đã được thanh toán thành công.</p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <thead>
            <tr style="background:#f5f5f5;">
              <th style="padding: 8px; text-align:left;">Sản phẩm</th>
              <th style="padding: 8px; text-align:center;">SL</th>
              <th style="padding: 8px; text-align:right;">Thành tiền</th>
            </tr>
          </thead>
          <tbody>${itemRows}</tbody>
        </table>
        <p style="margin: 2px 0; text-align:right;">Tạm tính: ${fmt(order.itemsTotal)}</p>
        <p style="margin: 2px 0; text-align:right;">Phí vận chuyển: ${fmt(order.shippingFee)}</p>
        ${order.discountAmount > 0 ? `<p style="margin: 2px 0; text-align:right;">Giảm giá: -${fmt(order.discountAmount)}</p>` : ''}
        <p style="margin: 8px 0; text-align:right; font-size: 18px;"><strong>Tổng cộng: ${fmt(order.total)}</strong></p>
        ${shippingBlock}
        <p style="margin-top: 24px;">
          <a href="${detailLink}" style="background-color: #4CAF50; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">Xem chi tiết đơn hàng</a>
        </p>
        <p style="color:#888;">Hoặc truy cập: <a href="${detailLink}">${detailLink}</a></p>
      </div>
    `;

    await this.sendMail(email, subject, html);
  }

  async sendOrderStatusUpdateEmail(
    email: string,
    data: OrderStatusUpdateData,
  ): Promise<void> {
    const frontendUrl = this.configService.get<string>(
      'FRONTEND_URL',
      'http://localhost:3000',
    );
    const detailLink = `${frontendUrl}/orders/${data.orderId}`;
    const meta = ORDER_STATUS_MAIL_META[data.status] ?? {
      label: data.status,
      title: 'Cập nhật đơn hàng',
      message: `Đơn hàng #${data.orderCode} của bạn đã được cập nhật trạng thái.`,
      color: '#4CAF50',
    };

    const ship = data.shippingInfo;
    const shippingBlock = ship
      ? `
        <h3 style="margin-bottom: 4px;">Thông tin giao hàng</h3>
        <p style="margin: 2px 0;">${ship.name ?? ''}${ship.phone ? ` — ${ship.phone}` : ''}</p>
        <p style="margin: 2px 0;">${ship.address ?? ''}</p>`
      : '';

    const subject = `[FashionAI] Đơn hàng #${data.orderCode} — ${meta.label}`;
    const html = `
      <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto;">
        <h2>${meta.title}</h2>
        <p>${meta.message}</p>
        <p style="margin: 8px 0;">Trạng thái hiện tại:
          <strong style="color: ${meta.color};">${meta.label}</strong>
        </p>
        ${shippingBlock}
        <p style="margin-top: 24px;">
          <a href="${detailLink}" style="background-color: ${meta.color}; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">Xem chi tiết đơn hàng</a>
        </p>
        <p style="color:#888;">Hoặc truy cập: <a href="${detailLink}">${detailLink}</a></p>
      </div>
    `;

    await this.sendMail(email, subject, html);
  }

  private async sendMail(to: string, subject: string, html: string): Promise<void> {
    if (!this.client) {
      this.logger.log(`[DEV MAIL] To: ${to} | Subject: ${subject}`);
      this.logger.log(`[DEV MAIL HTML]:\n${html}`);
      return;
    }

    try {
      const result = await this.client.transactionalEmails.sendTransacEmail({
        sender: { email: this.senderEmail, name: this.senderName },
        to: [{ email: to }],
        subject,
        htmlContent: html,
      });
      this.logger.log(`Email sent to ${to} (${subject}) | MessageId: ${result.messageId}`);
    } catch (err: any) {
      const details = err.response?.body || err.message;
      this.logger.error(`Failed to send email to ${to}: ${JSON.stringify(details)}`, err.stack);
    }
  }
}
