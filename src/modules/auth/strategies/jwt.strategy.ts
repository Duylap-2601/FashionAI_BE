import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../../database/prisma.service';
import { AuthenticatedUser } from '../interfaces/authenticated-user.interface';
import { AccessTokenPayload } from '../types/jwt-payload.type';
import { TokenService } from '../token.service';
import { requireConfig } from '../../../common/utils/require-config.util';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: requireConfig(config, 'JWT_ACCESS_SECRET'),
    });
  }

  async validate(payload: AccessTokenPayload): Promise<AuthenticatedUser> {
    if (payload.type !== 'access' || !payload.jti || !payload.sub) {
      throw new UnauthorizedException('Token không hợp lệ');
    }

    if (await this.tokenService.isAccessTokenBlacklisted(payload.jti)) {
      throw new UnauthorizedException('Token đã bị thu hồi');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        tier: true,
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
      role: user.role,
      isVerified: user.isVerified,
      jti: payload.jti,
      exp: payload.exp ?? 0,
    };
  }
}
