import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(configService: ConfigService) {
    super({
      clientID: configService.get<string>('GOOGLE_CLIENT_ID') || 'mock_client_id',
      clientSecret: configService.get<string>('GOOGLE_CLIENT_SECRET') || 'mock_client_secret',
      callbackURL: configService.get<string>('GOOGLE_CALLBACK_URL') || 'http://localhost:3001/api/auth/google/callback',
      scope: ['email', 'profile'],
    });
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    profile: any,
    done: VerifyCallback,
  ): Promise<any> {
    const { id, name, emails, photos } = profile;
    const user = {
      providerId: id,
      email: emails[0].value,
      name: `${name.givenName || ''} ${name.familyName || ''}`.trim(),
      avatarUrl: photos && photos[0] ? photos[0].value : null,
      accessToken,
    };
    done(null, user);
  }
}
