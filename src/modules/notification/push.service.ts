import { Injectable, Logger } from '@nestjs/common';
import { Notification } from '@prisma/client';
import { Expo, ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk';
import { DeviceTokenService } from './device-token.service';

type PushNotification = Pick<
  Notification,
  'id' | 'type' | 'title' | 'message' | 'data'
>;

/**
 * Gửi Expo Push (FCM/APNs) để OS hiển thị popup khi app ở background hoặc bị
 * kill. Đây là kênh best-effort: mọi lỗi chỉ được log, không chặn flow tạo
 * notification trong DB/socket.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private readonly expo = new Expo();

  constructor(private readonly deviceTokenService: DeviceTokenService) {}

  async sendToUser(
    userId: string,
    notification: PushNotification,
  ): Promise<void> {
    try {
      const tokens = await this.deviceTokenService.getTokensForUser(userId);
      if (!tokens.length) return;

      const data = this.buildData(notification);
      const messages: ExpoPushMessage[] = [];

      for (const { token } of tokens) {
        if (!Expo.isExpoPushToken(token)) {
          this.logger.warn(
            `Bỏ qua Expo push token không hợp lệ của user ${userId}`,
          );
          continue;
        }
        messages.push({
          to: token,
          sound: 'default',
          title: notification.title,
          body: notification.message,
          data,
          channelId: 'default',
          priority: 'high',
        });
      }

      if (!messages.length) return;

      for (const chunk of this.expo.chunkPushNotifications(messages)) {
        const tickets = await this.expo.sendPushNotificationsAsync(chunk);
        await this.handleTickets(chunk, tickets);
      }
    } catch (error) {
      this.logger.warn(
        `Gửi push thông báo thất bại cho user ${userId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Expo yêu cầu `data` là JSON object; Android nhận toàn bộ value dạng string
   * nên chuẩn hoá tại đây để mobile đọc nhất quán ở mọi nền tảng.
   */
  private buildData(notification: PushNotification): Record<string, string> {
    const data: Record<string, string> = {
      notificationId: notification.id,
      notificationType: notification.type,
    };

    const extra = notification.data;
    if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
      for (const [key, value] of Object.entries(extra)) {
        if (key === 'notificationId' || key === 'notificationType') continue;
        if (value === null || value === undefined) continue;
        data[key] =
          typeof value === 'object' ? JSON.stringify(value) : String(value);
      }
    }

    return data;
  }

  private async handleTickets(
    messages: ExpoPushMessage[],
    tickets: ExpoPushTicket[],
  ): Promise<void> {
    for (let index = 0; index < tickets.length; index += 1) {
      const ticket = tickets[index];
      if (ticket.status !== 'error') continue;

      if (ticket.details?.error === 'DeviceNotRegistered') {
        const token = this.resolveToken(messages[index]?.to);
        if (token) {
          await this.deviceTokenService.removeByToken(token);
          this.logger.log('Đã xoá Expo push token không còn hiệu lực');
        }
        continue;
      }

      this.logger.warn(
        `Expo push ticket lỗi (${ticket.details?.error ?? 'unknown'}): ${
          ticket.message
        }`,
      );
    }
  }

  private resolveToken(to: ExpoPushMessage['to'] | undefined): string | null {
    if (typeof to === 'string') return to;
    if (Array.isArray(to) && to.length === 1) return to[0];
    return null;
  }
}
