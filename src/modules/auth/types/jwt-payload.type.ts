import { Role, UserTier } from '@prisma/client';
import { TokenType } from '../constants';

export type BaseJwtPayload = {
  sub: string;
  jti: string;
  type: TokenType;
  iat?: number;
  exp?: number;
};

export type AccessTokenPayload = BaseJwtPayload & {
  email: string;
  tier: UserTier;
  role: Role;
};

export type RefreshTokenPayload = BaseJwtPayload & {
  type: 'refresh';
};

export type JwtPayload = AccessTokenPayload;
