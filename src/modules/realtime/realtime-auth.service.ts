import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { TokenService } from '../auth/token.service';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';

/**
 * Xác thực token ở handshake WebSocket. Dùng lại TokenService.verifyAccessToken
 * (đã check type='access', jti, và blacklist) rồi load user y hệt
 * JwtStrategy.validate — một nguồn sự thật cho việc "token này là ai".
 */
@Injectable()
export class RealtimeAuthService {
  constructor(
    private readonly tokenService: TokenService,
    private readonly prisma: PrismaService,
  ) {}

  async authenticate(rawToken: string): Promise<AuthenticatedUser> {
    const payload = await this.tokenService.verifyAccessToken(rawToken);

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        tier: true,
        tierExpiresAt: true,
        role: true,
        isVerified: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('Tài khoản không tồn tại hoặc đã bị khóa');
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      tier: user.tier,
      tierExpiresAt: user.tierExpiresAt,
      role: user.role,
      isVerified: user.isVerified,
      jti: payload.jti,
      exp: payload.exp ?? 0,
    };
  }
}
