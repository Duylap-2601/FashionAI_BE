import { UserTier } from '@prisma/client';

export type AiActionName = 'TRY_ON' | 'STYLIST' | 'CHATBOT';

export const AI_ACTION_LIMITS: Record<AiActionName, Record<UserTier, number>> = {
  TRY_ON: {
    FREE: 0,
    MEMBER: 5,
    VIP: 10,
  },
  STYLIST: {
    FREE: 3,
    MEMBER: 20,
    VIP: Infinity,
  },
  CHATBOT: {
    FREE: 50,
    MEMBER: 200,
    VIP: Infinity,
  },
};

export const AI_ACTION_LABELS: Record<AiActionName, string> = {
  TRY_ON: 'Thử đồ',
  STYLIST: 'Tư vấn AI',
  CHATBOT: 'Chatbot',
};

export const AI_ACTION_NAMES: AiActionName[] = ['TRY_ON', 'STYLIST', 'CHATBOT'];

export function isAiActionName(value: string | undefined): value is AiActionName {
  return value !== undefined && AI_ACTION_NAMES.includes(value as AiActionName);
}
