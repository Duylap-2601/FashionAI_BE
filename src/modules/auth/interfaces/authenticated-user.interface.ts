import { Role, UserTier } from '@prisma/client';

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  tier: UserTier;
  tierExpiresAt: Date | null;
  role: Role;
  isVerified: boolean;
  jti: string;
  exp: number;
}
