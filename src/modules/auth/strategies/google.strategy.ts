import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';
import { SignedStateStore, readPlatformFromState } from './signed-state.store';
import { Platform } from '../types/platform.type';
import { requireConfig } from '../../../common/utils/require-config.util';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  private static readonly logger = new Logger(GoogleStrategy.name);

  constructor(configService: ConfigService) {
    const clientID = configService.get<string>('GOOGLE_CLIENT_ID');
    const clientSecret = configService.get<string>('GOOGLE_CLIENT_SECRET');
    const isProduction = configService.get<string>('NODE_ENV') === 'production';

    if (!clientID || !clientSecret) {
      // Ở production, chạy tiếp với credential giả sẽ khiến login Google thất bại
      // ở tận bước redirect của Google với lỗi khó lần ra. Dừng sớm tại boot.
      if (isProduction) {
        throw new Error(
          'GOOGLE_CLIENT_ID và GOOGLE_CLIENT_SECRET là bắt buộc khi NODE_ENV=production.',
        );
      }
      GoogleStrategy.logger.warn(
        'GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET chưa cấu hình. Đăng nhập Google sẽ không hoạt động.',
      );
    }

    super({
      clientID: clientID || 'mock_client_id',
      clientSecret: clientSecret || 'mock_client_secret',
      callbackURL:
        configService.get<string>('GOOGLE_CALLBACK_URL') ||
        'http://localhost:3001/api/auth/google/callback',
      scope: ['email', 'profile'],
      passReqToCallback: true,
      store: new SignedStateStore({
        secret: requireConfig(configService, 'JWT_ACCESS_SECRET'),
        ttlSeconds: Number(
          configService.get<string>('GOOGLE_OAUTH_STATE_TTL') ?? '600',
        ),
      }),
    } as never);
  }

  async validate(
    req: any,
    accessToken: string,
    refreshToken: string,
    profile: any,
    done: VerifyCallback,
  ): Promise<any> {
    const { id, name, emails, photos } = profile;
    const email = emails?.[0]?.value;

    if (!email) {
      return done(
        new Error('Tài khoản Google không cung cấp email.'),
        undefined,
      );
    }

    done(null, {
      providerId: id,
      email,
      name: `${name?.givenName || ''} ${name?.familyName || ''}`.trim(),
      avatarUrl: photos?.[0]?.value ?? null,
      accessToken,
      platform: readPlatformFromState(req.query?.state) as Platform,
    });
  }
}
