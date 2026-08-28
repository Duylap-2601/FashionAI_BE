import { UserTier } from '@prisma/client';
import {
  AI_ACTION_LIMITS,
  AI_ACTION_LABELS,
  AI_ACTION_NAMES,
  AiActionName,
} from './ai-quota.constants';

export const TIER_PRICES: Record<UserTier, number> = {
  FREE: 0,
  MEMBER: 49000,
  VIP: 99000,
};

export const TIER_LABELS: Record<UserTier, string> = {
  FREE: 'Miễn phí',
  MEMBER: 'Member',
  VIP: 'VIP',
};

export const TIER_RANK: Record<UserTier, number> = {
  FREE: 0,
  MEMBER: 1,
  VIP: 2,
};

export const SUBSCRIPTION_DURATION_DAYS = 30;
export const RENEWAL_REMINDER_DAYS_BEFORE = 3;

export interface PlanSummary {
  tier: UserTier;
  label: string;
  price: number;
  durationDays: number;
  quotas: Array<{
    action: AiActionName;
    label: string;
    limit: number | null;
    unlimited: boolean;
  }>;
}

export function buildPlanList(): PlanSummary[] {
  return (['FREE', 'MEMBER', 'VIP'] as const).map((tier: UserTier) => ({
    tier,
    label: TIER_LABELS[tier],
    price: TIER_PRICES[tier],
    durationDays: tier === 'FREE' ? 0 : SUBSCRIPTION_DURATION_DAYS,
    quotas: AI_ACTION_NAMES.map((action) => {
      const limit = AI_ACTION_LIMITS[action][tier];
      return {
        action,
        label: AI_ACTION_LABELS[action],
        limit: limit === Infinity ? null : limit,
        unlimited: limit === Infinity,
      };
    }),
  }));
}

export function isUpgrade(fromTier: UserTier, toTier: UserTier): boolean {
  return TIER_RANK[toTier] > TIER_RANK[fromTier];
}

export function isDowngrade(fromTier: UserTier, toTier: UserTier): boolean {
  return TIER_RANK[toTier] < TIER_RANK[fromTier];
}

export function resolveEffectiveTier(
  tier: UserTier | undefined,
  tierExpiresAt: Date | null | undefined,
): UserTier {
  const currentTier = tier ?? 'FREE';
  const isExpired = tierExpiresAt && new Date() > tierExpiresAt;
  return isExpired ? 'FREE' : currentTier;
}
