import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { DeviceTokenPlatform } from './dto/register-device-token.dto';

@Injectable()
export class DeviceTokenService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Upsert theo token: cùng một máy có thể đổi tài khoản, khi đó token phải
   * được gán lại cho user mới thay vì tạo bản ghi trùng.
   */
  async register(userId: string, token: string, platform: DeviceTokenPlatform) {
    return this.prisma.deviceToken.upsert({
      where: { token },
      create: { userId, token, platform },
      update: { userId, platform },
      select: { id: true, platform: true, createdAt: true, updatedAt: true },
    });
  }

  async unregister(userId: string, token: string) {
    const result = await this.prisma.deviceToken.deleteMany({
      where: { userId, token },
    });
    return { deleted: result.count };
  }

  async getTokensForUser(userId: string) {
    return this.prisma.deviceToken.findMany({
      where: { userId },
      select: { token: true },
    });
  }

  async removeByToken(token: string) {
    await this.prisma.deviceToken.deleteMany({ where: { token } });
  }
}
