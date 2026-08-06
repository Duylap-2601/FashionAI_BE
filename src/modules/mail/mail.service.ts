import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter?: nodemailer.Transporter;

  constructor(private readonly configService: ConfigService) {
    const host = this.configService.get<string>('MAIL_HOST');
    const port = this.configService.get<number>('MAIL_PORT', 587);
    const user = this.configService.get<string>('MAIL_USER');
    const pass = this.configService.get<string>('MAIL_PASSWORD');

    if (host && user && pass) {
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
      });
    } else {
      this.logger.warn('Nodemailer configuration missing. E-mails will be logged to console in dev mode.');
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

  private async sendMail(to: string, subject: string, html: string): Promise<void> {
    const from = this.configService.get<string>('MAIL_FROM', '"FashionAI" <noreply@fashionai.com>');

    if (this.transporter) {
      try {
        await this.transporter.sendMail({ from, to, subject, html });
        this.logger.log(`Email successfully sent to ${to} (${subject})`);
      } catch (err: any) {
        this.logger.error(`Failed to send email to ${to}: ${err.message}`, err.stack);
      }
    } else {
      this.logger.log(`[DEV MAIL] To: ${to} | Subject: ${subject}`);
      this.logger.log(`[DEV MAIL HTML]:\n${html}`);
    }
  }
}
